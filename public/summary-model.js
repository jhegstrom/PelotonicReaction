import { indicatorZones, indicatorTargets, indicatorPosition } from './zone-indicator.js';
import { programTarget, formatProgramTarget } from './target-guidance.js';

import { WORKOUT_PALETTE, zoneColor } from './workout-palette.js';
import { segmentVisuals } from './workout-visuals.js';
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
