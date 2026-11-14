// Durable upload queue. After an ambiguous POST, require a deliberate retry; never
// blindly POST again. Known upload IDs can safely be polled after a restart.
export class RideUploads {
  constructor(store,strava,{now=Date.now,automatic=true}={}) {
    this.store=store;this.strava=strava;this.now=now;this.busy=false;
    if(automatic){this.timer=setInterval(()=>void this.process(),5000);this.timer.unref();}
  }
  queue(ride,manual=false) {
    if(ride.state==='recording'||!ride.sampleCount)throw Object.assign(Error('Record and finish a ride with bike data first.'),{status:409});
    if(['uploaded','queued','submitting','processing'].includes(ride.upload?.state))return ride;
    ride.upload={state:'queued',manual,attempts:0,nextAttempt:0};this.store.save(ride);void this.process();return ride;
  }
  complete(ride) {
    if(ride.state==='completed'&&ride.sampleCount&&ride.athleteId) this.queue(ride);
  }
  result(ride,result) {
    if(result?.activity_id&&/^\d+$/.test(String(result.activity_id)))ride.upload={...ride.upload,state:'uploaded',activityId:String(result.activity_id),message:'Uploaded to Strava.'};
    else if(result?.error) {
      const duplicate=String(result.error).match(/duplicate of activity (\d+)/i);
      ride.upload={...ride.upload,state:duplicate?'uploaded':'error',...(duplicate?{activityId:duplicate[1]}:{}),message:duplicate?'Already on Strava.':String(result.error).slice(0,300)};
    } else if(/^\d+$/.test(String(result?.id_str||result?.id))) ride.upload={...ride.upload,state:'processing',uploadId:String(result.id_str||result.id),message:'Strava is processing the ride.',nextAttempt:this.now()+5000};
    else ride.upload={...ride.upload,state:'uncertain',message:'Strava did not return an upload ID. Check Strava before retrying.'};
    this.store.save(ride);
  }
  async process() {
    if(this.busy)return;this.busy=true;
    try {
      for(const ride of this.store.rides.values()) {
        const u=ride.upload;
        if(!['queued','processing'].includes(u?.state)||(u.nextAttempt||0)>this.now())continue;
        const status=await this.strava.status();
        if(!status.connected||!status.canUpload||!status.athleteId||status.needsReconnect) {u.message='Saved locally. Connect Strava with upload permission to sync.';u.nextAttempt=this.now()+30000;this.store.save(ride);continue;}
        if(ride.athleteId&&ride.athleteId!==status.athleteId){u.state='blocked';u.message='This ride belongs to a different Strava account.';this.store.save(ride);continue;}
        // Freeze account ownership before the first upload attempt.
        ride.athleteId=status.athleteId;u.attempts=(u.attempts||0)+1;
        const polling=u.state==='processing';
        if(!polling){u.state='submitting';u.message='Uploading to Strava…';this.store.save(ride);}
        try {
          const result=polling?await this.strava.get(`uploads/${u.uploadId}`):await this.strava.uploadActivity(this.store.fit(ride.id),ride);
          this.result(ride,result);
        } catch(e) {
          if(e.duplicateActivityId){u.state='uploaded';u.activityId=e.duplicateActivityId;u.message='Already on Strava.';}
          else if(polling&&e.status===404){u.state='uncertain';u.message='Strava no longer reports this upload. Check Strava before retrying.';}
          else if(polling||e.status===429||e.beforeSubmit){u.state=polling?'processing':'queued';u.nextAttempt=this.now()+Math.min(300000,15000*2**Math.min(u.attempts,4));u.message=e.status===429?'Strava rate limit reached; retrying later.':'Waiting for Strava; retrying automatically.';}
          else if([400,401,403,404,413,422].includes(e.status)){u.state='error';u.message=e.message;}
          else {u.state='uncertain';u.message='Upload response was lost. Check Strava before retrying to avoid a duplicate.';}
          this.store.save(ride);
        }
      }
    } catch { /* Disk/network problems must not interrupt the timer or bike. */ }
    finally {this.busy=false;}
  }
  close(){clearInterval(this.timer);}
}
