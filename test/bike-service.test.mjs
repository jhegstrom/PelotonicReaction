import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { BikeService } from '../lib/bike-service.mjs';

test('bike session ownership and controls are separate from read-only catalog', async t => {
  const bike = new BikeService('.', { platform: 'test' });
  const server = createAppServer(undefined, { bike, rides:{rides:new Map(),list:()=>[]} }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(base + '/api/bike/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ client: 'screen-111', action: 'start' })).status, 200);
  assert.equal(bike.owner, 'screen-111');
  assert.equal((await post({ client: 'screen-222', action: 'start' })).status, 409);
  assert.equal((await post({ client: 'screen-222', action: 'stop' })).status, 200);
  assert.equal(bike.owner, 'screen-111', 'another screen cannot disconnect the active rider');
  assert.equal((await post({ client: 'screen-111', action: 'average', seconds: 3 })).status, 200);
  assert.equal((await post({ client: 'screen-111', action: 'timing', recording: true })).status, 200);
  assert.equal(bike.stats.running, true);
  const stats = bike.stats;
  assert.equal((await post({ client: 'screen-111', action: 'start' })).status, 200);
  assert.equal(bike.stats, stats, 'session heartbeats must not reset whole-workout totals');
  assert.equal((await post({ client: 'screen-222', action: 'timing', recording: false })).status, 409);
  assert.equal((await post({ client: 'screen-111', action: 'timing', recording: 'yes' })).status, 400);
  assert.equal((await post({ client: 'screen-111', action: 'average', seconds: -1 })).status, 400);
  assert.equal((await post({ client: 'screen-111', action: 'address', host: ';bad', port: 8081 })).status, 400);
  assert.equal((await fetch(base + '/api/bike/session', { method: 'POST', headers: { Origin: 'http://other-host', 'Content-Type': 'application/json' }, body: JSON.stringify({ client: 'screen-111', action: 'stop' }) })).status, 403);
  assert.equal(bike.owner, 'screen-111');
  assert.equal((await post({ client: 'screen-111', action: 'stop' })).status, 200);
  assert.equal(bike.owner, null);
  assert.equal((await fetch(base + '/api/workouts', { method: 'POST' })).status, 405);
});
test('SSE sends snapshots and disconnect cleanup removes subscribers', async t => {
  const bike = new BikeService('.', { platform: 'test' });
  const server = createAppServer(undefined, { bike, rides:{rides:new Map(),list:()=>[]} }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const abort = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/bike/events?client=screen-111`, { signal: abort.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /Bike connects at ride start/);
  bike.publish({ connected: true, metrics: { Power: { value: 222, at: Date.now() } } });
  assert.match(new TextDecoder().decode((await reader.read()).value), /222/);
  abort.abort();
});

test('connect preflight does not record and promotes to a workout without disconnecting', async t => {
  const bike = new BikeService('.', { platform: 'test' });
  t.after(() => bike.close());
  const starts = [];
  bike.recorder = { store: { rides: new Map() }, safe: fn => fn(), begin: (...args) => starts.push(args), status: () => ({}), finish: () => {} };
  await bike.connect('screen-111');
  assert.equal(bike.owner, 'screen-111');
  assert.equal(bike.rideId, undefined);
  assert.equal(bike.stats.running, false);
  assert.equal(starts.length, 0);
  await assert.rejects(bike.connect('screen-222'), /Another screen/);
  const before = bike.stats;
  await bike.start('screen-111', { rideId: 'preflight-ride-001', name: 'Low impact' });
  assert.equal(starts.length, 1);
  assert.equal(starts[0][0], 'preflight-ride-001');
  assert.notEqual(bike.stats, before, 'preflight samples must not contribute to workout totals');
  const stats = bike.stats;
  await bike.connect('screen-111');
  assert.equal(bike.rideId, 'preflight-ride-001');
  assert.equal(bike.stats, stats);
  assert.equal(starts.length, 1);
});

test('server exposes LAN URLs with the actual bound port and accepts connection preflight', async t => {
  const bike = new BikeService('.', { platform: 'test' });
  const server = createAppServer(undefined, { bike, rides: { rides: new Map(), list: () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { urls } = await (await fetch(base + '/api/server-addresses')).json();
  for (const url of urls) { assert.equal(new URL(url).port, String(server.address().port)); assert.notEqual(new URL(url).hostname, '127.0.0.1'); }
  const response = await fetch(base + '/api/bike/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: 'screen-111', action: 'connect' }) });
  assert.equal(response.status, 200);
  assert.equal(bike.owner, 'screen-111');
  assert.equal(bike.rideId, undefined);
  assert.equal(bike.stats.running, false);
});
