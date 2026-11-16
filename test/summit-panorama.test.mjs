import test from 'node:test';
import assert from 'node:assert/strict';
import {majorHighPoints,crossedSummit,panoramaFrame,panoramaCamera,panoramaPlan} from '../public/summit-panorama.js';
test('major high points ignore small rollers and group a broad summit once',()=>{
 const points=Array.from({length:101},(_,i)=>({distance:i*100,altitude:100+Math.max(0,240-Math.abs(i-35)*8)+Math.max(0,20-Math.abs(i-80)*4)}));
 const peaks=majorHighPoints(points);assert.equal(peaks.length,1);assert.ok(Math.abs(peaks[0].distance-3500)<=200);
 const seen=new Set();assert.equal(crossedSummit(peaks,seen,3300,3600),peaks[0]);
 seen.add(peaks[0].distance);assert.equal(crossedSummit(peaks,seen,3300,3600),null);
 assert.equal(crossedSummit(peaks,new Set(),0,5000),null,'scrubbing over a peak does not trigger a tour');
 assert.equal(crossedSummit(peaks,new Set(),3600,3300),null);
});
test('panorama finishes immediately after a single circular orbit',()=>{
 assert.equal(panoramaFrame(0,20).phase,'approach');
 assert.equal(panoramaFrame(3000,20).bearing,20);assert.equal(panoramaFrame(10500,20).bearing,200);
 assert.equal(panoramaFrame(17999,20).phase,'orbit');
 assert.equal(panoramaFrame(18000,20).phase,'done');assert.equal(panoramaFrame(18000,20).bearing,380);
 assert.equal(panoramaFrame(36000,20).phase,'done');
});
test('a sustained climb finishing at the high point gets a summit panorama',()=>{
 const points=Array.from({length:31},(_,i)=>({distance:i*100,altitude:100+i*6}));
 const peaks=majorHighPoints(points);assert.equal(peaks.length,1);assert.equal(peaks[0].distance,3000);
});
test('orbit stays at least 3000 m above local ground and looks down at the peak',()=>{
 const peak={lat:40,lon:-120},ground=([lon,lat])=>1500-Math.abs(lat-40)*10000;
 const camera=panoramaCamera(peak,panoramaFrame(6000,0),ground);
 assert.ok(camera.altitude-ground(camera.location)>=3000);
 assert.deepEqual(camera.target,[-120,40]);assert.equal(camera.targetAltitude,1500);
 assert.ok(camera.altitude>camera.targetAltitude);assert.notDeepEqual(camera.location,camera.target);
});
test('the circular panorama keeps a fixed altitude even if terrain tiles change later',()=>{
 const point={lat:40,lon:-120},plan=panoramaPlan(point,()=>1500);
 for(const time of [3000,6000,9000,12000,17000]) {
   const camera=panoramaCamera(point,panoramaFrame(time,0),()=>2200,plan);
   assert.equal(camera.altitude,4500);
 }
});
