import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BikePanel } from '../public/bike-panel.js';

test('starting the timer during connection preflight immediately promotes the session', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const actions = [];
  const panel = Object.assign(Object.create(BikePanel.prototype), {
    desired: true, posting: false, seconds: 3, recording: false,
    command: async (action, fields) => { actions.push([action, fields]); if (action === 'connect') await pending; return true; },
  });
  const preflight = panel.ensureSession();
  panel.rideId = 'timer-started-001';
  release();
  await preflight;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actions.map(([action]) => action), ['connect', 'start', 'average', 'timing']);
  assert.equal(actions.at(-1)[1].recording, false);
  assert.equal(panel.posting, false);
});
