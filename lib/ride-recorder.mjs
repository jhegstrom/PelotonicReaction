import { nullLogger } from './event-log.mjs';
import { routePosition } from '../public/route-position.js';
// One unsmoothed sample per second. Wall timestamps are anchored to a monotonic clock.
export class RideRecorder {
  constructor(store, { now=()=>performance.now(), wallNow=Date.now, onFinish=()=>{}, logger=store.logger||nullLogger }={}) {
    this.logger=logger;this.store=store;this.now=now;this.wallNow=wallNow;this.onFinish=onFinish;this.ride=null;this.running=false;this.error=null;
  }
  begin(id,name,athleteId,description,route,routeOffsetKm=0, summaryProfile=null) { this.block=null;this.recordedBlock=null;this.ride=this.store.begin(id,name,athleteId,description);this.ride.summaryProfile=summaryProfile;this.route=route;this.routeOffsetKm=routeOffsetKm;this.ride.recordingRoute=route;this.ride.routeOffsetKm=routeOffsetKm;this.lastCheckpoint=null;this.ride.virtualRide=Boolean(route?.points?.some(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)));this.lastSecond=null;this.running=false;this.error=null; }
  resume(id) {
    const entries=this.store.entries(id), lastBlock=entries.findLast(e=>e.type==='block');
    this.ride=this.store.resume(id);
    this.block=lastBlock?.block||null;this.recordedBlock=this.block?.index??null;
    this.route=this.ride.recordingRoute;this.routeOffsetKm=this.ride.routeOffsetKm||0;
    this.anchorMono=this.now();this.anchorWall=Math.max(this.wallNow(),entries.at(-1)?.at||0);
    this.lastSecond=null;this.lastCheckpoint=null;this.running=false;this.error=null;
    return this.ride;
  }
  checkpoint(summary) {
    if(!this.ride?.startedAt)return;
    this.store.checkpoint(this.ride,this.at(),summary);this.lastCheckpoint=this.now();
  }
  setBlock(block, summary) {
    if(!block || !this.ride)return;
    this.block=block;
    if(this.ride.startedAt && this.recordedBlock !== block.index) {
      this.store.append(this.ride,{type:'block',at:this.at(),block,summary});
      this.recordedBlock=block.index;this.logger.event('DEBUG','ride.segment_changed',{rideId:this.ride.id,index:block.index});
    }
  }
  at() { return this.anchorWall + Math.max(0,this.now()-this.anchorMono); }
  timing(running, snapshot, summary) {
    if(!this.ride||running===this.running)return;
    const firstStart=running&&!this.ride.startedAt;
    if(running&&!this.ride.startedAt) { this.anchorMono=this.now();this.anchorWall=this.wallNow();this.ride.startedAt=this.anchorWall; }
    if(!running)this.sample(snapshot,summary);
    this.store.append(this.ride,{type:'timer',at:this.at(),running,summary});
    this.running=running;this.error=null;this.logger.event('INFO',firstStart?'ride.started':running?'ride.resumed':'ride.paused',{rideId:this.ride.id,activeSeconds:summary.activeSeconds});
    if(running){this.setBlock(this.block,summary);this.sample(snapshot,summary);}
    else this.checkpoint(summary);
  }
  sample(snapshot,summary) {
    if(!this.running||!this.ride?.startedAt)return;
    const at=this.at(),second=Math.floor(at/1000);if(second===this.lastSecond)return;
    const value=(name,max)=>{
      const s=snapshot.metrics?.[name];return snapshot.connected&&Number.isFinite(s?.ageMs)&&s.ageMs<=5000&&Number.isFinite(s.value)&&s.value>=0&&s.value<=max?s.value:null;
    };
    const position=this.ride.virtualRide ? routePosition(this.route.points, this.routeOffsetKm+(summary.distanceKm ?? 0)) : null;
    const gps=position && Number.isFinite(position.lat) && Number.isFinite(position.lon) ? {lat:position.lat,lon:position.lon,altitude:position.altitude} : {};
    this.store.append(this.ride,{...gps,type:'sample',at, power:value('Power',65534),cadence:value('Cadence',254),heartRate:value('Heart rate',254),resistance:value('Resistance',100),speedKmh:value('Speed',200),distanceKm:summary.distanceKm,summary});
    this.lastSecond=second;this.error=null;
    if(this.lastCheckpoint==null || this.now()-this.lastCheckpoint>=15000)this.checkpoint(summary);
  }
  finish(reason,snapshot,summary) {
    if(!this.ride)return;
    this.timing(false,snapshot,summary);
    const ride=this.store.finish(this.ride,reason,this.ride.startedAt?this.at():null,summary);
    this.ride=null;this.running=false;this.error=null;if(ride)this.onFinish(ride);
  }
  safe(action) { try { action(); } catch(error) { this.logger.event('ERROR','ride.recording_error',{rideId:this.ride?.id,error}); this.error='Recording could not be saved. Check available disk space on the Mac.'; } }
  status() { return {id:this.ride?.startedAt?this.ride.id:null,running:this.running,error:this.error}; }
}
