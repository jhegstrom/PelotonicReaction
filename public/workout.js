export function compileWorkout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('A workout must be a JSON object.');
  if (input.schemaVersion !== 1) throw Error('schemaVersion must be 1.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160) throw Error('Give the workout a name (1–160 characters).');
  if (input.description != null && typeof input.description !== 'string') throw Error('description must be text.');
  if (input.tags != null && (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some(t => typeof t !== 'string' || t.length > 60))) throw Error('tags must be an array of short text labels.');
  if (input.id != null && typeof input.id !== 'string') throw Error('id must be text.');
  const intervals = [];
  function visit(steps, prefix = '', depth = 0) {
    if (!Array.isArray(steps) || !steps.length) throw Error('steps must be a non-empty array.');
    if (depth > 5) throw Error('Repeat groups can be nested at most five levels.');
    for (const step of steps) {
      if (!step || typeof step !== 'object') throw Error('Each step must be an object.');
      if ('repeat' in step) {
        if (step.label != null && (typeof step.label !== 'string' || step.label.length > 160)) throw Error('A repeat group label must be short text.');
        if (!Number.isInteger(step.repeat) || step.repeat < 1 || step.repeat > 100) throw Error('repeat must be an integer from 1 to 100.');
        for (let n = 1; n <= step.repeat; n++) visit(step.steps, `${prefix}${step.label || 'Round'} ${n} · `, depth + 1);
      } else {
        if (typeof step.label !== 'string' || !step.label.trim() || step.label.length > 160) throw Error('Every interval needs a label (1–160 characters).');
        if (!Number.isInteger(step.durationSeconds) || step.durationSeconds < 1 || step.durationSeconds > 86400) throw Error(`${step.label}: durationSeconds must be a positive integer, at most 86400.`);
        const bounds = { cadence: [0, 200], resistance: [0, 100], watts: [0, 3000] };
        for (const [key, [lo, hi]] of Object.entries(bounds)) {
          if (step[key] != null && (typeof step[key] !== 'number' || !Number.isFinite(step[key]) || step[key] < lo || step[key] > hi)) throw Error(`${step.label}: ${key} must be a number from ${lo} to ${hi}, or null.`);
        }
        const kind = step.kind || 'work';
        if (!['warmup', 'work', 'recovery', 'cooldown'].includes(kind)) throw Error(`${step.label}: unsupported kind ${kind}.`);
        intervals.push({ ...step, label: `${prefix}${step.label}`, kind });
        if (intervals.length > 5000) throw Error('A workout can contain at most 5000 intervals.');
      }
    }
  }
  visit(input.steps);
  let totalSeconds = 0;
  for (const interval of intervals) { interval.startSeconds = totalSeconds; totalSeconds += interval.durationSeconds; interval.endSeconds = totalSeconds; }
  if (totalSeconds > 86400) throw Error('A workout must be no longer than 24 hours.');
  return { ...input, name: input.name.trim(), intervals, totalSeconds };
}

export function positionAt(workout, seconds) {
  const elapsed = Math.max(0, Math.min(seconds, workout.totalSeconds));
  const index = workout.intervals.findIndex(i => elapsed < i.endSeconds);
  return { elapsed, index, done: index === -1, remaining: index === -1 ? 0 : workout.intervals[index].endSeconds - elapsed };
}

// The clock is anchored to a timestamp, not the number of timer callbacks received.
export class WorkoutClock {
  constructor(totalSeconds, now = () => Date.now()) { this.totalSeconds = totalSeconds; this.now = now; this.elapsed = 0; this.anchor = null; }
  read() { return Math.min(this.totalSeconds, this.elapsed + (this.anchor === null ? 0 : Math.max(0, this.now() - this.anchor) / 1000)); }
  start() { if (this.anchor === null && this.elapsed < this.totalSeconds) this.anchor = this.now(); }
  pause() { this.elapsed = this.read(); this.anchor = null; }
  seek(seconds) { this.elapsed = Math.max(0, Math.min(seconds, this.totalSeconds)); if (this.anchor !== null) this.anchor = this.now(); }
  get running() { return this.anchor !== null && this.read() < this.totalSeconds; }
}

export function formatTime(seconds) {
  const n = Math.max(0, Math.ceil(seconds));
  return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
