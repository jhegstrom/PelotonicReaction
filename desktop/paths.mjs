import { mkdir, chmod, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
export async function prepareUserData(appRoot,dataRoot) {
  await mkdir(dataRoot,{recursive:true,mode:0o700});
  await chmod(dataRoot,0o700);
  const workoutsRoot=path.join(dataRoot,'workouts');await mkdir(workoutsRoot,{recursive:true});
  for(const name of (await readdir(path.join(appRoot,'workouts'))).filter(n=>n.endsWith('.json'))) {
    try{await copyFile(path.join(appRoot,'workouts',name),path.join(workoutsRoot,name),1);}catch(e){if(e.code!=='EEXIST')throw e;}
  }
  try {await copyFile(path.join(appRoot,'.env.example'),path.join(dataRoot,'.env.example'),1);}catch(e){if(e.code!=='EEXIST')throw e;}
  return {dataRoot,workoutsRoot};
}
export function desktopPort(env) {
  const port=Number(env.PELOTONIC_PORT||8080);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('PELOTONIC_PORT must be between 1 and 65535.');
  return port;
}
