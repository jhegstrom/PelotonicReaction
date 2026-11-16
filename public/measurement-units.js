// Internal route data stays in SI units; convert only for presentation.
export const distanceUnit = preference => preference === 'mph' ? 'mi' : 'km';
export function formatRouteDistance(metres, preference = 'km/h', digits = 2) {
  return `${(Math.max(0,metres)/(preference==='mph'?1609.344:1000)).toFixed(digits)} ${distanceUnit(preference)}`;
}
export function formatElevation(metres, preference = 'km/h') {
  return `${Math.round(metres*(preference==='mph'?1/0.3048:1)).toLocaleString('en-US')} ${preference==='mph'?'ft':'m'}`;
}
export function formatNearbyDistance(metres, preference = 'km/h') {
  return metres >= (preference==='mph'?1609.344:1000) ? formatRouteDistance(metres,preference,1) : `${Math.round(metres*(preference==='mph'?1/0.3048:1))} ${preference==='mph'?'ft':'m'}`;
}
export function formatRouteLabel(label, preference = 'km/h') {
  if(preference!=='mph')return label;
  return label.replace(/ · (\d+(?:\.\d+)?)–(\d+(?:\.\d+)?) km$/,(_,start,end)=>` · ${(Number(start)/1.609344).toFixed(1)}–${(Number(end)/1.609344).toFixed(1)} mi`);
}
