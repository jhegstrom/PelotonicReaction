import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programTarget, targetCorrection } from '../public/target-guidance.js';
const target=programTarget({watts:200},'power');
test('scalar thresholds and arrows use correction direction, including exact boundaries',()=>{
  for(const actual of [190,200,210]) assert.equal(targetCorrection(actual,target,true).level,'on');
  assert.deepEqual([targetCorrection(180,target,true).level,targetCorrection(180,target,true).direction],['small','increase']);
  assert.deepEqual([targetCorrection(179,target,true).level,targetCorrection(179,target,true).direction],['large','increase']);
  assert.equal(targetCorrection(220,target,true).level,'small');
  assert.deepEqual([targetCorrection(221,target,true).level,targetCorrection(221,target,true).direction],['large','decrease']);
});
test('hysteresis reduces flicker without retaining arrows inside the ±5% band',()=>{
  const on=targetCorrection(200,target,true);
  assert.equal(targetCorrection(211,target,true,on).level,'on');
  const small=targetCorrection(214,target,true,on); assert.equal(small.level,'small');
  assert.equal(targetCorrection(221,target,true,small).level,'small');
  assert.equal(targetCorrection(223,target,true,small).level,'large');
  assert.equal(targetCorrection(209,target,true,small).direction,null);
});
test('explicit ranges, zero targets, missing/stale data and unsupported cumulative targets',()=>{
  const range=programTarget({cadence:80,targetRanges:{cadence:[85,95]}},'cadence');
  assert.equal(targetCorrection(90,range,true).level,'on');
  assert.equal(targetCorrection(84,range,true).direction,'increase');
  assert.equal(targetCorrection(106,range,true).level,'large');
  const zero=programTarget({resistance:0},'resistance');
  assert.equal(targetCorrection(0,zero,true).level,'on');
  assert.equal(targetCorrection(1,zero,true).direction,'decrease');
  assert.equal(targetCorrection(200,target,false).level,'neutral');
  assert.equal(targetCorrection(null,target,true).direction,null);
  assert.equal(programTarget({},'power'),null); assert.equal(programTarget({speed:25},'speed'),null);
});
test('all four supported target fields map to program scalars or explicit ranges',()=>{
  const step={cadence:90,resistance:40,watts:200,heartRate:140};
  for(const [key,value] of [['cadence',90],['resistance',40],['power',200],['hr',140]]) assert.equal(programTarget(step,key).low,value);
});

test('only explicitly primary metrics coach; null or absent primary targets are reference-only', async()=>{
  const {isPrimaryTarget}=await import('../public/target-guidance.js');
  const step={cadence:90,resistance:40,watts:200,primaryTargets:['cadence','resistance']};
  assert.equal(isPrimaryTarget(step,'cadence'),true); assert.equal(isPrimaryTarget(step,'resistance'),true);
  assert.equal(isPrimaryTarget(step,'power'),false); assert.equal(programTarget(step,'power').low,200);
  assert.equal(isPrimaryTarget({...step,primaryTargets:null},'cadence'),false);
  assert.equal(isPrimaryTarget({watts:200},'power'),false);
});
test('FTP power zones resolve as ranges, remain unresolved without FTP and allow open zone 7', async()=>{
  const {powerZoneRange}=await import('../public/power-zones.js');
  assert.deepEqual(Array.from({length:7},(_,i)=>powerZoneRange(i+1,200)).map(z=>[z.low,z.high]),[[0,110],[111,150],[151,180],[181,210],[211,240],[241,300],[301,Infinity]]);
  assert.equal(programTarget({powerZone:3},'power'),null);
  const target=programTarget({powerZone:3},'power',{power:{ftpWatts:200}});
  assert.equal(target.low,151); assert.equal(targetCorrection(165,target,true).level,'on');
  assert.equal(targetCorrection(145,target,true).direction,'increase');
  assert.equal(targetCorrection(500,powerZoneRange(7,200),true).level,'on');
});
