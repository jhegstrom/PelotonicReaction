// The browser only displays/downloads PNGs rendered and saved by the server.
export { normalizedIntensity, summaryTargetLabel, summaryModel } from './summary-model.js';
export function workoutSummaryUrl(id,{download=false}={}){
  const query=new URLSearchParams();if(download)query.set('download','1');
  return `/api/rides/${encodeURIComponent(id)}/summary.png${query.toString()?'?'+query:''}`;
}
export async function createWorkoutSummary(id,options){
  const response=await fetch(workoutSummaryUrl(id,options));
  if(!response.ok)throw Error('Unable to load the server-saved workout summary.');
  return response.blob();
}
export async function downloadWorkoutSummary(id,options){
  const link=document.createElement('a');link.href=workoutSummaryUrl(id,{...options,download:true});link.download=`pelotonic-${id}-summary.png`;link.click();
}
