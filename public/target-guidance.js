import { powerZoneRange } from './power-zones.js';
// These are the instantaneous target fields currently supported by Program JSON.
export const TARGET_FIELDS = { cadence: 'cadence', power: 'watts', resistance: 'resistance', hr: 'heartRate' };
export function programTarget(step, key, profile = null) {
  const field = TARGET_FIELDS[key];
  if (!field || !step) return null;
  if (field === 'watts' && step.powerZone != null) return powerZoneRange(step.powerZone, profile?.power?.ftpWatts);
  const range = step.targetRanges?.[field];
  if (Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) && range[0] <= range[1]) {
    return { low: range[0], high: range[1], explicitRange: true };
  }
  if (!Number.isFinite(step[field])) return null;
  return { low: step[field], high: step[field], explicitRange: false };
}
export function isPrimaryTarget(step, key) {
  return Array.isArray(step?.primaryTargets) && step.primaryTargets.includes(TARGET_FIELDS[key]);
}
export function targetCorrection(actual, target, fresh, previous = null) {
  if (!fresh || !Number.isFinite(actual) || !target || !Number.isFinite(target.low) || !(Number.isFinite(target.high) || target.high === Infinity)) return { level: 'neutral', direction: null, percent: null };
  const boundary = actual < target.low ? target.low : actual > target.high ? target.high : null;
  if (boundary == null) return { level: 'on', direction: null, percent: 0 };
  const direction = actual < target.low ? 'increase' : 'decrease';
  const percent = boundary === 0 ? null : Math.abs(actual - boundary) / Math.abs(boundary) * 100;
  if (percent == null) return { level: 'large', direction, percent: null };
  // Explicit ranges already define the accepted band; scalars use ±5%.
  const deadband = target.explicitRange ? 0 : 5;
  if (percent <= deadband + 1e-9) return { level: 'on', direction: null, percent };
  const sameDirection = previous?.direction === direction;
  if (previous?.level === 'on' && percent <= deadband + 1) return { level: 'on', direction: null, percent };
  if (sameDirection && previous.level === 'small' && percent <= 11) return { level: 'small', direction, percent };
  return { level: percent > 10 + 1e-9 ? 'large' : 'small', direction, percent };
}
export function segmentInstructions(step) {
  if (!step) return '';
  const labels = { cadence: 'cadence', resistance: 'resistance', watts: 'power', heartRate: 'HR' };
  const parts = [];
  if (step.powerZone != null) parts.push(`Power zone ${step.powerZone}`);
  const primary = step.primaryTargets || [];
  if (primary.length) parts.push(`Guide: ${primary.map(key => labels[key]).join(' + ')}`);
  else if (Object.values(TARGET_FIELDS).some(key => step[key] != null || step.targetRanges?.[key]) || step.powerZone != null) parts.push('Reference targets');
  return parts.join(' · ');
}
export function formatProgramTarget(step, key, profile) {
  const target = programTarget(step, key, profile);
  if (!target) return key === 'power' && step?.powerZone != null ? `Z${step.powerZone}` : '—';
  const number = n => String(Math.round(n * 10) / 10);
  return target.high === Infinity ? `${number(target.low)}+` : target.low === target.high ? number(target.low) : `${number(target.low)}–${number(target.high)}`;
}
