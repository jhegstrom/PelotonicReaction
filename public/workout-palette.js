// Edit this file to change workout colors and display ranges everywhere.
// These are relative target levels, not physiological equivalences between metrics.
export const WORKOUT_PALETTE = {
  levels: ['#94A3B8', '#258CFF', '#00CDE8', '#20D687', '#FFD43B', '#FF922B', '#FF454F'],
  hrLevels: [0, 1, 3, 5, 6],
  ranges: { cadence: [50, 120], resistance: [25, 80] },
  traces: { hr: '#FF70BC', power: '#E3F5FF' },
  unknown: '#94A3B8',
};
const clamp=n=>Math.max(0,Math.min(1,n));
export function zoneColor(zone,count=7){
  if(!Number.isFinite(zone)||count<1)return WORKOUT_PALETTE.unknown;
  const i=Math.max(0,Math.min(count-1,zone-1));
  const index=count===5?WORKOUT_PALETTE.hrLevels[i]:Math.round(i/Math.max(1,count-1)*(WORKOUT_PALETTE.levels.length-1));
  return WORKOUT_PALETTE.levels[index]||WORKOUT_PALETTE.unknown;
}
export function rangePosition(value,key){
  const range=WORKOUT_PALETTE.ranges[key];
  return range&&Number.isFinite(value)?clamp((value-range[0])/(range[1]-range[0])):null;
}
export function levelColor(position){
  return position==null?WORKOUT_PALETTE.unknown:WORKOUT_PALETTE.levels[Math.min(WORKOUT_PALETTE.levels.length-1,Math.floor(clamp(position)*WORKOUT_PALETTE.levels.length))];
}
