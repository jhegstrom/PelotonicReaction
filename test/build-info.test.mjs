import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBuildInfo, readBuildInfo } from '../lib/build-info.mjs';
function setup(t){const root=mkdtempSync(path.join(os.tmpdir(),'pr-build-info-'));t.after(()=>rmSync(root,{recursive:true,force:true}));writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'1.0.2'}));return root;}
test('build metadata records package version, CI build number, commit, dirty state and timestamp',t=>{
 const root=setup(t),commit='a'.repeat(40);
 const info=createBuildInfo(root,{env:{GITHUB_RUN_NUMBER:'42'},now:()=>0,run:(_cmd,args)=>({'rev-parse HEAD':commit,'status --porcelain':' M package.json','rev-list --count HEAD':'123'})[args.join(' ')]});
 assert.deepEqual(info,{version:'1.0.2',buildNumber:'42',commit,dirty:true,builtAt:'1970-01-01T00:00:00.000Z'});
 writeFileSync(path.join(root,'build-info.json'),JSON.stringify(info));assert.deepEqual(readBuildInfo(root),info);
});
test('local builds use the Git commit count and source archives degrade gracefully',t=>{
 const root=setup(t),info=createBuildInfo(root,{env:{},run:(_cmd,args)=>args[0]==='rev-parse'?'b'.repeat(40):args[0]==='status'?'':'123'});
 assert.equal(info.buildNumber,'123');assert.equal(info.dirty,false);
 assert.deepEqual(readBuildInfo(root),{version:'1.0.2',buildNumber:null,commit:null,dirty:null,builtAt:null});
 writeFileSync(path.join(root,'build-info.json'),JSON.stringify({...info,version:'0.0.1'}));assert.equal(readBuildInfo(root).buildNumber,null,'stale metadata must not misidentify the release');
});
test('tag/package version mismatch fails packaging before a build starts',()=>{
 const result=spawnSync(process.execPath,['scripts/package.mjs','mac'],{encoding:'utf8',env:{...process.env,GITHUB_REF_TYPE:'tag',GITHUB_REF_NAME:'v999.0.0'}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/does not match package.json version/);
});
