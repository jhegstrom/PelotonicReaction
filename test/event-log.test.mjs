import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { EventLogger } from '../lib/event-log.mjs';
import { RideStore } from '../lib/ride-store.mjs';
import { BikeService } from '../lib/bike-service.mjs';
import { createAppServer } from '../server.mjs';

function setup(t,config={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pr-events-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'event-log.config.json'),JSON.stringify({level:'INFO',maxFileBytes:5242880,retainedFiles:5,console:false,disabledEvents:[],...config}));
 let now=Date.UTC(2026,10,23,20);const fallback=[];
 const logger=new EventLogger(root,{now:()=>now,stderr:line=>fallback.push(line)});
 const read=()=>fs.existsSync(logger.file)?fs.readFileSync(logger.file,'utf8').trim().split('\n').map(JSON.parse):[];
 return {root,logger,read,fallback,advance:ms=>{now+=ms;}};
}

test('JSONL events filter by detail, preserve correlation and redact secrets',t=>{
 const f=setup(t);f.logger.event('DEBUG','hidden');
 f.logger.event('INFO','ride.paused',{rideId:'ride-001',access_token:'hidden-secret',nested:{password:'hidden-password'},error:new Error('Bearer hidden-bearer'),url:'https://example.test?code=hidden-code&state=hidden-state'});
 const [entry]=f.read();assert.equal(f.read().length,1);assert.equal(entry.event,'ride.paused');assert.equal(entry.rideId,'ride-001');assert.equal(entry.timestamp,'2026-11-23T20:00:00.000Z');assert.equal(entry.level,'INFO');
 assert.doesNotMatch(JSON.stringify(entry),/hidden-secret|hidden-password|hidden-bearer|hidden-code|hidden-state/);
 assert.equal(fs.statSync(f.logger.file).mode&0o777,0o600);
});

test('configuration reload changes verbosity live and keeps last good settings after invalid edits',t=>{
 const f=setup(t);const update=config=>{fs.writeFileSync(f.logger.configPath,JSON.stringify(config));f.advance(5001);};
 update({level:'FULL',disabledEvents:['quiet']});f.logger.event('FULL','http.request');f.logger.event('INFO','quiet');assert.equal(f.read().length,1);
 fs.writeFileSync(f.logger.configPath,'{broken');f.advance(5001);f.logger.event('DEBUG','still.debug');assert.equal(f.read().length,2);assert.match(f.fallback[0],/log.config_invalid/);
 update({level:'OFF'});f.logger.event('ERROR','disabled');assert.equal(f.read().length,2);
 update({level:'ERROR'});f.logger.event('WARN','suppressed');f.logger.event('ERROR','saved');assert.equal(f.read().at(-1).event,'saved');
});

test('rotation bounds retained files and every rotated line remains valid JSON',t=>{
 const f=setup(t,{maxFileBytes:512,retainedFiles:3});
 for(let i=0;i<30;i++)f.logger.event('INFO','rotation',{index:i,message:'x'.repeat(100)});
 const files=fs.readdirSync(f.logger.directory);assert.equal(files.length,3);assert.equal(f.read().at(-1).index,29);
 for(const file of files){const content=fs.readFileSync(path.join(f.logger.directory,file),'utf8');for(const line of content.trim().split('\n'))assert.doesNotThrow(()=>JSON.parse(line));assert.ok(Buffer.byteLength(content)<=512);}
});

test('logging disk errors fall back to stderr without throwing or recursive floods',t=>{
 const f=setup(t);const logger=new EventLogger(f.root,{stderr:line=>f.fallback.push(line),now:()=>0,io:{...fs,appendFileSync:()=>{throw Object.assign(Error('Disk full'),{code:'ENOSPC'});}}});
 assert.equal(logger.event('INFO','first'),false);assert.equal(logger.event('INFO','second'),false);
 assert.equal(f.fallback.length,1);const fallback=JSON.parse(f.fallback[0]);assert.equal(fallback.event,'log.write_failed');assert.equal(fallback.error.code,'ENOSPC');
});

test('ride file write failures record operation, ride ID and OS error while preserving the failure',t=>{
 const f=setup(t),store=new RideStore(f.root,{logger:f.logger});
 fs.mkdirSync(path.join(f.root,'.data'),{recursive:true});fs.writeFileSync(store.dir,'not a directory');
 const ride=store.begin('file-error-001','Test');
 assert.throws(()=>store.save(ride));const event=f.read().find(e=>e.event==='fs.write_failed');assert.equal(event.rideId,ride.id);assert.equal(event.operation,'ride_metadata');assert.ok(event.error.code);
});

test('connection transitions and ride pause/resume are logged once per change, without sensor values',async t=>{
 const f=setup(t),store=new RideStore(f.root,{logger:f.logger});let now=0;
 const bike=new BikeService(f.root,{platform:'test',rides:store,logger:f.logger,now:()=>now,wallNow:()=>1700000000000+now});t.after(()=>bike.close());
 await bike.start('screen-events',{rideId:'event-ride-001'});
 const publish=connected=>bike.publish({connected,connectionAttempts:1,metrics:{Power:{value:231,at:1700000000000+now}}});
 publish(true);publish(true);
 const timing=recording=>bike.configure('screen-events',{action:'timing',recording,block:{index:0,label:'Test'},remainingSeconds:60});
 timing(true);timing(true);now=1000;publish(false);timing(false);timing(false);now=2000;publish(true);timing(true);
 const events=f.read(),count=event=>events.filter(e=>e.event===event).length;
 assert.equal(count('bike.connected'),1);assert.equal(count('bike.connection_lost'),1);assert.equal(count('bike.reconnected'),1);assert.equal(count('ride.started'),1);assert.equal(count('ride.paused'),1);assert.equal(count('ride.resumed'),1);assert.equal(count('bike.reconnect_attempt'),1);
 assert.doesNotMatch(JSON.stringify(events),/"metrics"|231/);
});

test('server lifecycle and FULL requests are persisted without OAuth query strings',async t=>{
 const f=setup(t,{level:'FULL'}),bike=new BikeService(f.root,{platform:'test'});
 const server=createAppServer(undefined,{dataRoot:f.root,bike,logger:f.logger});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/rides?code=oauth-secret`);assert.equal(response.status,200);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 const events=f.read();assert.ok(events.some(e=>e.event==='server.started'));assert.ok(events.some(e=>e.event==='server.stopped'));assert.ok(events.some(e=>e.event==='http.request'&&e.path==='/api/rides'));assert.doesNotMatch(JSON.stringify(events),/oauth-secret/);
});

test('stale telemetry logs loss and recovery once without serializing readings',async t=>{
 const f=setup(t),store=new RideStore(f.root,{logger:f.logger});let now=0;
 const bike=new BikeService(f.root,{platform:'test',rides:store,logger:f.logger,now:()=>now,wallNow:()=>1700000000000+now});t.after(()=>bike.close());
 await bike.start('screen-events',{rideId:'stale-event-001'});
 const publish=()=>bike.publish({connected:true,metrics:{Power:{value:217,at:1700000000000+now}}});
 publish();bike.configure('screen-events',{action:'timing',recording:true,remainingSeconds:60});
 now=6000;bike.recordTick();now=7000;bike.recordTick();publish();bike.recordTick();
 const events=f.read();assert.equal(events.filter(e=>e.event==='telemetry.stale').length,1);assert.equal(events.filter(e=>e.event==='telemetry.restored').length,1);
 assert.deepEqual(events.find(e=>e.event==='telemetry.stale').metrics,['Power']);assert.doesNotMatch(JSON.stringify(events),/217/);
});

test('lowering retention prunes archives at the next rotation',t=>{
 const f=setup(t,{maxFileBytes:512,retainedFiles:5});
 for(let i=0;i<20;i++)f.logger.event('INFO','old',{message:'x'.repeat(150)});
 assert.equal(fs.readdirSync(f.logger.directory).length,5);
 fs.writeFileSync(f.logger.configPath,JSON.stringify({maxFileBytes:512,retainedFiles:2}));f.advance(5001);
 for(let i=0;i<4;i++)f.logger.event('INFO','new',{message:'x'.repeat(150)});
 assert.equal(fs.readdirSync(f.logger.directory).length,2);
});

test('invalid initial configuration falls back to INFO and new data roots get a config file',t=>{
 const f=setup(t);fs.writeFileSync(f.logger.configPath,'{invalid');
 const logger=new EventLogger(f.root,{stderr:()=>{}});logger.event('DEBUG','hidden');logger.event('INFO','visible');
 assert.equal(f.read().at(-1).event,'visible');assert.equal(f.read().length,1);
 const nested=path.join(f.root,'new-desktop-data'),seeded=new EventLogger(nested);
 assert.equal(JSON.parse(fs.readFileSync(seeded.configPath,'utf8')).level,'INFO');
});
