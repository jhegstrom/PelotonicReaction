import { majorHighPoints, crossedSummit, panoramaFrame, panoramaCamera, panoramaPlan, PANORAMA_HEIGHT_METRES } from './summit-panorama.js';
import { formatRouteDistance, formatElevation, formatNearbyDistance } from './measurement-units.js';
import { geographicNames, nameQueryBounds } from './geographic-names.js';
import { validateRoute, routePosition } from './route-position.js';
export { validateRoute, routePosition } from './route-position.js';
export function gradeColor(grade) { return grade < -1 ? '#66bce8' : grade < 1.5 ? '#80d4a0' : grade < 5 ? '#f2ca68' : '#f19060'; }
// Preview is deliberately separate from the workout clock and bike recording.
export class RoutePreview {
  constructor(totalMetres, speed = 60) { this.totalMetres = totalMetres; this.speed = speed; this.distanceKm = 0; this.enabled = false; this.running = false; }
  start() { if (this.distanceKm * 1000 >= this.totalMetres) this.distanceKm = 0; this.enabled = true; this.running = true; }
  pause() { this.running = false; }
  advance(seconds) { if (this.running && Number.isFinite(seconds) && seconds > 0) { this.distanceKm = Math.min(this.totalMetres / 1000, this.distanceKm + seconds * this.speed * 25 / 3600); if (this.distanceKm * 1000 >= this.totalMetres) this.running = false; } return this.distanceKm; }
  seek(metres) { this.enabled = true; this.distanceKm = Math.max(0, Math.min(this.totalMetres, metres)) / 1000; if (metres >= this.totalMetres) this.running = false; }
  stop() { this.enabled = false; this.running = false; this.distanceKm = 0; }
}
export function trackBearing(points, metres) {
  const p = routePosition(points, metres / 1000), ahead = routePosition(points, Math.min(points.at(-1).distance, metres + 100) / 1000);
  const behind = routePosition(points, Math.max(0, metres - 100) / 1000);
  const a = ahead.distance === p.distance ? behind : p, b = ahead.distance === p.distance ? p : ahead;
  return Math.atan2((b.lon-a.lon)*Math.cos(p.lat*Math.PI/180), b.lat-a.lat) * 180 / Math.PI;
}
export function smoothBearing(current, target, fraction = .25) { return current + ((target - current + 540) % 360 - 180) * fraction; }
const ns = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) { const node = document.createElementNS(ns, tag); for (const [k,v] of Object.entries(attrs)) node.setAttribute(k,v); return node; }
let mapLibrary;
function loadMapLibrary() {
  if (!mapLibrary) {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/maplibre-gl@6.18.0/dist/maplibre-gl.css'; document.head.append(css);
    mapLibrary = import('https://unpkg.com/maplibre-gl@6.18.0/dist/maplibre-gl.mjs').catch(error => { mapLibrary = null; throw error; });
  }
  return mapLibrary;
}
export class TerrainView {
  constructor(root, { onPreview = () => {} } = {}) {
    this.root = root; this.generation = 0; this.onPreview = onPreview;
    document.addEventListener('fullscreenchange', () => this.syncExpandedView());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (document.fullscreenElement === this.root || this.root.classList.contains('terrain-expanded'))) {
        event.preventDefault(); this.closeExpandedView();
      }
    });
    this.resizeObserver = new ResizeObserver(() => this.map?.resize());
    this.resizeObserver.observe(root);
  }
  syncExpandedView() {
    const expanded = document.fullscreenElement === this.root || this.root.classList.contains('terrain-expanded');
    if (this.expandButton) {
      this.expandButton.textContent = expanded ? 'Exit full screen ↙' : 'Full screen ↗';
      this.expandButton.setAttribute('aria-expanded', String(expanded));
    }
    this.map?.resize();
  }
  closeExpandedView() {
    this.root.classList.remove('terrain-expanded');
    if (document.fullscreenElement === this.root) document.exitFullscreen().catch(() => {});
    this.syncExpandedView();
    this.expandButton?.focus({ preventScroll: true });
  }
  async toggleExpandedView() {
    if (document.fullscreenElement === this.root || this.root.classList.contains('terrain-expanded')) {
      this.closeExpandedView(); return;
    }
    // Keep the existing nodes and map alive so preview, timing and recording continue.
    try {
      if (!this.root.requestFullscreen || !document.fullscreenEnabled) throw Error('Fullscreen unavailable');
      await this.root.requestFullscreen();
    } catch {
      // Embedded browsers may disallow native fullscreen; still fill the app viewport.
      this.root.classList.add('terrain-expanded');
    }
    this.syncExpandedView();
    this.expandButton?.focus({ preventScroll: true });
  }
  destroy() { this.cancelPanorama(false); this.namesAbort?.abort(); this.namesKey=null; this.closeExpandedView(); clearInterval(this.previewTick); this.preview?.stop(); this.onPreview(null); this.preview = null; this.mapReady = false; this.mapLoading = null; this.previewLoading = false; this.generation++; this.map?.remove(); this.map = null; this.marker = null; this.points = null; this.distanceKm = null; this.follow = false; this.landmarks = []; this.root.replaceChildren(); }
  setWorkout(workout) {
    this.destroy();
    if (!workout.tags.some(t => t.toLowerCase() === 'spinulator')) { this.root.hidden = true; return false; }
    this.root.hidden = false;
    this.points = workout.route?.points;
    this.liveDistanceKm = null; this.liveConnected = false; this.previewAllowed = true; this.exaggeration = 1.5;
    this.landmarks = [...(workout.route?.landmarks || [])].sort((a,b) => a.distance-b.distance);
    if (!this.points) { this.root.textContent = 'This Spinulator workout has no route data. Reimport its FIT route to show elevation and terrain.'; return true; }
    const points = this.points, total = points.at(-1).distance;
    this.summits=majorHighPoints(points);this.summitsSeen={preview:new Set(),ride:new Set()};this.summitPrevious={preview:null,ride:null};this.panoramaEnabled=!matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.preview = new RoutePreview(total);
    const heights = points.map(p => p.altitude), min = Math.min(...heights), span = Math.max(20, Math.max(...heights) - min);
    const x = d => 35 + d / total * 530, y = h => 125 - (h - min) / span * 100;
    const profile = this.profile = svg('svg', { viewBox:'0 0 600 155', role:'img' });
    this.profileMin=min;this.profileMax=Math.max(...heights);this.distanceLabels=[];this.elevationLabels=[];
    for (let i = 1; i < points.length; i++) {
      const a = points[i-1], b = points[i];
      profile.append(svg('path', { d:`M${x(a.distance)},140 L${x(a.distance)},${y(a.altitude)} L${x(b.distance)},${y(b.altitude)} L${x(b.distance)},140 Z`, fill:gradeColor(100*(b.altitude-a.altitude)/(b.distance-a.distance)), opacity:'.8' }));
    }
    for (const d of [0,total/2,total]) { const text=svg('text',{x:x(d),y:153,'text-anchor':'middle',fill:'#c3d1da','font-size':12});profile.append(text);this.distanceLabels.push({node:text,distance:d}); }
    for(const [altitude,y] of [[this.profileMax,18],[min,132]]) {const text=svg('text',{x:595,y,'text-anchor':'end',fill:'#fff',stroke:'#111b22','stroke-width':3,'paint-order':'stroke','font-size':12});profile.append(text);this.elevationLabels.push({node:text,altitude});}
    this.updateUnitLabels();
    this.profileMarker = svg('circle', { r:6, fill:'#fff', stroke:'#111', 'stroke-width':2 }); profile.append(this.profileMarker); this.profileXY = p => [x(p.distance),y(p.altitude)];
    const legend = document.createElement('p'); legend.className='terrain-legend';
    for(const [color,label] of [['#66bce8','↓ < −1%'],['#80d4a0','−1–1.5%'],['#f2ca68','1.5–5%'],['#f19060','↑ ≥ 5%']]) {const item=document.createElement('span');item.style.color=color;item.textContent=label;legend.append(item);}
    this.status = document.createElement('p'); this.status.className='terrain-status'; this.status.setAttribute('role','status');
    this.landmark = document.createElement('p'); this.landmark.className='terrain-landmark'; this.landmark.setAttribute('aria-live','polite');
    this.root.append(profile,legend,this.status,this.landmark);
    this.update(null);
    if (!points.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))) { const note=document.createElement('p');note.textContent='GPS coordinates are unavailable. Elevation remains available offline.';this.root.append(note); return true; }
    // Offline bird’s-eye trace is always available, even without WebGL or tiles.
    const cos = Math.cos(points[0].lat*Math.PI/180), xs=points.map(p=>p.lon*cos), ys=points.map(p=>p.lat);
    const minX=Math.min(...xs),maxY=Math.max(...ys), width=Math.max(...xs)-minX,height=maxY-Math.min(...ys),scale=260/Math.max(width,height,.00001);
    this.traceXY=p=>[150+(p.lon*cos-minX-width/2)*scale,150-(p.lat-maxY+height/2)*scale];
    const trace=svg('svg',{viewBox:'0 0 300 300',role:'img','aria-label':'Bird’s-eye GPS route trace',class:'route-trace'});
    trace.append(svg('polyline',{points:points.map(p=>this.traceXY(p).join(',')).join(' '),fill:'none',stroke:'#f2a470','stroke-width':3}));
    this.traceMarker=svg('circle',{r:5,fill:'#fff'});trace.append(this.traceMarker);this.root.append(trace);
    const controls=document.createElement('div');controls.className='terrain-controls';
    this.loadButton=document.createElement('button');this.loadButton.className='outline';this.loadButton.textContent='Load 3D terrain';this.loadButton.onclick=()=>this.loadMap();
    this.followButton=document.createElement('button');this.followButton.className='quiet';this.followButton.textContent='Follow ride';this.followButton.hidden=true;this.followButton.setAttribute('aria-pressed','false');this.followButton.onclick=()=>{this.follow=!this.follow;this.followButton.setAttribute('aria-pressed',String(this.follow));if(this.follow)this.followPosition(true);else {this.cancelPanorama(false);this.map?.stop();}};
    this.overviewButton=document.createElement('button');this.overviewButton.className='quiet';this.overviewButton.textContent='Overview';this.overviewButton.hidden=true;this.overviewButton.onclick=()=>{this.follow=false;this.followButton.setAttribute('aria-pressed','false');this.overview();};
    controls.append(this.loadButton,this.followButton,this.overviewButton);this.root.append(controls);
    this.imageryLabel=document.createElement('label');this.imageryLabel.textContent='Surface ';
    this.imagerySelect=document.createElement('select');this.imagerySelect.setAttribute('aria-label','Map surface');
    for(const [value,label] of [['aerial','Aerial imagery (US)'],['map','Trail map']]){const option=document.createElement('option');option.value=value;option.textContent=label;this.imagerySelect.append(option);}
    this.imagerySelect.onchange=()=>{if(this.mapReady)this.map.setLayoutProperty('aerial','visibility',this.imagerySelect.value==='aerial'?'visible':'none');};this.imageryLabel.append(this.imagerySelect);
    const exaggerationLabel=document.createElement('label');exaggerationLabel.textContent='Terrain ';
    this.exaggerationSelect=document.createElement('select');this.exaggerationSelect.setAttribute('aria-label','Terrain exaggeration');
    for(const value of [1,1.5,2,3]){const option=document.createElement('option');option.value=value;option.textContent=`${value}×`;this.exaggerationSelect.append(option);}this.exaggerationSelect.value='1.5';
    this.exaggerationSelect.onchange=()=>{this.exaggeration=Number(this.exaggerationSelect.value);if(this.mapReady)this.map.setTerrain({source:'elevation',exaggeration:this.exaggeration});};exaggerationLabel.append(this.exaggerationSelect);
    this.expandButton=document.createElement('button');this.expandButton.className='quiet';this.expandButton.textContent='Full screen ↗';this.expandButton.setAttribute('aria-expanded','false');this.expandButton.title='Open terrain full screen during preview or your ride. Escape exits.';this.expandButton.onclick=()=>this.toggleExpandedView();
    controls.append(this.imageryLabel,exaggerationLabel,this.expandButton);
    this.placesButton=document.createElement('button');this.placesButton.className='quiet';this.placesButton.textContent='Place names';this.placesButton.setAttribute('aria-pressed','true');this.showPlaceNames=true;
    this.placesButton.onclick=()=>{this.showPlaceNames=!this.showPlaceNames;this.placesButton.setAttribute('aria-pressed',String(this.showPlaceNames));if(this.mapReady){for(const id of ['place-names','place-points'])this.map.setLayoutProperty(id,'visibility',this.showPlaceNames?'visible':'none');if(this.showPlaceNames)this.refreshPlaceNames();else {this.namesAbort?.abort();this.placesStatus.textContent='Place names hidden.';}}};
    controls.append(this.placesButton);
    this.panoramaButton=document.createElement('button');this.panoramaButton.className='quiet';this.panoramaButton.textContent='Summit panoramas';this.panoramaButton.setAttribute('aria-pressed',String(this.panoramaEnabled));
    this.panoramaButton.onclick=()=>{this.panoramaEnabled=!this.panoramaEnabled;this.panoramaButton.setAttribute('aria-pressed',String(this.panoramaEnabled));if(!this.panoramaEnabled)this.cancelPanorama();};
    this.skipPanoramaButton=document.createElement('button');this.skipPanoramaButton.className='outline';this.skipPanoramaButton.textContent='Skip panorama';this.skipPanoramaButton.hidden=true;this.skipPanoramaButton.onclick=()=>this.cancelPanorama();
    controls.append(this.panoramaButton,this.skipPanoramaButton);
    this.panoramaStatus=document.createElement('p');this.panoramaStatus.className='terrain-status';this.panoramaStatus.setAttribute('role','status');this.root.append(this.panoramaStatus);
    this.placesStatus=document.createElement('p');this.placesStatus.className='terrain-status';this.placesStatus.textContent='Place names load online with the map (US coverage).';this.root.append(this.placesStatus);
    const previewControls=document.createElement('div');previewControls.className='preview-controls';
    this.previewButton=document.createElement('button');this.previewButton.className='outline';this.previewButton.textContent='Preview flyover';this.previewButton.onclick=()=>this.startPreview();
    this.pausePreviewButton=document.createElement('button');this.pausePreviewButton.className='outline';this.pausePreviewButton.textContent='Pause preview';this.pausePreviewButton.hidden=true;this.pausePreviewButton.onclick=()=>this.pausePreview();
    const speedLabel=document.createElement('label');speedLabel.textContent='Speed ';
    this.speedSelect=document.createElement('select');this.speedSelect.setAttribute('aria-label','Preview speed');for(const value of [10,30,60,120]){const option=document.createElement('option');option.value=value;option.textContent=`${value}×`;this.speedSelect.append(option);}this.speedSelect.value='60';this.speedSelect.onchange=()=>{this.preview.speed=Number(this.speedSelect.value);this.previewChanged();};speedLabel.append(this.speedSelect);
    this.exitPreviewButton=document.createElement('button');this.exitPreviewButton.className='quiet';this.exitPreviewButton.textContent='Exit preview';this.exitPreviewButton.hidden=true;this.exitPreviewButton.onclick=()=>this.stopPreview();
    this.previewScrub=document.createElement('input');this.previewScrub.type='range';this.previewScrub.min=0;this.previewScrub.max=total;this.previewScrub.step='any';this.previewScrub.value=0;this.previewScrub.setAttribute('aria-label','Preview route position');this.previewScrub.hidden=true;this.previewScrub.oninput=()=>{this.cancelPanorama(false);this.summitPrevious.preview=null;this.preview.seek(Number(this.previewScrub.value));this.previewChanged();};
    this.previewStatus=document.createElement('p');this.previewStatus.className='preview-status';this.previewStatus.textContent='Preview before starting · No bike or recording';
    previewControls.append(this.previewButton,this.pausePreviewButton,speedLabel,this.exitPreviewButton,this.previewScrub,this.previewStatus);this.root.append(previewControls);
    this.mapHost=document.createElement('div');this.mapHost.className='terrain-map';this.mapHost.hidden=true;this.root.append(this.mapHost);
    this.mapStatus=document.createElement('p');this.mapStatus.className='terrain-status';this.mapStatus.textContent='3D terrain uses online free map tiles. No account or subscription. Route profile and trace work offline.';this.root.append(this.mapStatus);
    this.trace=trace;this.update(null);return true;
  }
  async startPreview() {
    if (!this.previewAllowed || !this.preview) return;
    if (this.preview.running) return;
    if (this.previewLoading) return;
    const generation=this.generation, request=this.previewRequest=(this.previewRequest||0)+1;this.previewLoading=true;this.previewButton.disabled=true;this.previewStatus.textContent='Loading aerial terrain for preview…';
    await this.loadMap();
    if(generation!==this.generation || request!==this.previewRequest)return;this.previewLoading=false;
    if(!this.previewAllowed){this.previewChanged();return;}
    if(this.preview.distanceKm*1000>=this.preview.totalMetres){this.summitsSeen.preview.clear();this.summitPrevious.preview=null;}
    this.preview.start();this.previewLastTick=performance.now();this.follow=true;this.followButton.setAttribute('aria-pressed','true');this.startPreviewTimer();this.resumePanorama?.();this.previewChanged();this.followPosition(true);
  }
  startPreviewTimer() {
    clearInterval(this.previewTick);
    this.previewTick=setInterval(()=>{
      if(!this.preview?.running)return;
      const now=performance.now();if(!this.panorama)this.preview.advance((now-this.previewLastTick)/1000);this.previewLastTick=now;
      if(!this.preview.running)clearInterval(this.previewTick);
      this.previewChanged();
    },50);
  }
  pausePreview() {
    this.previewRequest=(this.previewRequest||0)+1;
    this.previewLoading=false;
    this.preview?.pause();
    clearInterval(this.previewTick);
    if(this.panoramaAnimation!=null)cancelAnimationFrame(this.panoramaAnimation);
    if(this.panorama && this.panoramaStatus && !this.panoramaStatus.textContent.includes(' · Paused'))this.panoramaStatus.textContent+=' · Paused';
    this.previewLastTick=performance.now();
    // Stop the in-flight camera transition as well as route advancement.
    this.map?.stop();
    this.previewChanged();
  }
  previewChanged() {
    if(!this.preview)return;
    this.previewButton.disabled=!this.previewAllowed||this.previewLoading||this.preview.running;
    const buttonText=this.preview.running?'Preview running':this.preview.enabled?(this.preview.distanceKm*1000>=this.preview.totalMetres?'Replay flyover':'Resume preview'):'Preview flyover';
    if(this.previewButton.textContent!==buttonText)this.previewButton.textContent=buttonText;
    this.pausePreviewButton.hidden=!this.preview.enabled;
    this.pausePreviewButton.disabled=!this.preview.running;
    this.exitPreviewButton.hidden=!this.preview.enabled;this.previewScrub.hidden=!this.preview.enabled;this.previewScrub.value=this.preview.distanceKm*1000;
    this.previewStatus.textContent=this.preview.enabled?`${this.preview.running?'PREVIEW':this.preview.distanceKm*1000>=this.preview.totalMetres?'PREVIEW COMPLETE':'PREVIEW PAUSED'} · ${this.preview.speed}× · ${Math.floor(this.preview.distanceKm*1000/this.preview.totalMetres*100)}% · No bike or recording`:'Preview before starting · No bike or recording';
    this.onPreview(this.preview.enabled?this.preview.distanceKm:null);
    this.update(this.liveDistanceKm,this.liveConnected);
  }
  stopPreview() {this.cancelPanorama(false);this.pausePreview();this.preview?.stop();this.previewChanged();}
  setPreviewAllowed(allowed) {this.previewAllowed=allowed;if(this.previewButton)this.previewButton.disabled=!allowed||this.previewLoading||this.preview?.running;if(!allowed&&this.preview?.enabled)this.stopPreview();}
  async loadMap() {
    if(this.mapReady)return true;
    if(this.mapLoading)return this.mapLoading;
    this.mapLoading=this.createMap();
    const ready=await this.mapLoading;this.mapLoading=null;return ready;
  }
  async createMap() {
    const generation=this.generation;this.loadButton.disabled=true;this.mapStatus.textContent='Loading terrain…';
    try {
      const gl=await loadMapLibrary();this.gl=gl;if(generation!==this.generation)return;
      this.mapHost.hidden=false;
      const map=this.map=new gl.Map({container:this.mapHost,style:'https://tiles.openfreemap.org/styles/liberty',center:[this.points[0].lon,this.points[0].lat],zoom:12,pitch:55,maxPitch:85,attributionControl:true});
      map.on('error',()=>{if(generation===this.generation)this.mapStatus.textContent='Some online map tiles are unavailable. The offline profile and route trace remain available.';});
      return await new Promise(resolve=>{
      const timeout=setTimeout(()=>{if(generation!==this.generation)return resolve(false);this.mapStatus.textContent='Online terrain is taking too long. Preview can use the offline route trace; try loading terrain again.';this.map?.remove();this.map=null;this.mapHost.hidden=true;this.loadButton.disabled=false;resolve(false);},20000);
      map.on('load',()=>{
        clearTimeout(timeout);
        if(generation!==this.generation)return;
        map.addSource('elevation',{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],encoding:'terrarium',tileSize:256,maxzoom:15,attribution:'Elevation: Mapzen / AWS Open Data'});
        map.setTerrain({source:'elevation',exaggeration:this.exaggeration});
        map.addSource('relief',{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],encoding:'terrarium',tileSize:256,maxzoom:15});
        map.addLayer({id:'relief',type:'hillshade',source:'relief',paint:{'hillshade-exaggeration':0.35}},map.getStyle().layers.find(l=>l.type==='symbol')?.id);
        map.addSource('aerial',{type:'raster',tiles:['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:16,attribution:'Aerial imagery: USDA / USGS The National Map'});
        map.addLayer({id:'aerial',type:'raster',source:'aerial',layout:{visibility:this.imagerySelect.value==='aerial'?'visible':'none'},paint:{'raster-fade-duration':150}},'relief');
        map.addSource('course',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:this.points.map(p=>[p.lon,p.lat])}}});
        map.addLayer({id:'course',type:'line',source:'course',paint:{'line-color':'#ff914e','line-width':5}});
        {
          map.addSource('places',{type:'geojson',data:{type:'FeatureCollection',features:[]},attribution:'Place names: USGS Geographic Names Information System'});
          map.addLayer({id:'place-points',type:'circle',source:'places',paint:{'circle-radius':4,'circle-color':'#a8e5ff','circle-stroke-color':'#172630','circle-stroke-width':1.5}});
          map.addLayer({id:'place-names',type:'symbol',source:'places',layout:{visibility:this.showPlaceNames?'visible':'none','text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':15,'text-offset':[0,1],'text-anchor':'top','text-max-width':14},paint:{'text-color':'#ffffff','text-halo-color':'#132431','text-halo-width':2}});
        }
        if (this.landmarks.length) {
          map.addSource('landmarks',{type:'geojson',data:{type:'FeatureCollection',features:this.landmarks.map(l=>{const p=routePosition(this.points,l.distance/1000);return {type:'Feature',properties:{name:l.name},geometry:{type:'Point',coordinates:[p.lon,p.lat]}};})}});
          map.addLayer({id:'landmark-points',type:'circle',source:'landmarks',paint:{'circle-radius':5,'circle-color':'#ffffff','circle-stroke-color':'#243641','circle-stroke-width':2}});
          map.addLayer({id:'landmark-names',type:'symbol',source:'landmarks',layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':13,'text-offset':[0,1.2],'text-anchor':'top'},paint:{'text-color':'#15232d','text-halo-color':'#ffffff','text-halo-width':2}});
        }
        this.marker=new gl.Marker({color:'#ffffff'}).setLngLat([this.points[0].lon,this.points[0].lat]).addTo(map);
        map.addControl(new gl.NavigationControl());
        this.followButton.hidden=false;this.overviewButton.hidden=false;this.loadButton.hidden=true;this.trace.setAttribute('hidden','');
        this.mapStatus.textContent='Aerial terrain · Automatic track-up · Drag to explore. Terrain height changes the map only, not route elevation or effort.';
        this.mapReady=true;this.namesKey=null;this.refreshPlaceNames();this.follow=true;this.followButton.setAttribute('aria-pressed','true');
        map.on('dragstart',()=>{this.cancelPanorama(false);this.follow=false;this.followButton.setAttribute('aria-pressed','false');});
        this.update(this.liveDistanceKm,this.liveConnected);this.followPosition(true);resolve(true);
      });
      });
    } catch {if(generation!==this.generation)return;this.map?.remove();this.map=null;this.mapHost.hidden=true;this.loadButton.disabled=false;this.mapStatus.textContent='3D terrain is unavailable. Use the offline route trace or retry loading.';return false;}
  }
  setRideRunning(running) {if(this.rideRunning && !running && this.panorama)this.map?.stop();this.rideRunning=running;}
  cancelPanorama(returnToRide=true) {
    const tour=this.panorama;cancelAnimationFrame(this.panoramaAnimation);this.panorama=null;this.resumePanorama=null;
    if(tour?.previewAtEnd && this.preview?.enabled){this.preview.pause();this.previewChanged();}
    if(this.skipPanoramaButton)this.skipPanoramaButton.hidden=true;
    if(this.panoramaStatus)this.panoramaStatus.textContent='';
    this.previewLastTick=performance.now();
    if(returnToRide && this.mapReady){this.map.stop();this.followPosition(true);}
  }
  startPanorama(summit) {
    const point=routePosition(this.points,summit.distance/1000),bearing=trackBearing(this.points,summit.distance);
    const atFinish=this.distanceKm*1000>=this.points.at(-1).distance;
    const previewAtEnd=Boolean(this.preview?.enabled && atFinish);if(previewAtEnd)this.preview.running=true;
    const cameraPlan=panoramaPlan(point,location=>this.map.queryTerrainElevation(location) ?? point.altitude*this.exaggeration);
    this.panorama={point,bearing,cameraPlan,atFinish,previewAtEnd,elapsed:0,last:performance.now(),phase:null};this.map.stop();this.skipPanoramaButton.hidden=false;
    const animate=now=>{
      const tour=this.panorama;if(!tour||!this.mapReady)return;
      const running=this.preview?.enabled?this.preview.running:(this.rideRunning||tour.atFinish);
      if(running && document.visibilityState==='visible')tour.elapsed+=Math.min(100,Math.max(0,now-tour.last));
      tour.last=now;
      const frame=panoramaFrame(tour.elapsed,tour.bearing);
      if(frame.phase==='done'){this.cancelPanorama();return;}
      if(running){
        const camera=panoramaCamera(tour.point,frame,location=>this.map.queryTerrainElevation(location) ?? tour.point.altitude*this.exaggeration,tour.cameraPlan);
        const options=this.map.calculateCameraOptionsFromTo(new this.gl.LngLat(...camera.location),camera.altitude,new this.gl.LngLat(...camera.target),camera.targetAltitude);
        if(frame.phase==='approach'){if(tour.phase!==frame.phase)this.map.easeTo({...options,duration:2900});}
        else this.map.jumpTo(options);
      }
      tour.phase=frame.phase;
      this.panoramaStatus.textContent=`SUMMIT PANORAMA · At least ${formatElevation(PANORAMA_HEIGHT_METRES,this.unit)} above terrain · Peak-facing 360° orbit${running?'':' · Paused'} · ${this.preview?.enabled?'Preview progress held':'Ride recording continues'}`;
      this.panoramaAnimation=requestAnimationFrame(animate);
    };
    this.panoramaAnimation=requestAnimationFrame(animate);
    this.resumePanorama=()=>{if(this.panorama){cancelAnimationFrame(this.panoramaAnimation);this.panorama.last=performance.now();this.panoramaAnimation=requestAnimationFrame(animate);}};
  }
  setUnits(preference) {
    const unit=preference==='mph'?'mph':'km/h';if(this.unit===unit)return;
    this.unit=unit;this.updateUnitLabels();
    if(this.points)this.update(this.liveDistanceKm,this.liveConnected);
  }
  updateUnitLabels() {
    if(!this.profile || !this.points)return;
    for(const label of this.distanceLabels||[])label.node.textContent=formatRouteDistance(label.distance,this.unit,1);
    for(const label of this.elevationLabels||[])label.node.textContent=formatElevation(label.altitude,this.unit);
    this.profile.setAttribute('aria-label',`Elevation profile, ${formatRouteDistance(this.points.at(-1).distance,this.unit,1)}; elevation ${formatElevation(this.profileMin,this.unit)} to ${formatElevation(this.profileMax,this.unit)}`);
  }
  async refreshPlaceNames() {
    if (!this.mapReady || !this.showPlaceNames) return;
    const lons=this.points.map(p=>p.lon),lats=this.points.map(p=>p.lat);
    const bounds=nameQueryBounds(Math.min(...lons)-.02,Math.min(...lats)-.02,Math.max(...lons)+.02,Math.max(...lats)+.02);
    if (!bounds) {this.placesStatus.textContent='Route area is too large for geographic labels.';return;}
    const key=bounds.join(',');if(key===this.namesKey)return;
    this.namesAbort?.abort();const controller=this.namesAbort=new AbortController(), generation=this.generation;
    this.placesStatus.textContent='Loading geographic place names…';
    try {
      const data=await geographicNames(bounds,{signal:controller.signal});
      if(controller.signal.aborted || generation!==this.generation || !this.mapReady)return;
      this.map.getSource('places').setData(data);this.namesKey=key;
      this.placesStatus.textContent=`${data.features.length} geographic labels around this route · USGS · Nearby features, not confirmed route stops.`;
    } catch {if(!controller.signal.aborted && generation===this.generation)this.placesStatus.textContent='Geographic names unavailable. Map and ride continue; toggle Place names to retry.';}
  }
  overview() {
    this.cancelPanorama(false);if(!this.map)return;const gl=this.gl,bounds=new gl.LngLatBounds();for(const p of this.points)bounds.extend([p.lon,p.lat]);this.map.fitBounds(bounds,{padding:35,pitch:45,duration:0});
  }
  followPosition(force=false) {
    if(this.panorama || !this.follow||!this.marker || (this.preview?.enabled && !this.preview.running && !force))return;
    const p=routePosition(this.points,this.distanceKm),bearing=trackBearing(this.points,p.distance);
    const heading=force?bearing:smoothBearing(this.map.getBearing(),bearing,.3);
    this.map.easeTo({center:[p.lon,p.lat],bearing:heading,pitch:60,zoom:this.preview?.enabled?14.4:15,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:force?700:this.preview?.running?80:300});
  }

  update(distanceKm, connected=false) {
    if(!this.points)return;
    this.liveDistanceKm=distanceKm;this.liveConnected=connected;
    if(this.preview?.enabled){distanceKm=this.preview.distanceKm;connected=true;}
    const changed=distanceKm!==this.distanceKm;this.distanceKm=distanceKm;
    const p=routePosition(this.points,distanceKm),[cx,cy]=this.profileXY(p);
    this.profileMarker.setAttribute('cx',cx);this.profileMarker.setAttribute('cy',cy);
    if(this.traceMarker){const [x,y]=this.traceXY(p);this.traceMarker.setAttribute('cx',x);this.traceMarker.setAttribute('cy',y);}
    this.marker?.setLngLat([p.lon,p.lat]);
    const nearby=this.landmarks.find(l => Math.abs(l.distance-p.distance)<=40);
    const next=this.landmarks.find(l => l.distance>p.distance+40);
    const text=nearby ? `Here: ${nearby.name}` : next ? `Ahead in ${formatNearbyDistance(next.distance-p.distance,this.unit)}: ${next.name}` : '';
    if(this.landmark.textContent!==text)this.landmark.textContent=text;
    this.status.textContent=`${this.preview?.enabled?'PREVIEW · ':''}${formatRouteDistance(p.distance,this.unit)} / ${formatRouteDistance(this.points.at(-1).distance,this.unit)} · ${Math.floor(p.distance/this.points.at(-1).distance*100)}% complete · ${formatElevation(p.altitude,this.unit)} · ${p.grade>=0?'+':''}${p.grade.toFixed(1)}%${distanceKm==null?' · Waiting for ride distance':!connected?' · Last ride distance':''}${p.distance===this.points.at(-1).distance?' · Route complete':''}`;
    if(changed)this.followPosition();
    const mode=this.preview?.enabled?'preview':'ride',previous=this.summitPrevious?.[mode];
    if(this.summitPrevious){
      if(p.distance===0 && previous>0)this.summitsSeen[mode].clear();
      this.summitPrevious[mode]=p.distance;
      const summit=crossedSummit(this.summits||[],this.summitsSeen[mode],previous,p.distance);
      if(summit && this.mapReady && this.follow && this.panoramaEnabled && !this.panorama && (mode==='preview'?(this.preview.running||p.distance===this.points.at(-1).distance):this.rideRunning && connected)){
        this.summitsSeen[mode].add(summit.distance);this.startPanorama(summit);
      }
    }
  }
}
