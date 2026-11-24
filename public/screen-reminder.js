export const SCREEN_REMINDER_INTERVAL_MS=15*60*1000;

// Wall time, independent of workout elapsed time: pausing the ride must not pause
// a reminder about the tablet's own inactivity timer.
export class RideScreenReminder {
  constructor(root,{now=Date.now,onShow=()=>{}}={}){
    this.root=root;this.now=now;this.onShow=onShow;this.state=null;
    root.querySelector('button').onclick=()=>this.acknowledge();
  }
  restore(saved){
    this.state=saved&&typeof saved.rideId==='string'&&Number.isFinite(saved.nextDueAt)?{rideId:saved.rideId,nextDueAt:Math.min(saved.nextDueAt,this.now()+SCREEN_REMINDER_INTERVAL_MS)}:null;
    this.root.hidden=true;
  }
  snapshot(){return this.state?{...this.state}:null;}
  update({rideId,started}){
    if(!rideId||!started){this.root.hidden=true;this.state=null;return;}
    if(this.state?.rideId!==rideId)this.state={rideId,nextDueAt:this.now()+SCREEN_REMINDER_INTERVAL_MS};
    if(this.now()>=this.state.nextDueAt&&this.root.hidden){this.root.hidden=false;this.onShow();}
  }
  acknowledge(){
    if(!this.state||this.root.hidden)return;
    this.root.hidden=true;this.state.nextDueAt=this.now()+SCREEN_REMINDER_INTERVAL_MS;
  }
  handleInteraction(event){
    // Programmatic scrolling and synthetic events cannot substitute for a rider's
    // physical input or silently dismiss the alert.
    if(event.isTrusted)this.acknowledge();
  }
}
