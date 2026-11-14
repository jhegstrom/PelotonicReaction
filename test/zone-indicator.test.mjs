import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProfile} from '../public/rider-profile.js';
import {indicatorZones,indicatorPosition,indicatorTargets} from '../public/zone-indicator.js';
test('zone scales prefer imported custom boundaries and otherwise use local HR/FTP',()=>{
 const p=createProfile();assert.equal(indicatorZones(p,'hr')[2].min,110);assert.deepEqual(indicatorZones(p,'power'),[]);
 p.power.ftpWatts=150;const power=indicatorZones(p,'power');assert.equal(power.length,7);assert.deepEqual(power[2],{zone:3,min:113,max:136});assert.equal(power.at(-1).max,null);
 p.strava={heartRateZones:[{zone:1,min:0,max:120},{zone:2,min:120,max:null}],powerZones:[{zone:1,min:0,max:200},{zone:2,min:200,max:null}]};
 assert.deepEqual(indicatorZones(p,'hr'),p.strava.heartRateZones);assert.deepEqual(indicatorZones(p,'power'),p.strava.powerZones);
});
test('current marker interpolates within equal zone bands and changes bands at exact boundaries',()=>{
 const zones=[{zone:1,min:100,max:120},{zone:2,min:120,max:140},{zone:3,min:140,max:160}];
 assert.deepEqual(indicatorPosition(zones,130,true),{index:1,position:.5,outside:null});
 assert.equal(indicatorPosition(zones,120,true).index,1);assert.equal(indicatorPosition(zones,119,true).index,0);
 assert.deepEqual(indicatorPosition(zones,90,true),{index:null,position:0,outside:'below'});assert.deepEqual(indicatorPosition(zones,180,true),{index:null,position:1,outside:'above'});
 assert.equal(indicatorPosition(zones,130,false),null);assert.equal(indicatorPosition(zones,null,true),null);assert.equal(indicatorPosition([],130,true),null);
});
test('open upper zone retains its classification and caps only the visual position',()=>{
 const zones=[{zone:1,min:0,max:100},{zone:2,min:100,max:null}];
 assert.deepEqual(indicatorPosition(zones,150,true),{index:1,position:.75,outside:null});
 assert.deepEqual(indicatorPosition(zones,300,true),{index:1,position:1,outside:'above'});
});

test('active targets highlight explicit zones, scalar zones and all intersecting range zones',()=>{
 const zones=[{zone:1,min:0,max:100},{zone:2,min:100,max:150},{zone:3,min:150,max:null}];
 assert.deepEqual(indicatorTargets(zones,{zone:3,low:150,high:Infinity}),[2]);
 assert.deepEqual(indicatorTargets(zones,{low:100,high:100}),[1]);
 assert.deepEqual(indicatorTargets(zones,{low:99,high:150}),[0,1,2]);
 assert.deepEqual(indicatorTargets(zones,{low:0,high:0}),[0]);
 assert.deepEqual(indicatorTargets(zones,{zone:7,low:100,high:100}),[]);
 assert.deepEqual(indicatorTargets(zones,null),[]);
});
