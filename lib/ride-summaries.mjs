import { readFileSync, writeFileSync, renameSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { WORKOUT_PALETTE } from '../public/workout-palette.js';
import { renderWorkoutSummary } from './workout-summary-renderer.mjs';
import { nullLogger } from './event-log.mjs';

// Bump when changing the renderer so old server-side PNGs regenerate on demand.
const RENDER_VERSION=3;
export class RideSummaries {
  constructor(store,{assetsRoot,logger=store.logger||nullLogger,render=renderWorkoutSummary}={}){
    this.store=store;this.logger=logger;this.render=render;this.logoPath=path.join(assetsRoot,'pelotonicreaction-logo-512.png');this.pending=new Map();
  }
  signature(ride){
    const journal=statSync(this.store.file(ride.id,'.ndjson'));
    return createHash('sha256').update(JSON.stringify({version:RENDER_VERSION,palette:WORKOUT_PALETTE,summary:ride.summary,profile:ride.summaryProfile,endedAt:ride.endedAt,size:journal.size,mtime:journal.mtimeMs})).digest('hex');
  }
  async generate(id){
    const ride=this.store.get(id);
    if(ride.state==='recording')throw Object.assign(Error('Finish the ride before viewing its summary.'),{status:409});
    const signature=this.signature(ride),key=id+':'+signature;
    const files=[this.store.file(id,'.summary.png'),this.store.file(id,'.summary-power.png')],meta=this.store.file(id,'.summary-cache.json');
    try{if(JSON.parse(readFileSync(meta,'utf8')).signature===signature&&files.every(existsSync))return files;}catch(error){if(error.code&&error.code!=='ENOENT')this.logger.event('WARN','summary.cache_read_failed',{rideId:id,error});}
    if(this.pending.has(key))return this.pending.get(key);
    const task=(async()=>{
      const entries=this.store.entries(id);
      this.logger.event('INFO','summary.processing_started',{rideId:id});
      const image=await this.render(ride,entries,{logoPath:this.logoPath});
      // Do not publish a stale image if this interrupted ride resumed meanwhile.
      const current=this.store.get(id);
      if(current.state==='recording'||this.signature(current)!==signature)throw Object.assign(Error('Ride changed while its summary was processing. Try again after it finishes.'),{status:409});
      const write=(file,data)=>this.store.write('summary_export',file,id,()=>{
        const temporary=file+'.'+randomUUID()+'.tmp';
        try{writeFileSync(temporary,data,{mode:0o600});renameSync(temporary,file);}
        finally{if(existsSync(temporary))try{unlinkSync(temporary);}catch(error){this.logger.event('ERROR','fs.write_failed',{operation:'summary_temp_cleanup',file:temporary,rideId:id,error});}}
      });
      files.forEach((file)=>write(file,image));write(meta,JSON.stringify({signature,renderVersion:RENDER_VERSION})+'\n');
      this.logger.event('INFO','summary.saved',{rideId:id,files:files.map(file=>path.basename(file))});return files;
    })().catch(error=>{this.logger.event('ERROR','summary.processing_failed',{rideId:id,error});throw error;}).finally(()=>this.pending.delete(key));
    this.pending.set(key,task);return task;
  }
  async png(id,{power=false}={}){const files=await this.generate(id);return readFileSync(files[power?1:0]);}
  complete(ride){void this.generate(ride.id).catch(error=>this.logger.event(error.status===409?'DEBUG':'ERROR','summary.background_failed',{rideId:ride.id,error}));}
  recover(){
    for(const ride of this.store.rides.values())if(ride.state!=='recording'&&ride.upload?.message==='Recovered after server interruption.')this.complete(ride);
  }
}
