import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { StravaService } from '../lib/strava-service.mjs';
import { stravaEnvironment } from '../lib/strava-config.mjs';
import { createAppServer } from '../server.mjs';
import { createProfile, validateProfile, zoneAt } from '../public/rider-profile.js';
import { effectiveProfile, sanitizeStravaProfile } from '../public/strava-profile.js';
import { programTarget } from '../public/target-guidance.js';
const env = { STRAVA_CLIENT_ID: '123', STRAVA_CLIENT_SECRET: 'secret-value' };
const zones = { heart_rate: { custom_zones: true, zones: [{min:0,max:120},{min:120,max:140},{min:140,max:-1}] }, power: { zones: [{min:0,max:100},{min:100,max:150},{min:150,max:-1}] } };
const athlete = { id:42, firstname:'Test', lastname:'Rider', ftp:210, measurement_preference:'feet', weight:72, sex:'M', bikes:[{id:'b1',name:'Indoor bike',primary:true,distance:123}] };
async function setup(t, options = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(),'pr-strava-')); t.after(()=>rm(base,{recursive:true,force:true}));
  let clock = 1000000000, offline = false, zoneFail = false, invalidRefresh = false, currentAthlete = athlete;
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({url,init});
    if (offline) throw Error('network');
    if (url.endsWith('/oauth/token')) {
      if (invalidRefresh) return Response.json({}, {status:400});
      return Response.json({ access_token:'private-access-'+calls.length, refresh_token:'private-refresh-'+calls.length, expires_at:clock/1000+3600 });
    }
    if (url.endsWith('/athlete/zones')) return Response.json(zoneFail ? {} : zones,{status:zoneFail?503:200});
    if (url.endsWith('/athlete')) return Response.json(currentAthlete);
    return Response.json({});
  };
  const service = new StravaService(base,{ env,fetcher,now:()=>clock,...options }); await service.ready;
  const authorize = async () => {
    const flow=service.begin('http://localhost:8080');
    const params=new URLSearchParams({state:new URL(flow.url).searchParams.get('state'),code:'one-use-code',scope:'read,profile:read_all'});
    await service.callback(params,flow.binding); return {flow,params};
  };
  return {service,base,calls,authorize,advance:n=>clock+=n,setOffline:v=>offline=v,setZoneFail:v=>zoneFail=v,setInvalid:v=>invalidRefresh=v,setAthlete:v=>currentAthlete=v};
}
test('OAuth verifies state, browser binding, expiry, denial, required scopes and replay', async t => {
  const {service:s,authorize,advance}=await setup(t);
  assert.throws(()=>s.begin('http://192.168.1.2:8080'),/Mac/);
  let f=s.begin('http://localhost:8080');
  let p=new URLSearchParams({state:new URL(f.url).searchParams.get('state'),code:'code',scope:'read,profile:read_all'});
  assert.equal(new URL(f.url).searchParams.get('scope'),'read,profile:read_all,activity:write');
  assert.ok(!f.url.includes('secret-value'));
  await assert.rejects(s.callback(p,'wrong-browser'),/match/);
  advance(600001); await assert.rejects(s.callback(p,f.binding),/expired/);
  f=s.begin('http://localhost:8080'); p.set('state',new URL(f.url).searchParams.get('state')); p.set('error','access_denied');
  await assert.rejects(s.callback(p,f.binding),/cancelled/);
  f=s.begin('http://localhost:8080'); p.set('state',new URL(f.url).searchParams.get('state')); p.delete('error');p.set('scope','read');
  await assert.rejects(s.callback(p,f.binding),/profile access/);
  const good=await authorize(); await assert.rejects(s.callback(good.params,good.flow.binding),/expired/);
});
test('profile sync persists rotated tokens privately, coalesces refresh and survives offline/restart', async t => {
  const f=await setup(t); await f.authorize();
  let status=await f.service.status(); assert.equal(status.profile.displayName,'Test Rider'); assert.equal(status.profile.ftpWatts,210);
  assert.equal(status.profile.heartRateZones.at(-1).max,null);
  assert.ok(!JSON.stringify(status).includes('private-')); assert.ok(!JSON.stringify(status).includes('secret-value'));
  assert.equal((await stat(path.join(f.base,'.data','strava.json'))).mode & 0o777,0o600);
  assert.equal((await stat(path.join(f.base,'.data'))).mode & 0o777,0o700);
  const count=f.calls.length; await Promise.all([f.service.refresh(true),f.service.refresh(true),f.service.refresh(true)]); assert.equal(f.calls.length-count,2);
  f.advance(3600000); await f.service.refresh(true);
  const disk=JSON.parse(await readFile(path.join(f.base,'.data','strava.json'),'utf8'));
  assert.match(disk.tokens.refresh_token,/private-refresh-/);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/oauth/token')).length,2);
  f.setOffline(true); await f.service.refresh(true); status=await f.service.status();assert.equal(status.profile.displayName,'Test Rider');assert.match(status.error,/unavailable/);
  const restarted=new StravaService(f.base,{env,fetcher:async()=>{throw Error();}});assert.deepEqual((await restarted.status()).profile,status.profile);
  f.setOffline(false);f.setZoneFail(true);await f.service.refresh(true); status=await f.service.status();assert.equal(status.profile.heartRateZones.length,3);assert.match(status.error,/Zones/);
  f.setAthlete({...athlete,id:99,firstname:'Other'});await f.service.refresh(true);assert.deepEqual((await f.service.status()).profile.heartRateZones,[]);
  f.setInvalid(true);f.advance(3600000);await f.service.refresh(true);assert.equal((await f.service.status()).needsReconnect,true);
  await f.service.disconnect();status=await f.service.status();assert.equal(status.connected,false);assert.equal(status.profile,null);
});
test('imported fields override local values without replacing preferences or fallback data; custom zones drive guidance',()=>{
  const local=createProfile();local.power.ftpWatts=190;local.preferences.powerAverageSeconds=5;
  const snapshot=sanitizeStravaProfile({athleteId:42,displayName:'Test Rider',ftpWatts:210,speedUnit:'mph',heartRateZones:zones.heart_rate.zones,powerZones:zones.power.zones,access_token:'never-export'});
  const p=effectiveProfile(local,snapshot);assert.equal(p.displayName,'Test Rider');assert.equal(p.power.ftpWatts,210);assert.equal(p.preferences.speedUnit,'mph');assert.equal(p.preferences.powerAverageSeconds,5);
  assert.equal(local.displayName,'Rider');assert.equal(local.power.ftpWatts,190);
  assert.equal(zoneAt(120,p).zone,2);assert.equal(zoneAt(220,p).zone,3);
  assert.deepEqual(programTarget({powerZone:2},'power',p),{low:100,high:149,explicitRange:true,zone:2});
  assert.equal(programTarget({powerZone:7},'power',p),null);
  assert.ok(!JSON.stringify(validateProfile(p)).includes('never-export'));
  assert.equal(effectiveProfile(local,{athleteId:42}).power.ftpWatts,190);
  assert.deepEqual(sanitizeStravaProfile({athleteId:42,powerZones:[{min:0,max:100},{min:90,max:-1}]}).powerZones,[]);
});
test('HTTP routes protect mutations, bind OAuth cookie and never serve credentials', async t => {
  const f=await setup(t); const s=createAppServer(undefined,{strava:f.service,rides:{rides:new Map(),list:()=>[]}});s.listen(0,'127.0.0.1');await once(s,'listening');
  t.after(()=>{s.closeAllConnections();return new Promise(resolve=>s.close(resolve));});
  const origin=`http://127.0.0.1:${s.address().port}`;f.service.origin=origin;f.service.redirect=origin+'/api/strava/callback';
  const post=(route,extra={})=>fetch(origin+'/api/strava/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:'{}'});
  assert.equal((await post('connect',{Origin:'http://evil.test'})).status,403);
  assert.equal((await fetch(origin+'/api/strava/connect',{method:'POST'})).status,403);
  const start=await post('connect');const cookie=start.headers.get('set-cookie');assert.match(cookie,/HttpOnly; SameSite=Lax/);
  const flow=await start.json(),p=new URL(flow.url).searchParams;
  const response=await fetch(origin+'/api/strava/callback?'+new URLSearchParams({state:p.get('state'),code:'code',scope:'read,profile:read_all'}),{headers:{Cookie:cookie.split(';')[0]},redirect:'manual'});
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/?strava=connected');
  const status=await (await fetch(origin+'/api/strava/profile')).json();assert.equal(status.connected,true);assert.ok(!JSON.stringify(status).includes('private-'));
  assert.equal((await fetch(origin+'/.data/strava.json')).status,404);
  assert.equal((await fetch(origin+'/.env')).status,404);
});
test('configuration preserves environment overrides and default absence', async t=>{
  const f=await setup(t); assert.equal((await stravaEnvironment(f.base,{STRAVA_CLIENT_ID:'env-id'})).STRAVA_CLIENT_ID,'env-id');
});


test('Strava upload sends a FIT multipart file, stable external ID and trainer flag; read-only grants cannot upload', async t => {
  const f=await setup(t);await f.authorize();
  assert.equal((await f.service.status()).canUpload,false);
  await assert.rejects(f.service.uploadActivity(Buffer.from('fit'),{id:'ride-test-123',athleteId:42,name:'Test'}),/allow activity/);
  f.service.data.scopes.push('activity:write');
  let seen;
  const previous=f.service.fetcher;
  f.service.fetcher=async(url,init)=>{
    if(url.endsWith('/uploads')){seen=init;return Response.json({id:555});}return previous(url,init);
  };
  const result=await f.service.uploadActivity(Buffer.from('FIT-content'),{id:'ride-test-123',athleteId:42,name:'Test workout',description:'Actual block averages:\n1. Work: 130 W · 90 rpm · resistance 40'});
  assert.equal(result.id,555);assert.equal(seen.method,'POST');assert.match(seen.headers.Authorization,/Bearer private-access/);
  assert.equal(seen.body.get('data_type'),'fit');assert.equal(seen.body.get('trainer'),'1');assert.equal(seen.body.get('external_id'),'pelotonic-ride-test-123.fit');assert.equal(seen.body.get('name'),'Test workout');
  assert.equal(await seen.body.get('file').text(),'FIT-content');
  assert.equal(seen.body.get('description'),'Actual block averages:\n1. Work: 130 W · 90 rpm · resistance 40');
  await assert.rejects(f.service.uploadActivity(Buffer.from('fit'),{id:'other-ride',athleteId:999,name:'Other'}),/account used/);
});
