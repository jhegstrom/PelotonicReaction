import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { summaryModel } from '../public/summary-model.js';
import { WORKOUT_PALETTE, zoneColor } from '../public/workout-palette.js';
const clamp=n=>Math.max(0,Math.min(1,n));
export async function renderWorkoutSummary(ride,entries,{logoPath}={}){
  const model=summaryModel(ride,entries),canvas=createCanvas(1600,1000),logo=await loadImage(await readFile(logoPath));
  const c=canvas.getContext('2d'),left=125,right=1450,top=240,bottom=780,w=right-left,h=bottom-top;
  c.fillStyle='#101c2b';c.fillRect(0,0,1600,1000);
  c.drawImage(logo,70,40,125,125);
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
  line('power',WORKOUT_PALETTE.traces.power);line('hr',WORKOUT_PALETTE.traces.hr);
  c.font='20px system-ui';c.fillStyle='#bbc9d9';for(let i=0;i<=5;i++){const seconds=model.total*i/5;c.fillText(`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`,x(seconds)-15,bottom+36);}c.fillText('Active time →',left,bottom+75);
  const legendRow=(title,count,baseline)=>{
    c.font='20px system-ui';c.fillStyle='#bbc9d9';c.fillText(title,left,baseline);
    for(let zone=1;zone<=count;zone++){
      // Align identical colors vertically across the two zone systems.
      const index=count===5?WORKOUT_PALETTE.hrLevels[zone-1]:zone-1,lx=365+index*110;
      c.fillStyle=zoneColor(zone,count);c.beginPath();c.roundRect(lx,baseline-17,20,20,4);c.fill();
      c.fillStyle='#fff';c.font='18px system-ui';c.fillText(`${count===5?'HRZ':'PZ'} ${zone}`,lx+29,baseline);
    }
  };
  legendRow('Power zones',7,902);legendRow('Heart-rate zones',5,952);
  const traceLegend=(title,color,baseline)=>{
    c.strokeStyle=color;c.lineWidth=3;c.beginPath();c.moveTo(1240,baseline-6);c.lineTo(1270,baseline-6);c.stroke();
    c.fillStyle='#fff';c.font='18px system-ui';c.fillText(title,1283,baseline);
  };
  traceLegend('Heart rate',WORKOUT_PALETTE.traces.hr,902);
  traceLegend('Power',WORKOUT_PALETTE.traces.power,952);
  return canvas.encode('png');
}
