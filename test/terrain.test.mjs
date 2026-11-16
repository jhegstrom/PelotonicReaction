import test from 'node:test';
import assert from 'node:assert/strict';
import { routePosition, gradeColor, RoutePreview, TerrainView, trackBearing, smoothBearing } from '../public/terrain.js';
import { compileWorkout, positionAt, WorkoutClock } from '../public/workout.js';
import { terrainWorkout } from '../scripts/import_fit_route.mjs';
const points=[{distance:0,altitude:100,lat:40,lon:-120},{distance:1000,altitude:200,lat:41,lon:-121},{distance:2000,altitude:100,lat:42,lon:-122}];
const base={schemaVersion:1,name:'Route',tags:['Spinulator'],route:{points},steps:[{label:'Climb',cue:'Keep it smooth.',durationSeconds:60}]};
test('written cues survive compilation and repeats; malformed cues fail',()=>{
 assert.equal(compileWorkout(base).intervals[0].cue,'Keep it smooth.');
 assert.equal(compileWorkout({...base,steps:[{repeat:2,steps:base.steps}]}).intervals[1].cue,'Keep it smooth.');
 for(const cue of [{},5,'x'.repeat(501)])assert.throws(()=>compileWorkout({...base,steps:[{...base.steps[0],cue}]}),/cue/);
});
test('route position interpolates actual ride distance and clamps at endpoints',()=>{
 assert.deepEqual(routePosition(points,.5),{distance:500,altitude:150,lat:40.5,lon:-120.5,grade:10});
 assert.equal(routePosition(points,99).distance,2000);
 assert.equal(routePosition(points,-1).distance,0);
 assert.equal(routePosition(points,null).distance,0);
 assert.notEqual(gradeColor(-5),gradeColor(8));
});
test('malformed route geometry and landmark data fail before rendering',()=>{
 for(const route of [{points:[]},{points:[points[0],points[0]]},{points:[points[0],{...points[1],lat:91}]},{points,landmarks:[{distance:9000,name:'Beyond finish'}]}]) assert.throws(()=>compileWorkout({...base,route}));
 assert.equal(compileWorkout({...base,route:undefined}).tags[0],'Spinulator');
});
test('FIT import retains degree coordinates, landmarks, cues and primary power',()=>{
 const records=Array.from({length:61},(_,i)=>({distance:i*100,altitude:i<30?i*8:(60-i)*8,positionLat:Math.round(40*2147483648/180),positionLong:Math.round(-120*2147483648/180)}));
 const w=terrainWorkout(records,{coursePoints:[{distance:1500,name:'Keep left'}]});
 assert.ok(w.tags.includes('Spinulator'));assert.ok(Math.abs(w.route.points[0].lat-40)<.00001);
 assert.deepEqual(w.route.landmarks,[{distance:1500,name:'Keep left'}]);
 assert.ok(w.steps.every(s=>s.cue && s.primaryTargets.join()==='watts'));
 assert.ok(w.steps.some(s=>s.cue.includes('Last substantial climb')));
 assert.equal(compileWorkout(w).totalSeconds,2700);
});

test('distance segments advance at exact traveled boundaries, independently of elapsed time',()=>{
 const w=compileWorkout({...base,completionMetric:'distance',steps:[{label:'A',durationSeconds:10,distanceMeters:1000},{label:'B',durationSeconds:10,distanceMeters:1000}]});
 assert.equal(w.totalDistanceMeters,2000);
 assert.equal(positionAt(w,99999,0).index,0);
 assert.equal(positionAt(w,10,999).index,0);
 assert.equal(positionAt(w,1,1000).index,1);
 assert.equal(positionAt(w,1,1500).remaining,500);
 assert.equal(positionAt(w,1,2000).done,true);
 assert.equal(positionAt(w,1,9000).distance,2000);
 assert.equal(positionAt(w,1,NaN).index,0);
 assert.equal(positionAt(w,1,-1).distance,0);
 assert.throws(()=>compileWorkout({...base,completionMetric:'distance'}),/distanceMeters/);
 assert.throws(()=>compileWorkout({...base,completionMetric:'distance',steps:[{label:'A',durationSeconds:1,distanceMeters:20}]}),/cover the route/);
 const clock=new WorkoutClock(Infinity,()=>0);clock.seek(9999);assert.equal(clock.read(),9999);
});

// Distance mode sends no duration deadline to the recorder.
test('distance recording has no estimated-time cutoff', async()=>{
 const {BikeService}=await import('../lib/bike-service.mjs');
 const bike=new BikeService('.', {platform:'test'});
 try {
  await bike.start('distance-test', {rideId:'distance-ride'});
  bike.configure('distance-test',{action:'timing',recording:true,remainingSeconds:null});
  assert.equal(bike.recordUntil,null);assert.equal(bike.stats.running,true);
  assert.equal(bike.present().rideId,'distance-ride');
  bike.configure('distance-test',{action:'timing',recording:false,remainingSeconds:null});
  assert.equal(bike.stats.running,false);
 } finally {bike.close();}
});

test('preview advances independently of workout time and real ride distance',()=>{
 const preview=new RoutePreview(2000,60);
 assert.equal(preview.advance(60),0);preview.start();
 assert.ok(Math.abs(preview.advance(1)-25/60)<1e-9);
 preview.running=false;const paused=preview.distanceKm;assert.equal(preview.advance(99),paused);
 preview.seek(1500);assert.equal(preview.distanceKm,1.5);preview.speed=120;preview.start();preview.advance(1);
 assert.equal(preview.distanceKm,2);assert.equal(preview.running,false);assert.equal(preview.enabled,true);
 preview.start();assert.equal(preview.distanceKm,0);preview.stop();assert.equal(preview.enabled,false);
 assert.equal(preview.distanceKm,0);
});
test('track-up uses the route heading at both endpoints and smooths across north',()=>{
 const north=[{distance:0,altitude:0,lat:40,lon:-120},{distance:1000,altitude:0,lat:41,lon:-120}];
 assert.equal(trackBearing(north,0),0);assert.equal(trackBearing(north,1000),0);
 assert.equal(smoothBearing(179,-179,.5),180);assert.equal(smoothBearing(-179,179,.5),-180);
});

test('preview pause freezes progress and stops camera, then resumes from the same distance',async()=>{
 const preview=new RoutePreview(10000);preview.start();preview.advance(2);
 const distance=preview.distanceKm;let stops=0;
 const view={preview,previewAllowed:true,generation:1,map:{stop(){stops++;}},previewButton:{},previewStatus:{},followButton:{setAttribute(){}},previewChanged(){},loadMap:async()=>true,followPosition(){},startPreviewTimer(){},pausePreview:TerrainView.prototype.pausePreview};
 TerrainView.prototype.pausePreview.call(view);
 assert.equal(preview.running,false);assert.equal(stops,1);
 TerrainView.prototype.pausePreview.call(view);assert.equal(preview.running,false);
 preview.advance(30);assert.equal(preview.distanceKm,distance);assert.equal(preview.enabled,true);
 await TerrainView.prototype.startPreview.call(view);
 assert.equal(preview.running,true);assert.equal(preview.distanceKm,distance);
 preview.advance(1);assert.ok(preview.distanceKm>distance);
});
test('pausing while the map loads prevents late completion from restarting preview',async()=>{
 let loaded;const preview=new RoutePreview(10000);
 const view={preview,previewAllowed:true,generation:1,previewButton:{},previewStatus:{},map:{stop(){}},previewChanged(){},loadMap:()=>new Promise(resolve=>{loaded=resolve;})};
 const pending=TerrainView.prototype.startPreview.call(view);
 TerrainView.prototype.pausePreview.call(view);loaded(true);await pending;
 assert.equal(preview.running,false);assert.equal(preview.distanceKm,0);assert.equal(view.previewLoading,false);
});
test('pause removes the real playback timer and leaves distance unchanged over subsequent ticks',async t=>{
 const preview=new RoutePreview(10000);preview.start();let ticks=0;
 const view={preview,previewLastTick:performance.now(),map:{stop(){}},previewChanged(){ticks++;}};
 t.after(()=>clearInterval(view.previewTick));
 TerrainView.prototype.startPreviewTimer.call(view);
 await new Promise(resolve=>setTimeout(resolve,130));assert.ok(preview.distanceKm>0);
 TerrainView.prototype.pausePreview.call(view);
 const distance=preview.distanceKm,count=ticks;
 await new Promise(resolve=>setTimeout(resolve,200));
 assert.equal(preview.distanceKm,distance);assert.equal(ticks,count);
});
