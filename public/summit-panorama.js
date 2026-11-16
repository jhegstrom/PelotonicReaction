export const PANORAMA_HEIGHT_METRES = 3000;
// Major route high points, not named mountain summits. All distances/heights are SI.
export function majorHighPoints(points, { rise = 60, fall = 40, window = 2500, separation = 1000 } = {}) {
  if(!points?.length)return [];
  const total=points.at(-1).distance, samples=[];let cursor=1;
  for(let d=0;d<=total;d+=100){
    while(cursor<points.length-1 && points[cursor].distance<d)cursor++;
    const a=points[cursor-1],b=points[cursor],f=(d-a.distance)/(b.distance-a.distance);
    samples.push({distance:d,altitude:a.altitude+(b.altitude-a.altitude)*f});
  }
  const smooth=samples.map((p,i)=>({...p,altitude:samples.slice(Math.max(0,i-2),i+3).reduce((s,p)=>s+p.altitude,0)/samples.slice(Math.max(0,i-2),i+3).length}));
  const candidates=[];
  for(let i=1;i<smooth.length-1;i++){
    const p=smooth[i];
    if(p.altitude<smooth[i-1].altitude || p.altitude<=smooth[i+1].altitude)continue;
    const before=smooth.filter(q=>q.distance<p.distance && q.distance>=p.distance-window);
    const after=smooth.filter(q=>q.distance>p.distance && q.distance<=p.distance+window);
    if(p.altitude-Math.min(...before.map(q=>q.altitude))<rise || p.altitude-Math.min(...after.map(q=>q.altitude))<fall)continue;
    candidates.push(p);
  }
  const finish=smooth.at(-1),approach=smooth.filter(p=>p.distance>=finish.distance-window);
  if(approach.length>1 && finish.altitude-Math.min(...approach.map(p=>p.altitude))>=rise && Math.max(...approach.slice(-6).map(p=>p.altitude))-finish.altitude<3)candidates.push(finish);
  const chosen=[];
  for(const p of candidates.sort((a,b)=>b.altitude-a.altitude))if(!chosen.some(q=>Math.abs(q.distance-p.distance)<separation))chosen.push(p);
  return chosen.sort((a,b)=>a.distance-b.distance);
}
export function crossedSummit(peaks, seen, previous, current) {
  if(!Number.isFinite(previous)||current<previous||current-previous>500)return null;
  return peaks.find(p=>!seen.has(p.distance)&&previous<p.distance&&current>=p.distance)||null;
}
export function panoramaFrame(elapsed, bearing) {
  // One wide orbit, then return directly to route following.
  if(elapsed<3000)return {phase:'approach',bearing};
  if(elapsed<18000)return {phase:'orbit',bearing:bearing+360*(elapsed-3000)/15000};
  return {phase:'done',bearing:bearing+360};
}

function offsetLocation(point,metres,bearing) {
  const rad=Math.PI/180,angle=metres/6371008.8,heading=bearing*rad,lat=point.lat*rad,lon=point.lon*rad;
  const nextLat=Math.asin(Math.sin(lat)*Math.cos(angle)+Math.cos(lat)*Math.sin(angle)*Math.cos(heading));
  const nextLon=lon+Math.atan2(Math.sin(heading)*Math.sin(angle)*Math.cos(lat),Math.cos(angle)-Math.sin(lat)*Math.sin(nextLat));
  return [nextLon/rad,nextLat/rad];
}
export function panoramaPlan(point,terrainElevation) {
  const center=[point.lon,point.lat],targetAltitude=terrainElevation(center),radius=9000;
  // Sample once and hold a fixed absolute height for the circular orbit.
  // Following fresh DEM samples every frame caused vertical bumps during rotation.
  let highest=targetAltitude;
  for(let bearing=0;bearing<360;bearing+=10)highest=Math.max(highest,terrainElevation(offsetLocation(point,radius,bearing)));
  return {radius,targetAltitude,altitude:highest+PANORAMA_HEIGHT_METRES};
}
export function panoramaCamera(point,frame,terrainElevation,plan=panoramaPlan(point,terrainElevation)) {
  const center=[point.lon,point.lat];
  return {location:offsetLocation(point,plan.radius,frame.bearing+180),altitude:plan.altitude,target:center,targetAltitude:plan.targetAltitude};
}
