import { powerZoneRange } from './power-zones.js';
const colors=['#7a8c9b','#559fe0','#68c58c','#e2ca54','#eb9853','#dd666c','#b17bd6'];
const clamp=n=>Math.max(0,Math.min(1,n));
export function indicatorZones(profile,key){
  const imported=key==='hr'?profile.strava?.heartRateZones:profile.strava?.powerZones;
  if(imported?.length)return imported.map(z=>({...z}));
  if(key==='hr')return (profile.heartRate?.zones||[]).map(z=>({zone:z.zone,min:z.minBpm,max:z.maxBpm+1}));
  return Array.from({length:7},(_,i)=>powerZoneRange(i+1,profile.power?.ftpWatts)).filter(Boolean).map(z=>({zone:z.zone,min:z.low,max:z.high===Infinity?null:z.high+1}));
}
export function indicatorPosition(zones,value,fresh){
  if(!zones.length||!fresh||!Number.isFinite(value))return null;
  const index=zones.findIndex(z=>value>=z.min&&(z.max===null||value<z.max));
  if(index<0)return {index:null,position:value<zones[0].min?0:1,outside:value<zones[0].min?'below':'above'};
  const zone=zones[index];
  // Equal-height zone bands. For an open top zone, extend the visual scale by
  // one previous-zone width; '+' explicitly marks the uncapped real range.
  const previous=zones[index-1];
  const visualMax=zone.max??zone.min+(previous?previous.max-previous.min:Math.max(1,zone.min));
  return {index,position:(index+clamp((value-zone.min)/(visualMax-zone.min)))/zones.length,outside:zone.max===null&&value>=visualMax?'above':null};
}
export function indicatorTargets(zones,target){
  if(!target)return [];
  if(target.zone != null)return zones.map((z,i)=>z.zone===target.zone?i:-1).filter(i=>i>=0);
  if(!Number.isFinite(target.low)||!(Number.isFinite(target.high)||target.high===Infinity))return [];
  return zones.map((z,i)=>target.high>=z.min&&(z.max===null||target.low<z.max)?i:-1).filter(i=>i>=0);
}
export class ZoneIndicator {
  constructor(key){
    this.key=key;this.root=document.createElement('div');this.root.className='zone-indicator';this.root.setAttribute('role','img');
    this.track=document.createElement('div');this.track.className='zone-indicator-track';
    this.marker=document.createElement('div');this.marker.className='zone-indicator-marker';this.marker.hidden=true;
    this.root.append(this.track,this.marker);this.signature='';
  }
  render(profile,value,fresh,target=null){
    const zones=indicatorZones(profile,this.key),signature=JSON.stringify(zones),unit=this.key==='hr'?'BPM':'W';
    if(signature!==this.signature){
      this.signature=signature;this.track.replaceChildren();this.bands=zones.map((zone,i)=>{
        const band=document.createElement('span');band.className='zone-indicator-band';band.style.bottom=`${i/zones.length*100}%`;band.style.height=`${100/zones.length}%`;band.style.backgroundColor=colors[i]||colors.at(-1);
        band.textContent=`${zone.zone}${zone.max===null?'+':''}`;
        band.title=`Zone ${zone.zone}: ${zone.min}${zone.max===null?'+':'–'+(zone.max-1)} ${unit}${zone.max===null?'. Open-ended; the display extends by the previous zone width.':''}`;
        this.track.append(band);return band;
      });
    }
    const current=indicatorPosition(zones,value,fresh);
    this.root.dataset.available=String(zones.length>0);
    const targets=indicatorTargets(zones,target);
    for(const [i,band] of (this.bands||[]).entries()){
      band.classList.toggle('current-zone',current?.index===i);
      band.classList.toggle('target-zone',targets.includes(i));
    }
    this.marker.hidden=!current;
    if(current){this.marker.style.bottom=`${current.position*100}%`;this.marker.dataset.outside=current.outside||'';}
    const name=this.key==='hr'?'Heart rate':'Power';
    const label=!zones.length?`${name} zones unavailable. Set FTP or connect a profile with power zones.`:!current?`${name} zones; waiting for fresh data.`:`${name}: ${Math.round(value)} ${unit}, ${current.index===null?current.outside+' profile zones':'Zone '+zones[current.index].zone}${current.outside==='above'?' (above displayed scale)':''}.`;
    const description=label+(targets.length?` Target ${targets.length===1?'zone':'zones'} ${targets.map(i=>zones[i].zone).join(', ')}.`:'');
    this.root.setAttribute('aria-label',description);this.root.title=description;
  }
}
