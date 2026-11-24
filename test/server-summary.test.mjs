import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { loadImage } from '@napi-rs/canvas';
import { RideStore } from '../lib/ride-store.mjs';
import { RideSummaries } from '../lib/ride-summaries.mjs';
import { createAppServer } from '../server.mjs';
import { BikeService } from '../lib/bike-service.mjs';
import { createProfile } from '../public/rider-profile.js';
import { nullLogger } from '../lib/event-log.mjs';
const assetsRoot=path.resolve('public/assets');
function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'pr-server-summary-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const store=new RideStore(root),ride=store.begin('summary-server-001','Server test');ride.startedAt=1700000000000;ride.summaryProfile=createProfile();ride.summaryProfile.power.ftpWatts=200;
 store.append(ride,{type:'timer',at:ride.startedAt,running:true,summary:{activeSeconds:0}});
 store.append(ride,{type:'block',at:ride.startedAt,block:{index:0,label:'Spin up',cadence:110,resistance:35,primaryTargets:['cadence','resistance']},summary:{activeSeconds:0}});
 for(let time=0;time<=10;time++)store.append(ride,{type:'sample',at:ride.startedAt+time*1000,heartRate:110+time,power:100+time*3,summary:{activeSeconds:time}});
 store.append(ride,{type:'timer',at:ride.startedAt+10000,running:false,summary:{activeSeconds:10}});
 store.finish(ride,'complete',ride.startedAt+10000,{activeSeconds:10});
 return {root,store,ride};
}
test('server renders, atomically saves and caches a complete PNG with both traces and caches its legacy alias',async t=>{
 const f=fixture(t),summaries=new RideSummaries(f.store,{assetsRoot});
 const first=await summaries.png(f.ride.id),power=await summaries.png(f.ride.id,{power:true});
 const image=await loadImage(first);assert.equal(image.width,1600);assert.equal(image.height,1000);
 assert.deepEqual(first,power);assert.ok(existsSync(f.store.file(f.ride.id,'.summary.png')));assert.ok(existsSync(f.store.file(f.ride.id,'.summary-power.png')));
 summaries.render=()=>{throw Error('A cache hit must not render again.');};assert.deepEqual(await summaries.png(f.ride.id),first);
 const fresh=new RideSummaries(new RideStore(f.root),{assetsRoot,render:summaries.render});assert.deepEqual(await fresh.png(f.ride.id),first,'cache survives restart');
});
test('concurrent requests share rendering and a resumed ride cannot receive stale PNGs',async t=>{
 const f=fixture(t);let release,calls=0;const wait=new Promise(resolve=>{release=resolve;});
 const summaries=new RideSummaries(f.store,{assetsRoot,render:async()=>{calls++;await wait;return Buffer.from('png');}});
 const first=summaries.generate(f.ride.id),second=summaries.generate(f.ride.id);
 f.ride.state='interrupted';f.store.save(f.ride);f.store.resume(f.ride.id);release();
 await assert.rejects(first,e=>e.status===409);await assert.rejects(second,e=>e.status===409);assert.equal(calls,1,'one render shared by all summary requests');
 assert.equal(existsSync(f.store.file(f.ride.id,'.summary.png')),false);
});
test('PNG endpoint serves the saved server file with download headers and refuses active rides',async t=>{
 const f=fixture(t),bike=new BikeService(f.root,{platform:'test'});
 const server=createAppServer(undefined,{dataRoot:f.root,rides:f.store,bike,logger:nullLogger});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
 const url=`http://127.0.0.1:${server.address().port}/api/rides/${f.ride.id}/summary.png?download=1`;
 const response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.match(response.headers.get('content-disposition'),/attachment/);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync(f.store.file(f.ride.id,'.summary.png')));
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 f.ride.state='recording';f.store.save(f.ride);assert.equal((await fetch(url)).status,409);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('ride completion generates summaries without a browser request',async t=>{
 const f=fixture(t),bike=new BikeService(f.root,{platform:'test',rides:f.store});
 const server=createAppServer(undefined,{dataRoot:f.root,rides:f.store,bike,logger:nullLogger});
 // The same callback is used for completed and interrupted recordings.
 bike.recorder.onFinish(f.ride);await server.summaries.generate(f.ride.id);
 assert.ok(existsSync(f.store.file(f.ride.id,'.summary.png')));assert.ok(existsSync(f.store.file(f.ride.id,'.summary-power.png')));bike.close();
});
