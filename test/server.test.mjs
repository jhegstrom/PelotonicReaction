import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
test('server lists validated workouts, serves the player and rejects private files and mutations', async t => {
  const dataRoot=await mkdtemp(path.join(os.tmpdir(),'pr-catalog-test-'));t.after(()=>rm(dataRoot,{recursive:true,force:true}));
  const s = createAppServer(undefined, {dataRoot,rides:{rides:new Map(),list:()=>[]}}); s.listen(0, '127.0.0.1'); await once(s, 'listening'); t.after(() => { s.closeAllConnections(); return new Promise(resolve => s.close(resolve)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const versionResponse=await fetch(base+'/api/version');assert.equal(versionResponse.status,200);assert.equal((await versionResponse.json()).version,JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version);assert.match(versionResponse.headers.get('cache-control'),/no-store/);
  const catalog = await (await fetch(base + '/api/workouts')).json(); assert.equal(catalog.workouts.length, (await readdir(new URL('../workouts/',import.meta.url))).filter(f=>f.endsWith('.json')).length); assert.deepEqual(catalog.errors, []);
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /PelotonicReaction/);
  assert.match((await fetch(base + '/app.js')).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e%2fpackage.json')).status, 403);
  assert.equal((await fetch(base + '/api/workouts', { method: 'POST' })).status, 405);
});
