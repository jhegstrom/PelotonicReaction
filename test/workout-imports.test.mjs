import {programKey} from '../public/tag-profile.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {WorkoutImports} from '../lib/workout-imports.mjs';
import {createAppServer} from '../server.mjs';
const workout={schemaVersion:1,id:'persistent-test',name:'Saved ride',steps:[{label:'Steady',durationSeconds:60}]};
test('saved legacy Map workouts appear as Spinulator without changing identity',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pr-import-legacy-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new WorkoutImports(root);await store.save({...workout,tags:['Map','Power Zone']});
 const saved=(await store.list()).workouts[0].workout;
 assert.deepEqual(saved.tags,['Spinulator','Power Zone']);assert.equal(saved.id,workout.id);
});
test('workout storage survives recreation and concurrent duplicates never overwrite',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pr-import-store-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new WorkoutImports(root);
 const results=await Promise.allSettled([store.save(workout),store.save({...workout,name:'Replacement'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 const files=await readdir(store.directory);assert.equal(files.length,1);assert.ok(files[0].endsWith('.json'));
 const before=await readFile(path.join(store.directory,files[0]),'utf8');
 const restored=await new WorkoutImports(root).list();assert.equal(restored.workouts.length,1);assert.equal(restored.workouts[0].workout.id,workout.id);
 await assert.rejects(()=>store.save({...workout,name:'Overwrite'}),e=>e.status===409);
 assert.equal(await readFile(path.join(store.directory,files[0]),'utf8'),before);
});
test('JSON imports remain in catalog after a complete server restart and preserve admin tag rules',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pr-import-server-')),workoutsRoot=path.join(root,'workouts');await mkdir(workoutsRoot);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const start=async()=>{const server=createAppServer(undefined,{dataRoot:root,workoutsRoot,bike:{close(){}},strava:{},rides:{rides:new Map(),list:()=>[]}});server.listen(0,'127.0.0.1');await once(server,'listening');return {server,base:`http://127.0.0.1:${server.address().port}`};};
 const close=async server=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
 let {server,base}=await start();
 try {
  let result=await fetch(base+'/api/workouts/import-json',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({...workout,tags:['Climb'],userTags:['Personal']})});
  assert.equal(result.status,201);assert.deepEqual((await result.json()).workout.tags,[]);
  await close(server);({server,base}=await start());
  const catalog=await(await fetch(base+'/api/workouts')).json();assert.equal(catalog.workouts.length,1);assert.equal(catalog.workouts[0].workout.name,'Saved ride');assert.deepEqual(catalog.errors,[]);
  result=await fetch(base+'/api/workouts/import-json',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(workout)});assert.equal(result.status,409);
  assert.equal((await fetch(base+'/api/workouts/import-json',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify(workout)})).status,403);
  assert.equal((await fetch(base+'/api/workouts/import-json',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'broken'})).status,400);
 } finally {await close(server);}
});
test('storage errors are reported instead of pretending an import was saved',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pr-import-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'.data'),'not a directory');
 await assert.rejects(()=>new WorkoutImports(root).save(workout),e=>e.status===500 && /Could not save/.test(e.message));
});


test('rename keeps imported filename, legacy tag identity and contents; deletion persists',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pr-workout-edit-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new WorkoutImports(root),legacy={...workout,tags:['Spinulator']};delete legacy.id;
 const saved=await store.save(legacy),identity=programKey(legacy);
 await assert.rejects(store.mutate(saved.filename,'  '),e=>e.status===400);
 await assert.rejects(store.mutate(saved.filename,'x'.repeat(161)),e=>e.status===400);
 const renamed=await store.mutate(saved.filename,'  My mountain ride  ');
 assert.equal(renamed.filename,saved.filename);assert.equal(renamed.workout.name,'My mountain ride');assert.equal(programKey(renamed.workout),identity);
 assert.deepEqual(renamed.workout.steps,legacy.steps);assert.deepEqual(renamed.workout.tags,legacy.tags);
 assert.equal((await new WorkoutImports(root).list()).workouts[0].workout.name,'My mountain ride');
 await store.mutate(saved.filename);assert.equal((await new WorkoutImports(root).list()).workouts.length,0);
 await assert.rejects(store.mutate(saved.filename,'Revive'),e=>e.status===404);
 await assert.rejects(store.mutate('../system.json'),e=>e.status===403);
});

test('saved-workout API persists edits, rejects system files and cross-origin requests',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pr-workout-edit-api-')),workoutsRoot=path.join(root,'workouts');await mkdir(workoutsRoot);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const system={...workout,id:'system-test',name:'System workout'};await writeFile(path.join(workoutsRoot,'system.json'),JSON.stringify(system));
 const store=new WorkoutImports(root),saved=await store.save(workout);
 const server=createAppServer(undefined,{dataRoot:root,workoutsRoot,bike:{close(){}},strava:{},rides:{rides:new Map(),list:()=>[]}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const base=`http://127.0.0.1:${server.address().port}`;
 const edit=(filename,method='PATCH',name='Renamed',origin=base)=>fetch(base+'/api/workouts/saved/'+filename,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='PATCH'?{body:JSON.stringify({name})}:{})});
 assert.equal((await edit(saved.filename,'PATCH','Bad','https://other.example')).status,403);
 assert.equal((await edit(saved.filename,'PATCH','')).status,400);
 for(const method of ['PATCH','DELETE'])assert.equal((await edit('system.json',method)).status,403);
 assert.equal((await edit(saved.filename)).status,200);
 let catalog=await(await fetch(base+'/api/workouts')).json();assert.equal(catalog.workouts.find(w=>w.imported).workout.name,'Renamed');assert.equal(catalog.workouts.find(w=>!w.imported).workout.name,'System workout');
 assert.equal((await edit(saved.filename,'DELETE')).status,200);
 catalog=await(await fetch(base+'/api/workouts')).json();assert.equal(catalog.workouts.length,1);assert.equal(catalog.workouts[0].workout.name,'System workout');
 assert.equal(await readFile(path.join(workoutsRoot,'system.json'),'utf8'),JSON.stringify(system));
 assert.equal((await edit(saved.filename,'DELETE')).status,404);
});
