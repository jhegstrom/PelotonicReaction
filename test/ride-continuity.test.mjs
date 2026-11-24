import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Decoder, Stream } from '@garmin/fitsdk';
import { BikeService } from '../lib/bike-service.mjs';
import { RideStore } from '../lib/ride-store.mjs';
import { summaryModel } from '../public/workout-summary.js';

function fixture(t){
  const root=mkdtempSync(path.join(os.tmpdir(),'pr-continuity-'));
  let now=0;const epoch=Date.UTC(2026,10,23,20);
  const clock={now:()=>now,wallNow:()=>epoch+now};
  const store=new RideStore(root),services=[];
  const service=(rides=store)=>{const bike=new BikeService(root,{platform:'test',rides,...clock});services.push(bike);return bike;};
  t.after(()=>{for(const bike of services)bike.close();rmSync(root,{recursive:true,force:true});});
  const advance=seconds=>{now+=seconds*1000;};
  const telemetry=bike=>bike.publish({connected:true,metrics:Object.fromEntries(Object.entries({Power:200,Cadence:90,Resistance:40,Speed:36,'Heart rate':135}).map(([name,value])=>[name,{value,at:clock.wallNow()}]))});
  return {root,store,service,advance,telemetry};
}
const id='continuity-ride-001',client='screen-test-001';
const block={index:0,label:'Work',kind:'work',heartRateZone:3,primaryTargets:['heartRate']};
function timing(bike,running,step=block){bike.configure(client,{action:'timing',rideId:id,recording:running,remainingSeconds:600,block:step});}
function decode(store){
 const file=readFileSync(store.file(id,'.fit')),decoder=new Decoder(Stream.fromByteArray(file));
 assert.equal(decoder.isFIT(),true);assert.equal(decoder.checkIntegrity(),true);
 const result=decoder.read();assert.deepEqual(result.errors,[]);return result.messages;
}
function onlyOneFit(store){assert.deepEqual(readdirSync(store.dir).filter(f=>f.endsWith('.fit')),[id+'.fit']);}

test('bike disconnection and pause preserve one ride, measured totals and segment history',async t=>{
 const f=fixture(t),bike=f.service();await bike.start(client,{rideId:id,name:'Continuity'});
 f.telemetry(bike);timing(bike,true);
 for(let i=0;i<4;i++){f.advance(1);f.telemetry(bike);bike.recordTick();}
 const before=bike.present().ride;
 bike.publish({connected:false,metrics:{}});timing(bike,false);
 f.advance(120);await bike.start(client,{rideId:id});
 assert.equal(bike.present().ride.distanceKm,before.distanceKm);
 assert.equal(bike.present().ride.estimatedCaloriesKcal,before.estimatedCaloriesKcal);
 const duringPause=decode(f.store);assert.equal(duringPause.sessionMesgs[0].totalTimerTime,4);
 f.telemetry(bike);timing(bike,true,{...block,index:1,label:'Second effort'});
 for(let i=0;i<3;i++){f.advance(1);f.telemetry(bike);bike.recordTick();}
 bike.stop(client,{rideId:id,reason:'complete'});
 onlyOneFit(f.store);const m=decode(f.store),ride=f.store.get(id);
 assert.equal(ride.state,'completed');assert.equal(ride.summary.activeSeconds,7);
 assert.ok(Math.abs(ride.summary.distanceKm-.07)<1e-9);
 assert.equal(ride.summary.energyKj,1.4);
 assert.deepEqual(m.eventMesgs.map(e=>e.eventType),['start','stopAll','start','stopAll']);
 assert.equal(m.sessionMesgs[0].totalElapsedTime,127);
 assert.equal(ride.blockSummaries.length,2);assert.ok(m.recordMesgs.length>1);
});

test('lost browser while paused saves a valid partial FIT and resumes the same file and totals',async t=>{
 const f=fixture(t),bike=f.service();await bike.start(client,{rideId:id,name:'Continuity'});
 f.telemetry(bike);timing(bike,true);f.advance(4);f.telemetry(bike);bike.recordTick();timing(bike,false);
 const saved={...bike.present().ride};decode(f.store);
 f.advance(91);bike.checkOwner();assert.equal(bike.owner,null);
 assert.equal(f.store.get(id).state,'interrupted');onlyOneFit(f.store);
 assert.equal(decode(f.store).sessionMesgs[0].totalTimerTime,4);
 await bike.start(client,{rideId:id,name:'Should not rename the ride'});
 assert.equal(bike.recorder.ride.name,'Continuity');assert.equal(bike.present().ride.distanceKm,saved.distanceKm);
 assert.equal(bike.present().ride.estimatedCaloriesKcal,saved.estimatedCaloriesKcal);
 f.telemetry(bike);timing(bike,true);f.advance(3);f.telemetry(bike);bike.recordTick();
 bike.stop(client,{rideId:id,reason:'complete'});
 onlyOneFit(f.store);const m=decode(f.store);
 assert.equal(m.sessionMesgs[0].totalTimerTime,7);assert.equal(m.sessionMesgs[0].totalDistance,70);
 assert.deepEqual(m.eventMesgs.map(e=>e.eventType),['start','stopAll','start','stopAll']);
 assert.equal(f.store.get(id).blockSummaries.length,1,'resuming within a segment does not create a replacement segment');
});

test('server interruption recovers the journal and appends to the original FIT after restart',async t=>{
 const f=fixture(t),bike=f.service();await bike.start(client,{rideId:id,name:'Continuity'});
 f.telemetry(bike);timing(bike,true);f.advance(3);f.telemetry(bike);bike.recordTick();
 // Simulate a hard crash after journal writes, without graceful close/finalize.
 clearInterval(bike.watch);clearInterval(bike.recordWatch);
 const initialRecords=decode(f.store).recordMesgs.length;
 appendFileSync(f.store.file(id,'.ndjson'),'{"type":"sample"');
 const recovered=new RideStore(f.root);assert.equal(recovered.get(id).state,'interrupted');
 bike.recorder.ride=null;bike.owner=null;
 f.advance(300);const next=f.service(recovered);await next.start(client,{rideId:id});
 assert.equal(next.present().ride.activeSeconds,3);assert.equal(next.present().ride.distanceKm,.03);
 f.telemetry(next);timing(next,true);f.advance(2);f.telemetry(next);next.recordTick();next.stop(client,{rideId:id,reason:'complete'});
 onlyOneFit(recovered);const m=decode(recovered);
 assert.equal(m.sessionMesgs[0].totalTimerTime,5);assert.equal(m.sessionMesgs[0].totalDistance,50);
 assert.ok(m.recordMesgs.length>initialRecords);assert.equal(recovered.get(id).blockSummaries.length,1);
 const model=summaryModel(recovered.get(id),recovered.entries(id));assert.equal(model.segments.length,1);assert.ok(model.samples.length>1);
});

test('unpaused sensor outage excludes unknown work and resumes accumulating fresh data',async t=>{
 const f=fixture(t),bike=f.service();await bike.start(client,{rideId:id});f.telemetry(bike);timing(bike,true);
 f.advance(2);f.telemetry(bike);bike.recordTick();bike.publish({connected:false,metrics:{}});
 const before=bike.present().ride;f.advance(30);bike.recordTick();
 assert.equal(bike.present().ride.distanceKm,before.distanceKm);assert.equal(bike.present().ride.energyKj,before.energyKj);
 f.telemetry(bike);f.advance(2);f.telemetry(bike);bike.recordTick();bike.stop(client,{reason:'complete'});
 assert.equal(f.store.get(id).summary.activeSeconds,34);assert.equal(f.store.get(id).summary.energyKj,.8);
 assert.equal(decode(f.store).sessionMesgs[0].totalDistance,40);onlyOneFit(f.store);
});

test('completed and already submitted interrupted rides cannot be silently reopened',async t=>{
 const f=fixture(t),bike=f.service();await bike.start(client,{rideId:id});f.telemetry(bike);timing(bike,true);f.advance(2);f.telemetry(bike);bike.recordTick();bike.stop(client,{reason:'complete'});
 const original=readFileSync(f.store.file(id,'.fit'));
 await assert.rejects(bike.start(client,{rideId:id}),e=>e.code==='recording-ended');
 assert.equal(bike.owner,null);assert.deepEqual(readFileSync(f.store.file(id,'.fit')),original);
 const ride=f.store.get(id);ride.state='interrupted';ride.upload={state:'processing',uploadId:'123'};f.store.save(ride);
 await assert.rejects(bike.start(client,{rideId:id}),e=>e.code==='recording-ended');onlyOneFit(f.store);
});

test('a paused ride that is never resumed is finalized on server shutdown',async t=>{
 const f=fixture(t),bike=f.service();await bike.start(client,{rideId:id});f.telemetry(bike);timing(bike,true);
 f.advance(4);f.telemetry(bike);bike.recordTick();timing(bike,false);f.advance(600);bike.close();
 assert.equal(f.store.get(id).state,'interrupted');onlyOneFit(f.store);
 assert.equal(decode(f.store).sessionMesgs[0].totalTimerTime,4);
 assert.equal(decode(f.store).sessionMesgs[0].totalDistance,40);
});

test('periodic checkpoints contain a stop event without stopping the live journal',async t=>{
 const f=fixture(t),bike=f.service();await bike.start(client,{rideId:id});f.telemetry(bike);timing(bike,true);
 f.advance(16);f.telemetry(bike);bike.recordTick();
 assert.equal(bike.recorder.running,true);assert.equal(f.store.get(id).state,'recording');
 assert.equal(decode(f.store).eventMesgs.at(-1).eventType,'stopAll');
 assert.equal(f.store.entries(id).filter(e=>e.type==='timer').at(-1).running,true);
 onlyOneFit(f.store);
});
