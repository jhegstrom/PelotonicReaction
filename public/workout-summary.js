import { indicatorZones, indicatorTargets, indicatorPosition } from './zone-indicator.js';
import { programTarget, formatProgramTarget } from './target-guidance.js';

import { WORKOUT_PALETTE, zoneColor } from './workout-palette.js';
import { segmentVisuals } from './workout-visuals.js';
const clamp=n=>Math.max(0,Math.min(1,n));
export function normalizedIntensity(value,key,profile){
  if(!Number.isFinite(value)||!profile)return null;
  // Preserve every recorded value, interpolating within the rider's zone bands.
  // Open-ended top zones use the same finite visual extension as the live display.
  const zones=indicatorZones(profile,key);
  return indicatorPosition(zones,value,true)?.position??null;
}
export function summaryTargetLabel(step,key,profile){
  if(key==='hr'||key==='power'){
    const prefix=key==='hr'?'HRZ':'Power zone';
    const explicit=key==='hr'?step.heartRateZone:step.powerZone;
    if(explicit!=null)return `${prefix} ${explicit}`;
    const zones=profile?indicatorZones(profile,key):[];
    const matches=indicatorTargets(zones,programTarget(step,key,profile)).map(i=>zones[i].zone);
    return matches.length?`${prefix} ${matches[0]}${matches.length>1?'–'+matches.at(-1):''}`:`${prefix} unavailable`;
  }
  return key==='cadence'?`${formatProgramTarget(step,key,profile)} rpm`:`RES ${formatProgramTarget(step,key,profile)}`;
}
export function summaryModel(ride,entries){
  const total=ride.summary?.activeSeconds||0,profile=ride.summaryProfile;
  const boundaries=entries.filter(e=>e.type==='block');
  const segments=boundaries.map((entry,i)=>{
    const start=entry.summary?.activeSeconds||0,end=boundaries[i+1]?.summary?.activeSeconds??total,step=entry.block;
    const bars=segmentVisuals(step,profile).map(visual=>({...visual,height:visual.height??.25,label:visual.key?summaryTargetLabel(step,visual.key,profile):step.label}));
    return {start,end,...bars[0],bars,name:step.label};
  }).filter(s=>s.end>s.start);
  return {total,segments,samples:entries.filter(e=>e.type==='sample').map(e=>({time:e.summary?.activeSeconds,hr:normalizedIntensity(e.heartRate,'hr',profile),power:normalizedIntensity(e.power,'power',profile)})),personalized:!!profile};
}
export async function createWorkoutSummary(id,{power=false}={}){
  const response=await fetch(`/api/rides/${encodeURIComponent(id)}/summary`);
  if(!response.ok)throw Error('Unable to load workout summary.');
  const {ride,entries}=await response.json(),model=summaryModel(ride,entries);
  const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1000;
  const c=canvas.getContext('2d'),left=125,right=1450,top=240,bottom=780,w=right-left,h=bottom-top;
  c.fillStyle='#101c2b';c.fillRect(0,0,1600,1000);
  const logo=new Image();logo.src='/assets/pelotonicreaction-logo-512.png';await logo.decode();c.drawImage(logo,70,40,125,125);
  c.fillStyle='#fff';c.font='bold 38px system-ui';c.fillText('PelotonicReaction',220,95);c.font='24px system-ui';c.fillText('WORKOUT SUMMARY',220,137);
  c.fillStyle='#bbc9d9';c.font='20px system-ui';c.fillText('Power zones',left,205);c.textAlign='right';c.fillText('Heart-rate zones',right,205);c.textAlign='left';
  const x=t=>left+(model.total?t/model.total:0)*w,y=n=>bottom-clamp(n)*h;
  // Each axis uses its own zone count, matching targets and sensor traces.
  c.font='18px system-ui';
  for(let zone=1;zone<=7;zone++){
    const yy=y(zone/7);c.strokeStyle='#344254';c.beginPath();c.moveTo(left,yy);c.lineTo(right,yy);c.stroke();
    c.fillStyle=zoneColor(zone,7);c.textAlign='right';c.fillText(`PZ ${zone}`,left-18,yy+6);
  }
  for(let zone=1;zone<=5;zone++){
    const yy=y(zone/5);c.fillStyle=zoneColor(zone,5);c.textAlign='left';c.fillText(`HRZ ${zone}`,right+18,yy+6);
    c.strokeStyle='#bbc9d9';c.beginPath();c.moveTo(right,yy);c.lineTo(right+8,yy);c.stroke();
  }
  c.textAlign='left';

  for(const segment of model.segments)for(const [index,bar] of segment.bars.entries()){const duration=(segment.end-segment.start)/segment.bars.length;const s={...bar,start:segment.start+index*duration,end:segment.start+(index+1)*duration};const width=x(s.end)-x(s.start);c.fillStyle=s.color;c.globalAlpha=.9;c.beginPath();c.roundRect(x(s.start)+1,y(s.height),Math.max(.5,width-2),h*s.height,[Math.min(12,Math.max(0,(width-2)/2)),Math.min(12,Math.max(0,(width-2)/2)),0,0]);c.fill();c.globalAlpha=1;c.strokeStyle='#d5e4f0';c.lineWidth=1.5;c.stroke();
    // Rotate labels so short intervals still retain their target or segment name.
    if(width>=12){c.save();c.beginPath();c.rect(x(s.start),top,width,h);c.clip();c.translate(x(s.start)+width/2+6,bottom-14);c.rotate(-Math.PI/2);c.fillStyle='#101c2b';c.strokeStyle='#ffffff';c.lineWidth=3;c.lineJoin='round';c.font='bold 18px system-ui';c.strokeText(s.label,0,0,h-20);c.fillText(s.label,0,0,h-20);c.restore();}}
  const line=(key,color)=>{c.strokeStyle=color;c.lineWidth=key==='hr'?4:2;c.beginPath();let last=null;for(const s of model.samples){if(s[key]==null||!Number.isFinite(s.time)){last=null;continue;}if(last==null||s.time-last>5)c.moveTo(x(s.time),y(s[key]));else c.lineTo(x(s.time),y(s[key]));last=s.time;}c.stroke();};
  if(power)line('power',WORKOUT_PALETTE.traces.power);line('hr',WORKOUT_PALETTE.traces.hr);
  c.font='20px system-ui';c.fillStyle='#bbc9d9';for(let i=0;i<=5;i++){const seconds=model.total*i/5;c.fillText(`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`,x(seconds)-15,bottom+36);}c.fillText('Active time →',left,bottom+75);
  c.font='18px system-ui';
  for(let i=0;i<7;i++){const lx=100+i*139;c.fillStyle=zoneColor(i+1,7);c.fillRect(lx,895,18,18);c.fillStyle='#fff';c.fillText(`Level ${i+1}`,lx+25,911);}
  c.fillStyle=WORKOUT_PALETTE.traces.hr;c.fillText('━ HR',1110,911);if(power){c.fillStyle=WORKOUT_PALETTE.traces.power;c.fillText('━ Power',1260,911);}
  c.fillStyle='#bbc9d9';c.font='17px system-ui';c.fillText(model.segments.some(s=>s.bars.some(b=>b.key==='cadence'||b.key==='resistance'))?`Cadence ${WORKOUT_PALETTE.ranges.cadence.join('–')} rpm · Resistance ${WORKOUT_PALETTE.ranges.resistance.join('–')} · linear scales; paired targets share segment width`:model.personalized?'Zone-scaled targets and sensor readings · gaps indicate missing data':'Rider profile unavailable for this older ride · segment heights are illustrative',100,965);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Unable to create PNG.');
  return blob;
}
export function saveWorkoutSummary(blob,id){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`pelotonic-${id}-summary.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export async function downloadWorkoutSummary(id,options){saveWorkoutSummary(await createWorkoutSummary(id,options),id);}
