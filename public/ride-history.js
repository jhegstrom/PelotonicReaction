const node=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
const states={local:'Saved on Mac',queued:'Waiting to upload',submitting:'Uploading…',processing:'Processing on Strava…',uploaded:'On Strava',uncertain:'Check Strava before retrying',error:'Upload needs attention',blocked:'Different Strava account'};
export class RideHistory {
  constructor(){this.busy=new Set();this.refresh();setInterval(()=>this.refresh(),10000);}
  async refresh(){
    try{
      const response=await fetch('/api/rides');if(!response.ok)throw Error();const {rides}=await response.json();
      this.render(document.getElementById('recorded-rides'),rides.slice(0,50));
      const completed=document.getElementById('ride-recording-result');
      const last=rides.find(r=>r.id===completed.dataset.rideId&&r.state!=='recording');
      completed.hidden=!last;this.render(completed,last?[last]:[]);
      document.getElementById('ride-history-message').textContent='';
    }catch{document.getElementById('ride-history-message').textContent='Saved rides are unavailable. Check the Mac server.';}
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
