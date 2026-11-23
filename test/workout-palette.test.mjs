import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKOUT_PALETTE, zoneColor, rangePosition } from '../public/workout-palette.js';
import { targetVisual, valueVisual, segmentVisuals, segmentStyle } from '../public/workout-visuals.js';
import { summaryModel } from '../public/workout-summary.js';
import { createProfile } from '../public/rider-profile.js';
const profile=createProfile();profile.power.ftpWatts=200;
test('five HR colors share seven power palette anchors and endpoints',()=>{
 assert.deepEqual(Array.from({length:5},(_,i)=>zoneColor(i+1,5)),[0,1,3,5,6].map(i=>WORKOUT_PALETTE.levels[i]));
 assert.equal(targetVisual({heartRateZone:5},'hr',profile).color,targetVisual({powerZone:7},'power',profile).color);
 assert.equal(valueVisual(130,'hr',profile).color,targetVisual({heartRate:130},'hr',profile).color);
});
test('cadence and resistance have linear, clamped display scales without modifying targets',()=>{
 for(const [key,low,mid,high] of [['cadence',50,85,120],['resistance',25,52.5,80]]){
  assert.equal(rangePosition(low,key),0);assert.equal(rangePosition(mid,key),.5);assert.equal(rangePosition(high,key),1);
  assert.equal(rangePosition(low-10,key),0);assert.equal(rangePosition(high+10,key),1);
 }
 assert.equal(rangePosition(null,'cadence'),null);
});
test('combined cadence and resistance targets retain two independent bars',()=>{
 const step={label:'Spin',kind:'work',cadence:110,resistance:35,primaryTargets:['cadence','resistance']};
 const before=JSON.stringify(step),visuals=segmentVisuals(step,profile);
 assert.equal(visuals.length,2);assert.ok(visuals[0].height>visuals[1].height);
 const model=summaryModel({summary:{activeSeconds:60},summaryProfile:profile},[{type:'block',summary:{activeSeconds:0},block:step}]);
 assert.equal(model.segments[0].bars.length,2);assert.match(model.segments[0].bars[0].label,/110 rpm/);
 assert.match(segmentStyle(step,profile).background,/linear-gradient/);assert.equal(JSON.stringify(step),before);
});
test('editing one palette entry flows through target, live and summary visuals',()=>{
 const original=WORKOUT_PALETTE.levels[6];
 try{
  WORKOUT_PALETTE.levels[6]='#123456';
  assert.equal(zoneColor(5,5),'#123456');
  assert.equal(valueVisual(400,'power',profile).color,'#123456');
  assert.equal(segmentStyle({powerZone:7},profile).color,'#123456');
  assert.equal(targetVisual({cadence:120},'cadence',profile).color,'#123456');
 }finally{WORKOUT_PALETTE.levels[6]=original;}
});
