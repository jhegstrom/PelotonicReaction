import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import {prepareUserData,desktopPort} from '../desktop/paths.mjs';
import {BikeService} from '../lib/bike-service.mjs';
import {createAppServer} from '../server.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('installed user data is seeded once and kept separate from application resources',async t=>{
 const data=await mkdtemp(path.join(os.tmpdir(),'pr-package-'));t.after(()=>rm(data,{recursive:true,force:true}));
 const paths=await prepareUserData(root,data);const name='5-minute-hr-power-zone-test.json';
 assert.ok((await readFile(path.join(paths.workoutsRoot,name),'utf8')).includes('Power Zone Test'));
 await writeFile(path.join(paths.workoutsRoot,name),'custom workout');await writeFile(path.join(data,'.env'),'private local config');
 await prepareUserData(root,data);
 assert.equal(await readFile(path.join(paths.workoutsRoot,name),'utf8'),'custom workout');assert.equal(await readFile(path.join(data,'.env'),'utf8'),'private local config');
 assert.ok(!(await readFile(path.join(data,'.env.example'),'utf8')).match(/STRAVA_CLIENT_SECRET=.+/));
 assert.equal(desktopPort({}),8080);assert.equal(desktopPort({PELOTONIC_PORT:'8091'}),8091);assert.throws(()=>desktopPort({PELOTONIC_PORT:'bad'}));
});
test('packaged Mac helper runs directly without invoking compiler or using an asar working directory',async t=>{
 const calls=[];const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
 const helper='/Applications/Example.app/Contents/Resources/bike-helper/Bridge.app/Contents/MacOS/GrupettoWiFi';
 const bike=new BikeService('/read-only/app.asar',{platform:'darwin',helperPath:helper,launch:(...args)=>{calls.push(args);return child;}});t.after(()=>bike.close());
 await bike.start('screen-packaged');assert.equal(calls.length,1);assert.equal(calls[0][0],helper);assert.deepEqual(calls[0][1],['--bridge']);assert.equal(calls[0][2].cwd,path.dirname(helper));
});
test('server reads user workouts but serves only packaged public resources',async t=>{
 const data=await mkdtemp(path.join(os.tmpdir(),'pr-package-api-'));t.after(()=>rm(data,{recursive:true,force:true}));
 const paths=await prepareUserData(root,data);await writeFile(path.join(data,'.env'),'private secret');
 const server=createAppServer(root,{...paths,bike:new BikeService(root,{platform:'test'})});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const base=`http://127.0.0.1:${server.address().port}`;
 const catalog=await(await fetch(base+'/api/workouts')).json();assert.equal(catalog.workouts.length,7);assert.deepEqual(catalog.errors,[]);
 assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/.data/strava.json')).status,404);assert.equal((await fetch(base+'/desktop/main.mjs')).status,404);
});
