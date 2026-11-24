import { workoutSummaryUrl } from './workout-summary.js';
const node=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
const states={local:'Saved on Mac',queued:'Waiting to upload',submitting:'Uploading…',processing:'Processing on Strava…',uploaded:'On Strava',uncertain:'Check Strava before retrying',error:'Upload needs attention',blocked:'Different Strava account'};
export class RideHistory {
  constructor(){this.busy=new Set();this.refresh();setInterval(()=>this.refresh(),10000);}
  async refresh(){
    try{
      const response=await fetch('/api/rides');if(!response.ok)throw Error();const {rides}=await response.json();
      this.render(document.getElementById('recorded-rides'),rides.slice(0,50));
      if(this.review)this.updateReview(rides.find(r=>r.id===this.review.id));
      const completed=document.getElementById('ride-recording-result');
      const last=rides.find(r=>r.id===completed.dataset.rideId&&r.state!=='recording');
      completed.hidden=!last;this.render(completed,last?[last]:[]);
      document.getElementById('ride-history-message').textContent='';
    }catch{document.getElementById('ride-history-message').textContent='Saved rides are unavailable. Check the Mac server.';}
  }
  updateReview(ride){
    if(!ride||!this.review)return;
    const {status,link,waiting}=this.review;
    status.textContent=states[ride.upload?.state]||'Saved on Mac';
    const uploaded=ride.upload?.state==='uploaded'&&/^\d+$/.test(ride.upload.activityId);
    link.hidden=!uploaded;waiting.hidden=uploaded;
    if(uploaded)link.href=`https://www.strava.com/activities/${ride.upload.activityId}`;
  }
  openReview(ride){
    if(this.review){this.review.dialog.close();}
    const dialog=node('dialog');dialog.className='ride-share-dialog';
    const heading=node('h2','Share your ride');heading.id='ride-share-title';dialog.setAttribute('aria-labelledby',heading.id);
    const close=node('button','Close');close.className='outline';close.onclick=()=>dialog.close();
    const status=node('p');status.setAttribute('role','status');
    const preview=node('img');preview.alt='Workout summary with segment targets and recorded heart rate and power';preview.hidden=true;
    const message=node('p','Preparing your summary…');message.setAttribute('role','status');
    const save=node('a','1. Download summary PNG');save.className='ride-download';save.setAttribute('download','');save.hidden=true;
    const link=node('a','2. Open ride in Strava ↗');link.className='ride-download';link.target='_blank';link.rel='noopener noreferrer';link.hidden=true;
    const instructions=node('p','After downloading, open the ride in Strava, choose Edit / Add Photos, select the summary PNG from Downloads, and save.');
    const waiting=node('p','If the ride has not uploaded yet, close this preview and use Upload to Strava on the ride. This link appears when Strava finishes processing.');
    dialog.append(heading,close,status,preview,message,save,link,instructions,waiting);document.body.append(dialog);
    const review={id:ride.id,dialog,status,link,waiting,version:0};this.review=review;this.updateReview(ride);
    dialog.addEventListener('close',()=>{review.version++;if(this.review===review)this.review=null;dialog.remove();});
    const render=()=>{
      const version=++review.version;save.hidden=true;message.textContent='Loading your server-saved summary…';
      preview.onload=()=>{if(version!==review.version)return;preview.hidden=false;save.hidden=false;message.textContent='Image saved on the server. Download here or open this app on your Mac to share it.';};
      preview.onerror=()=>{if(version===review.version){preview.hidden=true;message.textContent='Summary could not be loaded. Try again; your ride files remain on the server.';}};
      preview.src=workoutSummaryUrl(ride.id);
      save.href=workoutSummaryUrl(ride.id,{download:true});
    };
    dialog.showModal();render();
  }
  render(container,rides){
    const expanded=new Set([...container.querySelectorAll('article')].filter(row=>row.querySelector('details')?.open).map(row=>row.dataset.rideId));
    container.replaceChildren();if(!rides.length){container.append(node('p','Rides are recorded automatically and saved on the Mac.'));return;}
    for(const ride of rides){
      const row=node('article');row.className='recorded-ride';row.dataset.rideId=ride.id;
      const info=node('div');info.append(node('strong',ride.name));
      const when=new Date(ride.startedAt).toLocaleString();
      const duration=Math.round(ride.summary?.activeSeconds||0);
      const label=ride.state==='recording'?'Recording':ride.state==='completed'?'Completed':ride.state==='interrupted'?'Interrupted':'Ended early';
      info.append(node('p',`${when} · ${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')} active · ${label}`));
      const status=node('p',states[ride.upload?.state]||'Saved on Mac');status.className='subtle';
      if(ride.upload?.message)status.append(document.createTextNode(' · '+ride.upload.message));info.append(status);
      if(ride.description){const details=node('details');details.open=expanded.has(ride.id);details.append(node('summary','Strava description'),node('pre',ride.description));info.append(details);}
      row.append(info);
      if(ride.downloadable){
        const controls=node('div'),review=node('button','Review & share ride');review.className='outline';review.onclick=()=>this.openReview(ride);controls.append(review,node('p','Preview your summary and add it to Strava.'));row.append(controls);
      }
      if(ride.downloadable){const link=node('a','Download FIT');link.className='outline ride-download';link.href=`/api/rides/${encodeURIComponent(ride.id)}/fit`;link.setAttribute('download','');row.append(link);}
      if(ride.upload?.state==='uploaded'&&/^\d+$/.test(ride.upload.activityId)){
        const link=node('a','View on Strava ↗');link.href=`https://www.strava.com/activities/${ride.upload.activityId}`;link.target='_blank';link.rel='noopener noreferrer';row.append(link);
      }else if(ride.downloadable&&ride.sampleCount){
        const pending=['queued','submitting','processing'].includes(ride.upload?.state);
        const button=node('button',pending?'Upload pending':ride.upload?.state==='uncertain'?'Check / retry upload':'Upload to Strava');button.className='outline';button.disabled=pending||this.busy.has(ride.id);
        button.onclick=async()=>{
          let confirmRetry=false;
          if(ride.upload?.state==='uncertain'){
            document.getElementById('ride-upload-dialog').showModal();
            confirmRetry=await new Promise(resolve=>{
              const dialog=document.getElementById('ride-upload-dialog');
              const done=value=>{dialog.close();resolve(value);};
              document.getElementById('ride-upload-retry').onclick=()=>done(true);document.getElementById('ride-upload-cancel').onclick=()=>done(false);dialog.oncancel=e=>{e.preventDefault();done(false);};
            });
            if(!confirmRetry)return;
          }
          this.busy.add(ride.id);button.disabled=true;
          try{const response=await fetch(`/api/rides/${ride.id}/upload`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmRetry})});const data=await response.json();if(!response.ok)throw Error(data.error||'Upload could not be queued.');await this.refresh();}
          catch(e){status.textContent=e.message;}
          finally{this.busy.delete(ride.id);button.disabled=false;}
        };row.append(button);
      }
      container.append(row);
    }
  }
}
