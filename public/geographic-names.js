// Online geographic context only. Never writes names into a workout or advances a ride.
const endpoint='https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer';
export function nameQueryBounds(west,south,east,north) {
  if (![west,south,east,north].every(Number.isFinite) || east<=west || north<=south || east-west>2 || north-south>2) return null;
  const snap=(n,up)=>Number((Math[up?'ceil':'floor'](n/.05)*.05).toFixed(2));
  return [Math.max(-180,snap(west,false)),Math.max(-90,snap(south,false)),Math.min(180,snap(east,true)),Math.min(90,snap(north,true))];
}
export function namesGeoJSON(responses,bounds) {
  const [w,s,e,n]=bounds,seen=new Set(),features=[];
  for(const response of responses) for(const feature of response.features||[]) {
    const a=feature.attributes||{},g=feature.geometry||{};
    if(typeof a.gaz_name!=='string'||!a.gaz_name.trim())continue;
    // GNIS multipoints are label locations, not river lines or route crossings.
    for(const [lon,lat] of g.points || [[g.x,g.y]]) {
      if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<w||lon>e||lat<s||lat>n)continue;
      const key=`${a.gaz_id}:${lon}:${lat}`;if(seen.has(key))continue;seen.add(key);
      features.push({type:'Feature',properties:{name:a.gaz_name.slice(0,160),kind:a.gaz_featureclass||''},geometry:{type:'Point',coordinates:[lon,lat]}});
    }
  }
  return {type:'FeatureCollection',features};
}
export async function geographicNames(bounds,{signal,fetcher=fetch}={}) {
  const responses=await Promise.all([5,6,7].map(async layer=>{
    const url=new URL(`${endpoint}/${layer}/query`);
    for(const [key,value] of Object.entries({f:'json',where:'1=1',geometry:bounds.join(','),geometryType:'esriGeometryEnvelope',inSR:4326,outSR:4326,outFields:'gaz_id,gaz_name,gaz_featureclass',returnGeometry:true,resultRecordCount:500}))url.searchParams.set(key,value);
    const response=await fetcher(url,{signal});if(!response.ok)throw Error('Geographic names unavailable');
    const data=await response.json();if(data.error)throw Error('Geographic names unavailable');return data;
  }));
  return namesGeoJSON(responses,bounds);
}
