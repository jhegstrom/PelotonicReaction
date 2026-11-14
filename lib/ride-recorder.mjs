// One unsmoothed sample per second. Wall timestamps are anchored to a monotonic clock.
export class RideRecorder {
  constructor(store, { now=()=>performance.now(), wallNow=Date.now, onFinish=()=>{} }={}) {
    this.store=store;this.now=now;this.wallNow=wallNow;this.onFinish=onFinish;this.ride=null;this.running=false;this.error=null;
  }
  begin(id,name,athleteId,description) { this.block=null;this.recordedBlock=null;this.ride=this.store.begin(id,name,athleteId,description);this.lastSecond=null;this.running=false;this.error=null; }
  setBlock(block, summary) {
    if(!block || !this.ride)return;
    this.block=block;
    if(this.ride.startedAt && this.recordedBlock !== block.index) {
      this.store.append(this.ride,{type:'block',at:this.at(),block,summary});
      this.recordedBlock=block.index;
    }
  }
  at() { return this.anchorWall + Math.max(0,this.now()-this.anchorMono); }
  timing(running, snapshot, summary) {
    if(!this.ride||running===this.running)return;
    if(running&&!this.ride.startedAt) { this.anchorMono=this.now();this.anchorWall=this.wallNow();this.ride.startedAt=this.anchorWall; }
    if(!running)this.sample(snapshot,summary);
    this.store.append(this.ride,{type:'timer',at:this.at(),running,summary});
    this.running=running;this.error=null;
    if(running){this.setBlock(this.block,summary);this.sample(snapshot,summary);}
  }
  sample(snapshot,summary) {
    if(!this.running||!this.ride?.startedAt)return;
    const at=this.at(),second=Math.floor(at/1000);if(second===this.lastSecond)return;
    const value=(name,max)=>{
      const s=snapshot.metrics?.[name];return snapshot.connected&&Number.isFinite(s?.ageMs)&&s.ageMs<=5000&&Number.isFinite(s.value)&&s.value>=0&&s.value<=max?s.value:null;
    };
    this.store.append(this.ride,{type:'sample',at, power:value('Power',65534),cadence:value('Cadence',254),heartRate:value('Heart rate',254),resistance:value('Resistance',100),speedKmh:value('Speed',200),distanceKm:summary.distanceKm,summary});
    this.lastSecond=second;this.error=null;
  }
  finish(reason,snapshot,summary) {
    if(!this.ride)return;
    this.timing(false,snapshot,summary);
    const ride=this.store.finish(this.ride,reason,this.ride.startedAt?this.at():null,summary);
    this.ride=null;this.running=false;this.error=null;if(ride)this.onFinish(ride);
  }
  safe(action) { try { action(); } catch { this.error='Recording could not be saved. Check available disk space on the Mac.'; } }
  status() { return {id:this.ride?.startedAt?this.ride.id:null,running:this.running,error:this.error}; }
}
