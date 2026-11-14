import { formatProgramTarget, isPrimaryTarget } from './target-guidance.js';
const definitions = [
  { key:'cadence', field:'cadence', label:'RPM' },
  { key:'resistance', field:'resistance', label:'RESISTANCE' },
  { key:'power', field:'watts', zone:'powerZone', label:'POWER' },
  { key:'hr', field:'heartRate', zone:'heartRateZone', label:'HR' },
];
const hasTarget = (step, column) => step[column.field] != null || step.targetRanges?.[column.field] != null || (column.zone && step[column.zone] != null);
export function scheduleColumns(intervals) {
  return definitions.filter(column => intervals.some(step => hasTarget(step,column)));
}
export function scheduleTarget(step, column) {
  if(!hasTarget(step,column))return {text:'—',primary:false};
  const zone=column.zone ? step[column.zone] : null;
  let text;
  if(zone != null && step[column.field] == null && !step.targetRanges?.[column.field]) text=`Z${zone}`;
  else {
    text=formatProgramTarget(step,column.key,null);
    if(column.key==='power')text+=' W';
    if(column.key==='hr')text+=' BPM';
    if(zone != null)text+=` · Z${zone}`;
  }
  return {text,primary:isPrimaryTarget(step,column.key)};
}
