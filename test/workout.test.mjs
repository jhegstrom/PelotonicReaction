import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { compileWorkout, positionAt, WorkoutClock, formatTime } from '../public/workout.js';
const sample = { schemaVersion: 1, name: 'Test', steps: [{ label: 'Warm-up', durationSeconds: 10 }, { repeat: 2, steps: [{ label: 'Work', durationSeconds: 20 }, { label: 'Rest', durationSeconds: 10, kind: 'recovery' }] }] };
test('repeat groups flatten into correctly timed work/rest blocks', () => {
  const w = compileWorkout(sample); assert.equal(w.totalSeconds, 70); assert.equal(w.intervals.length, 5); assert.equal(w.intervals[3].startSeconds, 40); assert.equal(w.intervals[3].label, 'Round 2 · Work');
});
test('exact boundaries advance and completion never loops to the first block', () => {
  const w = compileWorkout(sample); assert.equal(positionAt(w, 9.999).index, 0); assert.equal(positionAt(w, 10).index, 1); assert.equal(positionAt(w, 30).index, 2); assert.equal(positionAt(w, 70).done, true); assert.equal(positionAt(w, 700).remaining, 0);
});
test('clock catches up after missed callbacks and preserves pause/resume and seek', () => {
  let now = 1000; const c = new WorkoutClock(100, () => now); c.start(); now += 35000; assert.equal(c.read(), 35); c.pause(); now += 60000; assert.equal(c.read(), 35); c.start(); now += 12000; assert.equal(c.read(), 47); c.seek(70); now += 5000; assert.equal(c.read(), 75); now += 50000; assert.equal(c.read(), 100); c.pause(); c.seek(0); assert.equal(c.read(), 0); assert.equal(c.running, false);
});
test('invalid imported workouts fail with actionable errors', () => {
  for (const value of [null, {}, { ...sample, schemaVersion: 2 }, { ...sample, steps: [] }, { ...sample, steps: [{ label: 'Bad', durationSeconds: 0 }] }, { ...sample, steps: [{ label: 'Bad', durationSeconds: 10, cadence: '80' }] }, { ...sample, steps: [{ repeat: 1000, steps: sample.steps }] }, { ...sample, steps: [{ label: 'Bad', durationSeconds: 10, resistance: 101 }] }]) assert.throws(() => compileWorkout(value));
});
test('the four converted workouts preserve spreadsheet durations and planned targets', async () => {
  const expected = { '3-by-20-5-at-130.json': [5100, 7], 'mt-peloton-90-minute-climb.json': [5400, 23], '90-minute-fat-burn.json': [5400, 17], '45-minute-tabata.json': [2700, 97], 'one-minute-sound-check.json': [60, 8] };
  for (const file of await readdir(new URL('../workouts/', import.meta.url))) {
    const raw = JSON.parse(await readFile(new URL('../workouts/' + file, import.meta.url))); const w = compileWorkout(raw); assert.deepEqual([w.totalSeconds, w.intervals.length], expected[file], file);
    if (file === '45-minute-tabata.json') { assert.equal(w.intervals[3].durationSeconds, 20); assert.equal(w.intervals[4].durationSeconds, 10); assert.equal(w.intervals[3].watts, 161.3); assert.equal(w.intervals[3].cadence, 75); }
    if (file === '3-by-20-5-at-130.json') assert.equal(w.intervals[1].watts, undefined);
    if (file === '90-minute-fat-burn.json') assert.equal(w.intervals[1].watts, 133.6);
  }
});
test('time display rounds remaining seconds upward and includes hours when needed', () => { assert.equal(formatTime(19.1), '0:20'); assert.equal(formatTime(5400), '1:30:00'); assert.equal(formatTime(-1), '0:00'); });
test('malformed metadata cannot break library rendering', () => { for (const extra of [{ tags: 'Tabata' }, { tags: [{}] }, { description: {} }, { id: 22 }]) assert.throws(() => compileWorkout({ ...sample, ...extra })); });

test('start countdown preserves workout time, pauses, and catches up across the start boundary', () => {
  let now = 0;
  const clock = new WorkoutClock(60, () => now);
  clock.start(10);
  assert.equal(clock.countdownRemaining, 10);
  assert.equal(clock.read(), 0);
  now = 4000;
  clock.pause();
  now = 24000;
  assert.equal(clock.countdownRemaining, 6);
  assert.equal(clock.running, false);
  clock.start(10);
  now = 29500;
  assert.equal(clock.countdownRemaining, 0.5);
  assert.equal(clock.read(), 0);
  now = 32000;
  assert.equal(clock.countdownRemaining, 0);
  assert.equal(clock.read(), 2);
  clock.pause();
  clock.start(10);
  now = 33000;
  assert.equal(clock.read(), 3);
  clock.pause();
  clock.seek(0);
  clock.start(10);
  assert.equal(clock.countdownRemaining, 10);
  clock.seek(20);
  assert.equal(clock.countdownRemaining, 0);
  assert.equal(clock.read(), 20);
});

test('optional HR and target-range metadata stays valid after simplifying live display', () => {
  const base = { schemaVersion: 1, name: 'HR intervals', steps: [{ label: 'Steady', durationSeconds: 30, heartRate: 140, targetRanges: { heartRate: [135,145], watts: [190,210] } }] };
  assert.deepEqual(compileWorkout(base).intervals[0].targetRanges.heartRate, [135,145]);
  for (const targetRanges of [{ heartRate: [150,130] }, { watts: [100] }, { resistance: [-1,100] }, { cadence: ['80',100] }, { unknown: [1,2] }]) {
    assert.throws(() => compileWorkout({ ...base, steps: [{ ...base.steps[0], targetRanges }] }));
  }
});

test('posture, power zone and primary metadata validate and survive repeated steps',()=>{
  const step={label:'Tempo',durationSeconds:60,posture:'seated',powerZone:3,primaryTargets:['watts']};
  const make=s=>({schemaVersion:1,name:'Zone ride',steps:[{repeat:2,steps:[s]}]});
  const result=compileWorkout(make(step));
  assert.equal(result.intervals[1].posture,'seated'); assert.equal(result.intervals[1].powerZone,3);
  assert.deepEqual(result.intervals[1].primaryTargets,['watts']);
  for(const change of [{posture:'one-leg'},{powerZone:8},{powerZone:1.5},{watts:150},{targetRanges:{watts:[100,200]}},{primaryTargets:['powerZone']},{primaryTargets:['cadence']},{primaryTargets:['watts','watts']}]) assert.throws(()=>compileWorkout(make({...step,...change})));
  assert.doesNotThrow(()=>compileWorkout(make({...step,powerZone:null,primaryTargets:null})));
});
