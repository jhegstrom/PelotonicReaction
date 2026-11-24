import { nullLogger } from './event-log.mjs';
import { stravaId } from '../public/strava-id.js';
import { summarizeBlocks, rideDescription } from './ride-description.mjs';
import { mkdirSync, chmodSync, writeFileSync, appendFileSync, readFileSync, readdirSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { encodeRide } from './fit-file.mjs';
export const validRideId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(id);
export class RideStore {
  constructor(root, {logger=nullLogger}={}) { this.logger=logger;this.dir = path.join(root,'.data','rides'); this.rides = new Map(); this.load(); }
  file(id, extension) { if (!validRideId(id)) throw Error('Invalid ride ID.'); return path.join(this.dir, id + extension); }
  prepare() { mkdirSync(this.dir,{recursive:true,mode:0o700}); chmodSync(this.dir,0o700); }
  write(operation,file,rideId,action) {
    try{return action();}catch(error){this.logger.event('ERROR','fs.write_failed',{operation,file,rideId,error});throw error;}
  }
  save(ride) {
    return this.write('ride_metadata',this.file(ride.id,'.json'),ride.id,()=>{this.prepare(); const file=this.file(ride.id,'.json'), temp=file+'.tmp';
    writeFileSync(temp,JSON.stringify(ride),{mode:0o600});renameSync(temp,file);this.rides.set(ride.id,ride);});
  }
  entries(id) {
    const lines=readFileSync(this.file(id,'.ndjson'),'utf8').trim().split('\n'), entries=[];
    // A process interruption can leave only the last journal line incomplete.
    lines.forEach((line,i)=>{try{entries.push(JSON.parse(line));}catch(e){if(i!==lines.length-1)throw e;}});return entries;
  }
  load() {
    if (!existsSync(this.dir)) return;
    for(const name of readdirSync(this.dir).filter(n=>n.endsWith('.json'))) {
      try {
        const ride=JSON.parse(readFileSync(path.join(this.dir,name),'utf8')); if(!validRideId(ride.id)||name!==ride.id+'.json')continue;
        ride.athleteId=stravaId(ride.athleteId);
        this.rides.set(ride.id,ride);
        if(ride.state==='recording') {
          const entries=this.entries(ride.id), last=entries.at(-1);
          ride.endedAt=last?.at||ride.startedAt;ride.summary=last?.summary||ride.summary;
          ride.sampleCount=entries.filter(e=>e.type==='sample'&&['power','cadence','heartRate','resistance','speedKmh'].some(k=>Number.isFinite(e[k]))).length;
          if(last?.type!=='timer'||last.running)entries.push({type:'timer',running:false,at:ride.endedAt});
          this.write('journal_recovery',this.file(ride.id,'.ndjson'),ride.id,()=>writeFileSync(this.file(ride.id,'.ndjson'),entries.map(e=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600}));
          ride.state='interrupted';ride.upload={state:'local',message:'Recovered after server interruption.'};
          ride.blockSummaries=summarizeBlocks(entries,ride.summary);ride.description=rideDescription(ride);
          this.writeFit(ride,entries);this.save(ride);this.logger.event('WARN','ride.recovered',{rideId:ride.id,sampleCount:ride.sampleCount,activeSeconds:ride.summary.activeSeconds});
        } else if(ride.upload?.state==='submitting') {
          ride.upload.state='uncertain';ride.upload.message='Upload was interrupted. Check Strava before retrying.';this.save(ride);
        }
      } catch(error) { this.logger.event('ERROR','ride.recovery_failed',{file:name,error}); }
    }
  }
  begin(id, name, athleteId, description) {
    if(!validRideId(id))throw Error('Invalid recording ID.');
    if(this.rides.has(id))throw Object.assign(Error('This recording has already ended. Start a new ride.'),{status:409});
    const ride={id,programDescription:typeof description==='string'?description.slice(0,800):'',name:typeof name==='string'&&name.trim()?name.trim().slice(0,120):'PelotonicReaction ride',athleteId:stravaId(athleteId),state:'recording',startedAt:null,endedAt:null,sampleCount:0,summary:{},upload:{state:'local'}};
    return ride;
  }
  resume(id) {
    const ride=this.get(id);
    if(ride.state!=='interrupted' || ride.upload?.state!=='local') {
      throw Object.assign(Error('This ride has already ended or been submitted to Strava. Open the saved ride instead.'),{status:409,code:'recording-ended'});
    }
    const resumed={...ride,state:'recording',endedAt:null,upload:{state:'local'}};
    this.save(resumed);this.logger.event('INFO','ride.recording_restored',{rideId:id,activeSeconds:resumed.summary.activeSeconds});return resumed;
  }
  checkpoint(ride, at, summary) {
    if(!ride?.startedAt)return;
    const entries=this.entries(ride.id);
    const timer=entries.findLast(e=>e.type==='timer');
    // A checkpoint is a complete, decodable FIT snapshot, even while the live
    // journal is running. This stop event belongs only to the exported snapshot.
    if(timer?.running)entries.push({type:'timer',at,running:false});
    this.writeFit({...ride,endedAt:at,summary},entries);
    this.save(ride);this.logger.event('DEBUG','ride.fit_checkpoint',{rideId:ride.id,sampleCount:ride.sampleCount});
  }
  append(ride, entry) {
    this.write('journal_append',this.file(ride.id,'.ndjson'),ride.id,()=>{this.prepare();appendFileSync(this.file(ride.id,'.ndjson'),JSON.stringify(entry)+'\n',{mode:0o600});});
    if(entry.type==='sample'&&['power','cadence','heartRate','resistance','speedKmh'].some(key=>Number.isFinite(entry[key])))ride.sampleCount++;
    if(entry.summary)ride.summary=entry.summary;
    if(!this.rides.has(ride.id))this.save(ride);
  }
  writeFit(ride, entries=this.entries(ride.id)) {
    const file=this.file(ride.id,'.fit'), temp=file+'.tmp';this.write('fit_export',file,ride.id,()=>{writeFileSync(temp,encodeRide(ride,entries),{mode:0o600});renameSync(temp,file);});
  }
  finish(ride, reason, at, summary) {
    if(!ride?.startedAt)return null;
    ride.endedAt=at;ride.summary=summary;ride.state=reason==='complete'?'completed':reason==='timeout'?'interrupted':'ended';
    const entries=this.entries(ride.id);ride.blockSummaries=summarizeBlocks(entries,summary);ride.description=rideDescription(ride);
    this.writeFit(ride,entries);this.save(ride);this.logger.event('INFO','ride.finalized',{rideId:ride.id,reason,state:ride.state,sampleCount:ride.sampleCount,activeSeconds:summary.activeSeconds});return ride;
  }
  get(id) { const ride=this.rides.get(id); if(!ride)throw Object.assign(Error('Ride not found.'),{status:404});return ride; }
  list() { return [...this.rides.values()].sort((a,b)=>b.startedAt-a.startedAt).map(r=>({...r,downloadable:r.state!=='recording'&&existsSync(this.file(r.id,'.fit'))})); }
  fit(id) { const r=this.get(id);if(r.state==='recording')throw Object.assign(Error('Finish the ride before downloading.'),{status:409});return readFileSync(this.file(id,'.fit')); }
}
