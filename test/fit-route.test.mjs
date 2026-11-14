import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainWorkout } from '../scripts/import_fit_route.mjs';
import { compileWorkout } from '../public/workout.js';

test('terrain import preserves duration and distinguishes climbing from descending', () => {
  const records = Array.from({ length: 61 }, (_, i) => ({ distance: i * 100, enhancedAltitude: i <= 30 ? i * 8 : (60 - i) * 8 }));
  const workout = terrainWorkout(records);
  assert.equal(compileWorkout(workout).totalSeconds, 2700);
  assert.ok(workout.steps.some(s => s.powerZone === 4 && s.cadence === 65));
  assert.ok(workout.steps.some(s => s.kind === 'recovery' && s.cadence === 95));
  assert.ok(workout.steps.every(s => s.durationSeconds > 0));
  assert.equal(JSON.stringify(workout).includes('positionLat'), false);
});

test('terrain import rejects missing elevation and invalid duration', () => {
  assert.throws(() => terrainWorkout([{ distance: 0 }, { distance: 2000 }]), /elevation/);
  assert.throws(() => terrainWorkout([], { minutes: NaN }), /Minutes/);
});
