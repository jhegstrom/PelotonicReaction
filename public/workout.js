import { normalizeTags } from './tags.js';

export function compileWorkout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('A workout must be a JSON object.');
  if (input.schemaVersion !== 1) throw Error('schemaVersion must be 1.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160) throw Error('Give the workout a name (1–160 characters).');
  if (input.description != null && typeof input.description !== 'string') throw Error('description must be text.');
  const tags = normalizeTags(input.tags);
  normalizeTags(input.userTags); // Validate portable user-tag labels on browser imports.
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
        const bounds = { cadence: [0, 200], resistance: [0, 100], watts: [0, 3000], heartRate: [30, 240] };
        for (const [key, [lo, hi]] of Object.entries(bounds)) {
          if (step[key] != null && (typeof step[key] !== 'number' || !Number.isFinite(step[key]) || step[key] < lo || step[key] > hi)) throw Error(`${step.label}: ${key} must be a number from ${lo} to ${hi}, or null.`);
        }
        if (step.targetRanges != null) {
          if (typeof step.targetRanges !== 'object' || Array.isArray(step.targetRanges)) throw Error(`${step.label}: targetRanges must be an object.`);
          for (const [key, range] of Object.entries(step.targetRanges)) {
            if (!bounds[key] || !Array.isArray(range) || range.length !== 2 || range.some(v => typeof v !== 'number' || !Number.isFinite(v)) || range[0] < bounds[key][0] || range[1] > bounds[key][1] || range[0] > range[1]) throw Error(`${step.label}: invalid ${key} target range.`);
          }
        }
        if (step.posture != null && !['seated', 'standing'].includes(step.posture)) throw Error(`${step.label}: posture must be seated, standing or null.`);
        if (step.heartRateZone != null && (!Number.isInteger(step.heartRateZone) || step.heartRateZone < 1 || step.heartRateZone > 5)) throw Error(`${step.label}: heartRateZone must be 1–5 or null.`);
        if (step.heartRateZone != null && (step.heartRate != null || step.targetRanges?.heartRate)) throw Error(`${step.label}: choose a heart-rate zone or a BPM target, not both.`);
        if (step.powerZone != null && (!Number.isInteger(step.powerZone) || step.powerZone < 1 || step.powerZone > 7)) throw Error(`${step.label}: powerZone must be 1–7 or null.`);
        if (step.powerZone != null && step.targetRanges?.watts) throw Error(`${step.label}: choose a power zone or a watts range, not both.`);
        if (step.primaryTargets != null) {
          if (!Array.isArray(step.primaryTargets) || new Set(step.primaryTargets).size !== step.primaryTargets.length || step.primaryTargets.some(key => !Object.hasOwn(bounds, key))) throw Error(`${step.label}: primaryTargets must list unique cadence, resistance, watts or heartRate fields.`);
          for (const key of step.primaryTargets) {
            if (step[key] == null && !step.targetRanges?.[key] && !(key === 'watts' && step.powerZone != null) && !(key === 'heartRate' && step.heartRateZone != null)) throw Error(`${step.label}: primary target ${key} has no target value.`);
          }
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
  return { ...input, name: input.name.trim(), tags, intervals, totalSeconds };
}

export function positionAt(workout, seconds) {
  const elapsed = Math.max(0, Math.min(seconds, workout.totalSeconds));
  const index = workout.intervals.findIndex(i => elapsed < i.endSeconds);
  return { elapsed, index, done: index === -1, remaining: index === -1 ? 0 : workout.intervals[index].endSeconds - elapsed };
}

// The clock is anchored to a timestamp, not the number of timer callbacks received.
export class WorkoutClock {
  constructor(totalSeconds, now = () => Date.now()) { this.totalSeconds = totalSeconds; this.now = now; this.elapsed = 0; this.anchor = null; }
  position() { return Math.min(this.totalSeconds, this.elapsed + (this.anchor === null ? 0 : Math.max(0, this.now() - this.anchor) / 1000)); }
  read() { return Math.max(0, this.position()); }
  get countdownRemaining() { return Math.max(0, -this.position()); }
  start(delaySeconds = 0) {
    if (this.anchor === null && this.elapsed < this.totalSeconds) {
      if (this.elapsed === 0) this.elapsed = -Math.max(0, delaySeconds);
      this.anchor = this.now();
    }
  }
  pause() { this.elapsed = this.position(); this.anchor = null; }
  seek(seconds) { this.elapsed = Math.max(0, Math.min(seconds, this.totalSeconds)); if (this.anchor !== null) this.anchor = this.now(); }
  get running() { return this.anchor !== null && this.read() < this.totalSeconds; }
}

export function formatTime(seconds) {
  const n = Math.max(0, Math.ceil(seconds));
  return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
