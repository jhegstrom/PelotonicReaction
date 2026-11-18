import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStravaJson } from '../lib/strava-json.mjs';
import { stravaId } from '../public/strava-id.js';
import { sanitizeStravaProfile } from '../public/strava-profile.js';
import { StravaService } from '../lib/strava-service.mjs';
import { RideStore } from '../lib/ride-store.mjs';
import { RideUploads } from '../lib/ride-uploads.mjs';
const large='9223372036854775807';
test('raw Strava JSON preserves large IDs and leaves strings, zones and timestamps intact',()=>{
  const result=parseStravaJson('{"id":9223372036854775807,"activity_id":9007199254740993,"name":"digits 9223372036854775807 and \\"quote\\"","expires_at":1800000000,"weight":72.5,"zone":-1,"scientific":1e2}');
  assert.equal(result.id,large);assert.equal(result.activity_id,'9007199254740993');
  assert.equal(result.name,'digits 9223372036854775807 and "quote"');
  assert.equal(result.expires_at,1800000000);assert.equal(result.weight,72.5);assert.equal(result.zone,-1);assert.equal(result.scientific,100);
  assert.throws(()=>parseStravaJson('{bad}'));
});
test('IDs accept legacy safe integers and decimal strings but reject rounded and invalid IDs',()=>{
  assert.equal(stravaId(42),'42');assert.equal(stravaId(large),large);
  for(const id of [9007199254740992,0,-1,1.5,'0','1e3','-1',null])assert.equal(stravaId(id),null);
  assert.equal(sanitizeStravaProfile({athleteId:large}).athleteId,large);
  assert.equal(sanitizeStravaProfile({athleteId:42}).athleteId,'42');
});
test('profile refresh prefers id_str, retains zones and survives restart with legacy saved IDs',async t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'strava-ids-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  let body='{"id":42,"id_str":"'+large+'","firstname":"Rider"}';
  const options={env:{STRAVA_CLIENT_ID:'test',STRAVA_CLIENT_SECRET:'test'},fetcher:async url=>new Response(url.endsWith('/zones')?'{}':body)};
  const service=new StravaService(root,options);await service.ready;
  service.data={tokens:{access_token:'test',refresh_token:'test',expires_at:9999999999},athleteId:42,profile:{athleteId:42}};await service.save();
  const legacy=new StravaService(root,options);await legacy.ready;assert.equal((await legacy.status()).athleteId,'42');
  await service.refresh(true);assert.equal((await service.status()).athleteId,large);
  assert.equal((await service.status()).profile.athleteId,large);
  body='{"id":9223372036854775807}';await service.refresh(true);assert.equal((await service.status()).athleteId,large);
  const restart=new StravaService(root,options);await restart.ready;assert.equal((await restart.status()).athleteId,large);
});
test('upload polling preserves large IDs across restart and normalizes legacy ride ownership',async t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'strava-upload-ids-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const store=new RideStore(root),ride=store.begin('ride-id-test','Test',42);ride.state='completed';ride.sampleCount=1;ride.upload={state:'processing',uploadId:large};store.save({...ride,athleteId:42});
  const reloaded=new RideStore(root);assert.equal(reloaded.get(ride.id).athleteId,'42');
  const queue=new RideUploads(reloaded,{status:async()=>({connected:true,canUpload:true,athleteId:'42'}),get:async resource=>{assert.equal(resource,'uploads/'+large);return parseStravaJson('{"activity_id":9223372036854775807}');}},{automatic:false});
  await queue.process();assert.equal(reloaded.get(ride.id).upload.activityId,large);assert.equal(reloaded.get(ride.id).upload.state,'uploaded');
  queue.result(ride,{id:1,id_str:large});assert.equal(ride.upload.uploadId,large);
  queue.result(ride,{activity_id:1,activity_id_str:large});assert.equal(ride.upload.activityId,large);
  queue.result(ride,{activity_id:9007199254740992});assert.equal(ride.upload.state,'uncertain');
  ride.upload={state:'processing',uploadId:large};reloaded.save(ride);
  queue.strava.status=async()=>({connected:true,canUpload:true,athleteId:'99'});await queue.process();assert.equal(ride.upload.state,'blocked');
});
