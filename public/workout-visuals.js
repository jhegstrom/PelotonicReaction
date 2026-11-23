import { WORKOUT_PALETTE, zoneColor, rangePosition, levelColor } from './workout-palette.js';
import { indicatorZones, indicatorPosition } from './zone-indicator.js';
import { programTarget, TARGET_FIELDS } from './target-guidance.js';
export function valueVisual(value,key,profile){
  if(key in WORKOUT_PALETTE.ranges){const height=rangePosition(value,key);return {height,color:levelColor(height)};}
  const zones=profile?indicatorZones(profile,key):[];
  const position=indicatorPosition(zones,value,true);
  return {height:position?.position??null,color:position?zoneColor((position.index??(position.outside==='below'?0:zones.length-1))+1,zones.length):WORKOUT_PALETTE.unknown};
}
export function targetVisual(step,key,profile){
  const zone=key==='hr'?step?.heartRateZone:key==='power'?step?.powerZone:null;
  if(zone!=null){const count=key==='hr'?5:7;return {key,height:zone/count,color:zoneColor(zone,count)};}
  const target=programTarget(step,key,profile);
  if(!target)return {key,height:null,color:WORKOUT_PALETTE.unknown};
  const value=Number.isFinite(target.high)?(target.low+target.high)/2:target.low;
  return {key,...valueVisual(value,key,profile)};
}
export function segmentVisuals(step,profile){
  const available=Object.keys(TARGET_FIELDS).filter(key=>programTarget(step,key,profile)||(key==='hr'&&step?.heartRateZone)||(key==='power'&&step?.powerZone));
  const primary=available.filter(key=>step?.primaryTargets?.includes(TARGET_FIELDS[key]));
  const candidates=primary.length?primary:available;
  // Physiological primary targets define one bar; cadence + resistance retain two.
  const keys=candidates.includes('hr')?['hr']:candidates.includes('power')?['power']:candidates;
  return keys.length?keys.map(key=>targetVisual(step,key,profile)):[{key:null,height:null,color:WORKOUT_PALETTE.unknown}];
}
export function segmentStyle(step,profile){
  const visuals=segmentVisuals(step,profile),colors=visuals.map(v=>v.color);
  return {height:Math.max(.04,...visuals.map(v=>v.height??.25)),color:colors[0],background:colors.length===1?colors[0]:`linear-gradient(to right, ${colors.map((color,i)=>`${color} ${i/colors.length*100}%, ${color} ${(i+1)/colors.length*100}%`).join(', ')})`};
}
