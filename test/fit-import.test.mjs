import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Encoder, Profile } from '@garmin/fitsdk';
import { importFitWorkout } from '../lib/fit-route.mjs';
import { createAppServer } from '../server.mjs';

function recording() {
  const encoder=new Encoder();
  encoder.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'development',product:1,timeCreated:new Date('2026-01-01')});
  for(let i=0;i<=60;i++)encoder.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date(Date.UTC(2026,0,1,0,i)),distance:i*100,altitude:i<=30?100+i*8:580-i*8,positionLat:Math.round(40*2147483648/180),positionLong:Math.round(-120*2147483648/180)});
  return Buffer.from(encoder.close());
}
test('FIT conversion validates integrity and preserves route geometry with stable duplicate identity',()=>{
  const bytes=recording(),w=importFitWorkout(bytes,'Mountain_Ride.FIT');
  assert.equal(w.name,'Mountain Ride');assert.equal(w.completionMetric,'distance');assert.ok(w.tags.includes('Spinulator'));
  assert.equal(w.route.points.at(-1).distance,6000);assert.ok(Math.abs(w.route.points[0].lat-40)<.00001);
  assert.equal(w.id,importFitWorkout(bytes,'renamed.fit').id);
  assert.throws(()=>importFitWorkout(Buffer.from('not a FIT file')),/valid FIT/);
  const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;assert.throws(()=>importFitWorkout(corrupt),/integrity/);
});
test('FIT conversion endpoint accepts same-origin binary and rejects invalid, oversized and cross-origin input',async t=>{
  const dataRoot=await mkdtemp(path.join(os.tmpdir(),'pr-fit-import-'));t.after(()=>rm(dataRoot,{recursive:true,force:true}));
  const server=createAppServer(undefined,{dataRoot,bike:{close(){}},strava:{},rides:{rides:new Map(),list:()=>[]}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`,url=base+'/api/workouts/import-fit?name=Test.fit';
  const headers={Origin:base,'Content-Type':'application/octet-stream'};
  const response=await fetch(url,{method:'POST',headers,body:recording()});assert.equal(response.status,200);const saved=await response.json();assert.ok(saved.workout.tags.includes('Spinulator'));
  assert.ok((await (await fetch(base+'/api/workouts')).json()).workouts.some(item=>item.workout.id===saved.workout.id));
  assert.equal((await fetch(url,{method:'POST',headers,body:recording()})).status,409);
  assert.equal((await fetch(url,{method:'POST',headers,body:'broken'})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://other.example'},body:recording()})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:'broken'})).status,415);
  assert.equal((await fetch(url,{method:'POST',headers,body:Buffer.alloc(10*1024*1024+1)})).status,413);
  assert.equal((await fetch(url)).status,405);
});
