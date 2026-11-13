import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProfile, validateProfile, zoneAt, zoneRangeLabel, loadProfile, PROFILE_KEY } from '../public/rider-profile.js';
test('64-year-old estimate and portable default have contiguous integer boundaries', async () => {
  const profile = createProfile();
  assert.equal(profile.heartRate.maxBpm, 156);
  assert.deepEqual(profile.heartRate.zones.map(z => [z.minBpm, z.maxBpm]), [[78,93],[94,109],[110,124],[125,140],[141,156]]);
  assert.deepEqual(validateProfile(JSON.parse(JSON.stringify(profile))), profile);
  assert.deepEqual(JSON.parse(await readFile(new URL('../public/rider-profile.default.json', import.meta.url))), profile);
});
test('zone edges, out-of-range and missing values are classified without clamping', () => {
  const p = createProfile();
  for (const z of p.heartRate.zones) {
    assert.equal(zoneAt(z.minBpm, p).zone, z.zone); assert.equal(zoneAt(z.maxBpm, p).zone, z.zone);
  }
  assert.equal(zoneAt(77, p).label, 'Below Z1'); assert.equal(zoneAt(157, p).label, 'Above Z5');
  assert.equal(zoneAt(null, p), null); assert.equal(zoneAt(NaN, p), null);
  assert.equal(zoneAt(93.5, p).zone, 1); assert.equal(zoneRangeLabel([135,145], p), 'Z4–Z5');
});
test('custom profiles retain preferences; invalid versions, overlaps, gaps and formula mismatches fail', () => {
  const p = createProfile(); p.preferences.heartRateDisplay = 'zone'; p.heartRate.maxMethod = 'manual';
  assert.equal(validateProfile(p).preferences.heartRateDisplay, 'zone');
  for (const mutate of [p=>p.schemaVersion=2,p=>p.heartRate.zones[1].minBpm=93,p=>p.heartRate.zones[1].minBpm=95,p=>p.ageYears=65,p=>p.preferences.heartRateDisplay='bad']) {
    const bad=createProfile(); mutate(bad); assert.throws(()=>validateProfile(bad));
  }
});
test('browser save/load migrates preferences and roundtrips a portable profile', () => {
  const values = new Map([['pr-bike-speed','"mph"'],['pr-bike-average','5']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key,value)=>values.set(key,value) };
  const p=loadProfile(storage); assert.equal(p.preferences.speedUnit,'mph'); assert.equal(p.preferences.powerAverageSeconds,5);
  assert.ok(values.has(PROFILE_KEY)); assert.deepEqual(loadProfile(storage),p);
});

test('FTP is optional, portable and migrated without inventing a rider value',()=>{
  const old=createProfile(); delete old.power;
  assert.deepEqual(validateProfile(old).power,{ftpWatts:null});
  const p=createProfile(); p.power.ftpWatts=200;
  assert.equal(validateProfile(JSON.parse(JSON.stringify(p))).power.ftpWatts,200);
  for(const ftpWatts of [0,19,1501,200.5,'200']) assert.throws(()=>validateProfile({...p,power:{ftpWatts}}));
});
