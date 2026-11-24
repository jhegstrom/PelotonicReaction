import { nullLogger } from './event-log.mjs';
import { mkdir, readdir, readFile, writeFile, link, unlink, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { compileWorkout } from '../public/workout.js';
import { programKey } from '../public/tag-profile.js';

export class WorkoutImports {
  constructor(dataRoot,{logger=nullLogger}={}) { this.logger=logger; this.directory=path.join(dataRoot,'.data','imported-workouts'); }
  async list() {
    let files;try{files=await readdir(this.directory);}catch(e){if(e.code==='ENOENT')return {workouts:[],errors:[]};throw e;}
    const workouts=[],errors=[];
    for(const filename of files.filter(f=>f.endsWith('.json')).sort()) {
      try {const workout=JSON.parse(await readFile(path.join(this.directory,filename),'utf8'));workout.tags=compileWorkout(workout).tags;workouts.push({filename,workout,imported:true});}
      catch {errors.push({filename,message:'Saved imported workout could not be read.'});}
    }
    return {workouts,errors};
  }
  mutate(filename, name) {
    const operation = (this.pending || Promise.resolve()).catch(()=>{}).then(async()=>{
      if (!/^[a-f0-9]{64}\.json$/.test(filename)) throw Object.assign(Error('Only saved imported workouts can be changed.'), {status:403});
      const file=path.join(this.directory,filename);
      let workout;
      try {workout=JSON.parse(await readFile(file,'utf8'));}
      catch(error) {if(error.code==='ENOENT')throw Object.assign(Error('Saved workout not found.'),{status:404});throw error;}
      if (name === undefined) {await unlink(file);return {deleted:true};}
      if (typeof name !== 'string' || !name.trim() || name.trim().length>160) throw Object.assign(Error('Give the workout a name (1–160 characters).'),{status:400});
      // Retain the legacy tag-assignment key even though the display name changes.
      workout.id ||= programKey(workout).slice('program:'.length);
      workout.name=name.trim();compileWorkout(workout);
      const temporary=path.join(this.directory,randomUUID()+'.tmp');
      try {await writeFile(temporary,JSON.stringify(workout)+'\n',{flag:'wx',mode:0o600});await rename(temporary,file);}
      finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')this.logger.event('ERROR','fs.write_failed',{operation:'workout_temp_cleanup',file:temporary,error});});}
      return {filename,workout,imported:true};
    });
    this.pending=operation;return operation.catch(error=>{if(error.code)this.logger.event('ERROR','fs.write_failed',{operation:'workout_mutation',file:filename,error});throw error;});
  }
  async save(workout) {
    compileWorkout(workout);
    const filename=createHash('sha256').update(programKey(workout)).digest('hex')+'.json';
    const temporary=path.join(this.directory,randomUUID()+'.tmp');
    try {
      await mkdir(this.directory,{recursive:true,mode:0o700});
      await writeFile(temporary,JSON.stringify(workout)+'\n',{flag:'wx',mode:0o600});
      // Atomic publication without replacing an existing import, even during concurrent requests.
      await link(temporary,path.join(this.directory,filename));
    } catch(error) {
      if(error.code==='EEXIST')throw Object.assign(Error('This workout is already saved in the library.'),{status:409});
      this.logger.event('ERROR','fs.write_failed',{operation:'workout_import',file:filename,error});throw Object.assign(Error('Could not save the workout. Check local disk space and permissions.'),{status:500});
    } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')this.logger.event('ERROR','fs.write_failed',{operation:'workout_temp_cleanup',file:temporary,error});});}
    return {filename,workout,imported:true};
  }
}
