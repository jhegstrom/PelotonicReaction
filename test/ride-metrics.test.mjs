import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RideMetrics, sourceSnapshot } from '../lib/ride-metrics.mjs';
import { liveReading, speedValue, distanceValue } from '../public/live-metrics.js';
const snapshot = (speed=36, cadence=90, power=200, ageMs=0) => ({ connected:true, metrics: Object.fromEntries(Object.entries({ Speed:speed,Cadence:cadence,Power:power }).map(([key,value])=>[key,{value,ageMs}])) });
test('ride integration uses time, raw watts and measured zero values rather than packet counts', () => {
  const ride = new RideMetrics(0);
  ride.ingest(snapshot(),0); ride.setRunning(true,0);
  for (let t=1000;t<=10000;t+=1000) ride.ingest(snapshot(),t);
  let totals=ride.summary(10000);
  assert.equal(totals.speedAverageKmh,36); assert.equal(totals.cadenceAverageRpm,90);
  assert.ok(Math.abs(totals.distanceKm-.1)<1e-9); assert.equal(totals.energyKj,2);
  assert.ok(Math.abs(totals.estimatedCaloriesKcal-2/(4.184*.24))<1e-9);
  ride.ingest(snapshot(0,0,0),10000); ride.ingest(snapshot(0,0,0),15000);
  totals=ride.summary(15000); assert.equal(totals.speedAverageKmh,24); assert.equal(totals.cadenceAverageRpm,60); assert.equal(totals.energyKj,2);
});
test('countdown and pauses are excluded; changing blocks does not reset totals', () => {
  const ride=new RideMetrics(0); ride.ingest(snapshot(),0); ride.ingest(snapshot(),10000);
  assert.equal(ride.summary(10000).energyKj,null);
  ride.setRunning(true,10000); ride.ingest(snapshot(),15000); ride.setRunning(false,15000);
  ride.ingest(snapshot(),25000); assert.equal(ride.summary(25000).energyKj,1);
  ride.setRunning(true,25000); ride.ingest(snapshot(),30000);
  assert.equal(ride.summary(30000).energyKj,2); assert.equal(ride.summary(30000).activeSeconds,10);
});
test('gaps, repeated cached packets and disconnects do not invent distance or energy', () => {
  const ride=new RideMetrics(0); ride.setRunning(true,0); ride.ingest(snapshot(),0);
  ride.ingest(snapshot(36,90,200,5000),5000); ride.ingest(snapshot(36,90,200,15000),15000);
  assert.equal(ride.summary(15000).energyKj,1);
  ride.ingest({connected:false,metrics:{}},15000); ride.ingest(snapshot(),30000); ride.ingest(snapshot(),35000);
  const totals=ride.summary(35000); assert.equal(totals.energyKj,2); assert.equal(totals.coverageSeconds.power,10);
  assert.ok(Math.abs(totals.distanceKm-.1)<1e-9);
});
test('missing metrics remain unknown and an existing total survives absence of another field', () => {
  const ride=new RideMetrics(0); ride.setRunning(true,0);
  ride.ingest({connected:true,metrics:{Power:{value:100,ageMs:0}}},0);
  const result=ride.summary(1000); assert.equal(result.energyKj,.1); assert.equal(result.distanceKm,null); assert.equal(result.cadenceAverageRpm,null);
});
test('browser freshness is independent of the bike wall clock and retains stale last readings', () => {
  const normalized=sourceSnapshot({connected:true, metrics:{Power:{value:222,at:999000}}},1000000);
  assert.equal(normalized.metrics.Power.ageMs,1000);
  assert.equal(liveReading(normalized,'Power',10,100).fresh,true);
  assert.equal(liveReading(normalized,'Power',10,5010).fresh,false);
  assert.equal(liveReading(normalized,'Power',10,5010).value,222);
  assert.equal(liveReading(normalized,'Speed',10,100).value,null);
  assert.equal(speedValue(16.09344,'mph'),10); assert.equal(distanceValue(1.609344,'mph'),1);
});
