import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedIntensity, summaryModel, summaryTargetLabel } from '../public/workout-summary.js';
import { createProfile } from '../public/rider-profile.js';
const profile=createProfile();profile.power.ftpWatts=200;
test('highest personal HR and power zones reach the chart ceiling',()=>{
 assert.equal(normalizedIntensity(157,'hr',profile),1);
 assert.equal(normalizedIntensity(361,'power',profile),1);
 assert.equal(normalizedIntensity(null,'hr',profile),null);
 assert.equal(normalizedIntensity(200,'power',{...profile,power:{ftpWatts:null}}),null);
});
test('actual active segment durations and primary targets are retained',()=>{
 const model=summaryModel({summary:{activeSeconds:90},summaryProfile:profile},[
 {type:'block',summary:{activeSeconds:0},block:{kind:'warmup',label:'Warm up',heartRateZone:2,primaryTargets:['heartRate']}},
 {type:'block',summary:{activeSeconds:60},block:{kind:'work',label:'Sprint',powerZone:7,primaryTargets:['watts']}},
 {type:'sample',summary:{activeSeconds:65},heartRate:150,power:null}]);
 assert.equal(model.segments[0].end,60);assert.equal(model.segments[1].end,90);
 assert.equal(model.segments[1].height,1);assert.equal(model.segments[1].label,'Power zone 7');
 assert.equal(model.samples[0].hr,normalizedIntensity(150,'hr',profile));assert.equal(model.samples[0].power,null);
});
test('older recordings retain segment names without inventing sensor zones',()=>{
 const model=summaryModel({summary:{activeSeconds:10}},[{type:'block',block:{label:'Spin-up'},summary:{activeSeconds:0}}]);
 assert.equal(model.personalized,false);assert.equal(model.segments[0].label,'Spin-up');
});

test('absolute targets become personalized zone labels, including ranges and missing profiles',()=>{
 assert.equal(summaryTargetLabel({heartRate:130},'hr',profile),'HRZ 4');
 assert.equal(summaryTargetLabel({targetRanges:{watts:[140,220]}},'power',profile),'Power zone 2–5');
 assert.equal(summaryTargetLabel({watts:220},'power',null),'Power zone unavailable');
 assert.equal(summaryTargetLabel({heartRateZone:3},'hr',null),'HRZ 3');
});

test('sensor variations within a single zone remain visible and monotonic',()=>{
 for(const [key,values] of [['hr',[130,131,132]],['power',[190,195,200]]]){
   const positions=values.map(value=>normalizedIntensity(value,key,profile));
   assert.ok(positions[0]<positions[1]);assert.ok(positions[1]<positions[2]);
 }
 const imported={...profile,strava:{powerZones:[{zone:1,min:0,max:150},{zone:2,min:150,max:null}]}};
 assert.ok(normalizedIntensity(170,'power',imported)<normalizedIntensity(180,'power',imported));
});
