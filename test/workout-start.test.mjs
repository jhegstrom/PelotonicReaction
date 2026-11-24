import test from 'node:test';
import assert from 'node:assert/strict';
import { startWorkout } from '../public/workout-start.js';
import { WorkoutClock } from '../public/workout.js';

test('Start immediately begins the countdown even when browser audio never resolves',()=>{
 const clock=new WorkoutClock(300,()=>1000);let begins=0;
 startWorkout(clock,{begin:()=>begins++,enableAudio:()=>new Promise(()=>{})});
 assert.equal(begins,1);assert.equal(clock.running,true);assert.equal(clock.countdownRemaining,10);
});

test('late audio permission cannot resume a timer the rider has paused',async()=>{
 let now=0,release;const clock=new WorkoutClock(300,()=>now),audio=new Promise(resolve=>{release=resolve;});
 startWorkout(clock,{begin:()=>{},enableAudio:()=>audio});now=3000;clock.pause();release();await audio;
 assert.equal(clock.running,false);assert.equal(clock.countdownRemaining,7);
});

test('unsupported or rejected audio does not prevent start or add a countdown on resume',async()=>{
 for(const enableAudio of [()=>{throw Error('Unavailable');},()=>Promise.reject(Error('Blocked'))]){
  const clock=new WorkoutClock(300,()=>0);clock.seek(30);
  startWorkout(clock,{begin:()=>{},enableAudio});await Promise.resolve();
  assert.equal(clock.running,true);assert.equal(clock.countdownRemaining,0);assert.equal(clock.read(),30);
 }
});
