import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function createBuildInfo(root,{env=process.env,run=execFileSync,now=Date.now}={}){
  const {version}=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
  let commit=null,dirty=null,count=null;
  try{
    const git=args=>run('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    commit=git(['rev-parse','HEAD']);dirty=Boolean(git(['status','--porcelain']));count=git(['rev-list','--count','HEAD']);
  }catch{}
  const candidate=env.GITHUB_RUN_NUMBER||count;
  return {version,buildNumber:/^\d+$/.test(candidate||'')?candidate:null,commit:/^[0-9a-f]{40,64}$/.test(commit||'')?commit:null,dirty,builtAt:new Date(now()).toISOString()};
}
export function readBuildInfo(root){
  const {version}=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
  try{
    const saved=JSON.parse(readFileSync(path.join(root,'build-info.json'),'utf8'));
    if(saved.version!==version)throw Error('Build metadata version mismatch.');
    return {version,buildNumber:saved.buildNumber??null,commit:saved.commit??null,dirty:saved.dirty??null,builtAt:saved.builtAt??null};
  }catch{}
  if(existsSync(path.join(root,'.git')))return {...createBuildInfo(root),builtAt:null};
  return {version,buildNumber:null,commit:null,dirty:null,builtAt:null};
}
