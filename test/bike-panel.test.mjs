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

test('a finalized ride response never rotates the recording ID or creates a replacement ride', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ok:false,json:async()=>({code:'recording-ended',error:'Open the saved ride instead.'})}));
  const panel=Object.assign(Object.create(BikePanel.prototype),{
    desired:true,recording:true,rideId:'original-ride-001',routeOffsetKm:0,routeDistanceKm:12,
    snapshot:{recording:{}},
  });
  assert.equal(await panel.postCommand('start',{rideId:'original-ride-001'}),false);
  assert.equal(panel.rideId,'original-ride-001');assert.equal(panel.routeOffsetKm,0);
  assert.equal(panel.desired,false);assert.equal(panel.recording,false);
  assert.match(panel.snapshot.recording.error,/saved ride/);
});

test('a late finalized response for an older ride does not stop a newly selected ride', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ok:false,json:async()=>({code:'recording-ended',error:'Ended'})}));
  const panel=Object.assign(Object.create(BikePanel.prototype),{
    desired:true,recording:true,rideId:'new-ride-001',snapshot:{},
  });
  await panel.postCommand('start',{rideId:'old-ride-001'});
  assert.equal(panel.desired,true);assert.equal(panel.recording,true);assert.equal(panel.rideId,'new-ride-001');
});
