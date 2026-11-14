import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,appendFileSync,readFileSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {Decoder,Stream} from '@garmin/fitsdk';
import {RideStore} from '../lib/ride-store.mjs';
import {RideRecorder} from '../lib/ride-recorder.mjs';
import {RideMetrics} from '../lib/ride-metrics.mjs';
import {RideUploads} from '../lib/ride-uploads.mjs';
import {BikeService} from '../lib/bike-service.mjs';
import {createAppServer} from '../server.mjs';
const snapshot=(power=231,ageMs=0)=>({connected:true,powerAverage:99,metrics:Object.fromEntries(Object.entries({Power:power,Cadence:83,'Heart rate':135,Resistance:42,Speed:36}).map(([k,value])=>[k,{value,ageMs}]))});
function setup(t){const root=mkdtempSync(path.join(os.tmpdir(),'pr-record-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,store:new RideStore(root)};}
function recording(t,reason='complete'){
 const {store,root}=setup(t);let now=0;const wall=Date.UTC(2026,0,1,10);const stats=new RideMetrics(0),recorder=new RideRecorder(store,{now:()=>now,wallNow:()=>wall});
 recorder.begin('test-ride-001','Indoor test',42);
 const ingest=()=>stats.ingest(snapshot(),now);
 const sample=()=>recorder.sample(snapshot(),stats.summary(now));
 ingest(); now=10000;ingest();assert.equal(store.list().length,0,'countdown creates no recording');
 stats.setRunning(true,now);recorder.timing(true,snapshot(),stats.summary(now));
 now+=1000;ingest();sample();now+=1000;ingest();sample();
 stats.setRunning(false,now);recorder.timing(false,snapshot(),stats.summary(now));
 now+=10000;ingest();sample();
 stats.setRunning(true,now);recorder.timing(true,snapshot(),stats.summary(now));
 now+=1000;ingest();sample();
 // A signal outage leaves unknown data absent, never a synthetic zero.
 now+=6000;stats.ingest({...snapshot(),connected:false},now);recorder.sample({...snapshot(),connected:false},stats.summary(now));
 stats.setRunning(false,now);recorder.finish(reason,snapshot(),stats.summary(now));
 return {store,root,ride:store.get('test-ride-001')};
}
test('FIT roundtrip preserves raw SI metrics, pause events, totals and missing data',t=>{
 const {store,ride}=recording(t);const bytes=store.fit(ride.id),d=new Decoder(Stream.fromByteArray(bytes));assert.equal(d.isFIT(),true);assert.equal(d.checkIntegrity(),true);
 const {messages:m,errors}=d.read();assert.deepEqual(errors,[]);
 assert.equal(m.fileIdMesgs[0].type,'activity');assert.equal(m.sessionMesgs[0].sport,'cycling');assert.equal(m.sessionMesgs[0].subSport,'indoorCycling');
 const first=m.recordMesgs[0];assert.equal(first.power,231);assert.equal(first.speed,10);assert.equal(first.cadence,83);assert.equal(first.resistance,42);assert.equal(first.heartRate,135);
 assert.ok(!('power' in m.recordMesgs.at(-1)));assert.ok(!('heartRate' in m.recordMesgs.at(-1)));
 assert.deepEqual(m.eventMesgs.map(e=>e.eventType),['start','stopAll','start','stopAll']);
 assert.equal(m.sessionMesgs[0].totalElapsedTime,19);assert.equal(m.sessionMesgs[0].totalTimerTime,9);assert.equal(m.activityMesgs[0].numSessions,1);
 assert.ok(Math.abs(m.sessionMesgs[0].totalDistance-80)<.1);
 assert.equal(statSync(store.file(ride.id,'.fit')).mode&0o777,0o600);
 assert.throws(()=>store.fit('../secrets'));assert.throws(()=>store.begin(ride.id,'again',42),/already ended/);
});
test('journal recovers interrupted ride and truncated tail; uncertain submission never automatically reposts',t=>{
 const {root,store}=setup(t);const ride=store.begin('recovery-001','Recovery',42);ride.startedAt=1700000000000;
 store.append(ride,{type:'timer',at:ride.startedAt,running:true,summary:{activeSeconds:0}});
 store.append(ride,{type:'sample',at:ride.startedAt+1000,power:100,summary:{activeSeconds:1}});
 appendFileSync(store.file(ride.id,'.ndjson'),'{"type":"sample"');
 const recovered=new RideStore(root),r=recovered.get(ride.id);assert.equal(r.state,'interrupted');assert.equal(r.sampleCount,1);assert.equal(r.summary.activeSeconds,1);
 assert.equal(new Decoder(Stream.fromByteArray(recovered.fit(r.id))).checkIntegrity(),true);
 assert.equal(recovered.entries(r.id).at(-1).running,false);
 r.upload={state:'submitting'};recovered.save(r);assert.equal(new RideStore(root).get(r.id).upload.state,'uncertain');
});
test('upload queue submits once, polls persisted IDs, handles duplicate success and isolates accounts',async t=>{
 const {store,ride,root}=recording(t);let submits=0,polls=0;
 const strava={status:async()=>({connected:true,canUpload:true,athleteId:42}),uploadActivity:async(file,r)=>{submits++;assert.equal(r.id,ride.id);assert.equal(file.subarray(8,12).toString(),'.FIT');return {id:55};},get:async resource=>{polls++;assert.equal(resource,'uploads/55');return {activity_id:1234};}};
 let now=100000;const queue=new RideUploads(store,strava,{automatic:false,now:()=>now});
 queue.queue(ride);await queue.process();while(queue.busy)await new Promise(r=>setImmediate(r));assert.equal(submits,1);assert.equal(ride.upload.state,'processing');
 const reloaded=new RideStore(root),q2=new RideUploads(reloaded,strava,{automatic:false,now:()=>now});now+=6000;await q2.process();assert.equal(submits,1);assert.equal(polls,1);assert.equal(reloaded.get(ride.id).upload.activityId,'1234');
 q2.queue(reloaded.get(ride.id),true);assert.equal(submits,1);
 ride.upload={state:'queued'};strava.uploadActivity=async()=>({error:'file duplicate of activity 9876'});await queue.process();assert.equal(ride.upload.state,'uploaded');assert.equal(ride.upload.activityId,'9876');
 ride.upload={state:'queued'};strava.status=async()=>({connected:true,canUpload:true,athleteId:99});await queue.process();assert.equal(ride.upload.state,'blocked');
});
test('ambiguous POST requires explicit retry, rate limits retry later, local file always survives',async t=>{
 const {store,ride}=recording(t);let calls=0,now=100000;
 const strava={status:async()=>({connected:true,canUpload:true,athleteId:42}),uploadActivity:async()=>{calls++;throw Error('network');}};
 const queue=new RideUploads(store,strava,{automatic:false,now:()=>now});ride.upload={state:'queued'};await queue.process();assert.equal(ride.upload.state,'uncertain');await queue.process();assert.equal(calls,1);assert.ok(store.fit(ride.id).length>0);
 strava.uploadActivity=async()=>{calls++;throw Object.assign(Error('limited'),{status:429});};ride.upload={state:'queued'};await queue.process();assert.equal(ride.upload.state,'queued');assert.ok(ride.upload.nextAttempt>now);await queue.process();assert.equal(calls,2);
});
test('recording routes download FIT and protect uploads from cross-origin writes',async t=>{
 const {store,ride,root}=recording(t,'ended');const bike=new BikeService(root,{platform:'test'});const strava={status:async()=>({connected:false})};
 const server=createAppServer(undefined,{rides:store,bike,strava});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const base=`http://127.0.0.1:${server.address().port}`;
 const list=await (await fetch(base+'/api/rides')).json();assert.equal(list.rides[0].downloadable,true);
 const file=await fetch(base+`/api/rides/${ride.id}/fit`);assert.match(file.headers.get('content-disposition'),/attachment/);assert.equal(Buffer.from(await file.arrayBuffer()).subarray(8,12).toString(),'.FIT');
 const post=(origin,body={})=>fetch(base+`/api/rides/${ride.id}/upload`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('http://evil.test')).status,403);
 ride.upload={state:'uncertain'};assert.equal((await post(base)).status,409);assert.equal((await post(base,{confirmRetry:true})).status,202);
 assert.equal((await fetch(base+'/.data/rides/'+ride.id+'.fit')).status,404);
});


test('bike lifecycle preserves a recording across reconnects, rejects stale controls, and saves early exits',async t=>{
 const {root,store}=setup(t);const bike=new BikeService(root,{platform:'test',rides:store,athleteId:()=>42});t.after(()=>bike.close());
 await bike.start('screen-one',{rideId:'lifecycle-001',name:'Lifecycle'});
 bike.stop('screen-one',{rideId:'lifecycle-001'});assert.equal(store.list().length,0,'cancelled countdown creates no ride');
 await bike.start('screen-one',{rideId:'lifecycle-002',name:'Lifecycle'});
 bike.publish({connected:true,metrics:{Power:{value:205,at:Date.now()}}});
 bike.configure('screen-one',{action:'timing',rideId:'lifecycle-002',recording:true,remainingSeconds:60});
 const same=bike.recorder.ride;await bike.start('screen-one',{rideId:'lifecycle-002'});assert.equal(bike.recorder.ride,same);
 bike.stop('screen-one',{rideId:'old-ride-001'});assert.equal(bike.owner,'screen-one');
 assert.throws(()=>bike.configure('screen-one',{action:'timing',rideId:'old-ride-001',recording:false}),/changed/);
 bike.stop('screen-one',{rideId:'lifecycle-002'});assert.equal(store.get('lifecycle-002').state,'ended');assert.ok(store.fit('lifecycle-002').length);
 await assert.rejects(bike.start('screen-one',{rideId:'lifecycle-002'}),e=>e.code==='recording-ended');
});

test('known workout deadline saves completion without a browser finish request',async t=>{
 const {root,store}=setup(t);const bike=new BikeService(root,{platform:'test',rides:store});t.after(()=>bike.close());
 await bike.start('screen-one',{rideId:'deadline-001',name:'Deadline'});
 bike.publish({connected:true,metrics:{Power:{value:0,at:Date.now()}}});
 bike.configure('screen-one',{action:'timing',recording:true,remainingSeconds:0});
 await new Promise(r=>setTimeout(r,1100));
 assert.equal(bike.owner,null);assert.equal(store.get('deadline-001').state,'completed');assert.equal(store.get('deadline-001').sampleCount>0,true,'measured zero is valid data');
});

test('Strava block description uses time-weighted raw metrics, excludes pauses and distinguishes zeros from missing data',t=>{
 const {store}=setup(t);let now=0;const stats=new RideMetrics(0),r=new RideRecorder(store,{now:()=>now,wallNow:()=>1700000000000});
 const sample=(power,cadence,resistance,connected=true)=>({connected,metrics:{Power:{value:power,ageMs:0},Cadence:{value:cadence,ageMs:0},Resistance:{value:resistance,ageMs:0}}});
 const summary=()=>stats.summary(now);
 r.begin('block-test-001','Intervals',42,'Three different cadence blocks.');
 stats.ingest(sample(100,90,40),now);r.setBlock({index:0,label:'Warm-up'},summary());stats.setRunning(true,now);r.timing(true,sample(100,90,40),summary());
 now=1000;stats.ingest(sample(200,60,50),now);
 now=3000;stats.ingest(sample(300,80,45),now);r.setBlock({index:1,label:'Work'},summary());
 now=4000;stats.setRunning(false,now);r.timing(false,sample(300,80,45),summary());
 now=14000;stats.ingest(sample(0,0,0),now);stats.setRunning(true,now);r.timing(true,sample(0,0,0),summary());
 now=16000;stats.ingest(sample(0,0,0,false),now);r.setBlock({index:2,label:'Recovery'},summary());
 now=19000;stats.setRunning(false,now);r.finish('complete',sample(0,0,0,false),summary());
 const ride=store.get('block-test-001'),[a,b,c]=ride.blockSummaries;
 assert.equal(a.activeSeconds,3);assert.ok(Math.abs(a.powerWatts-500/3)<1e-9);assert.equal(a.cadenceRpm,70);assert.ok(Math.abs(a.resistance-140/3)<1e-9);
 assert.equal(b.activeSeconds,3);assert.equal(b.powerWatts,100);assert.equal(b.cadenceRpm,80/3);assert.equal(b.resistance,15);
 assert.equal(c.activeSeconds,3);assert.equal(c.powerWatts,null);assert.equal(c.resistance,null);
 assert.match(ride.description,/Three different cadence blocks/);
 assert.match(ride.description,/1\. Warm-up \(0:03\): 166.7 W · 70 rpm · resistance 46.7/);
 assert.match(ride.description,/2\. Work \(0:03\): 100 W · 26.7 rpm · resistance 15/);
 assert.match(ride.description,/3\. Recovery \(0:03\): — W · — rpm · resistance — \[partial data\]/);
 assert.equal(new RideStore(path.dirname(path.dirname(store.dir))).get(ride.id).description,ride.description);
});
