// Isolated end-to-end fixture. No native bike, credentials, or Strava requests.
import { mkdtempSync,rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';
import { BikeService } from '../lib/bike-service.mjs';
import { RideStore } from '../lib/ride-store.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const temporary=mkdtempSync(path.join(os.tmpdir(),'pr-recording-preview-'));
const rides=new RideStore(temporary);
const bike=new BikeService(root,{platform:'preview',rides,athleteId:()=>42});
const strava={data:{athleteId:42},status:async()=>({configured:false,connected:true,canUpload:true,athleteId:42,profile:null,error:'SIMULATED UPLOADS · no Strava account is used.'}),uploadActivity:async()=>({id:123}),get:async()=>({activity_id:12345})};
const digitTest=process.argv.includes('--digit-test');
const sample=(value)=>({value,at:Date.now()});
const timer=setInterval(()=>{
 if(!bike.owner)return;
 const power=digitTest?(Math.floor(Date.now()/1000)%2?99:100):160+Math.round(Math.sin(Date.now()/500)*50);
 bike.publish({status:'SIMULATED BIKE AND UPLOADS · test only',connected:true,noBike:false,averagingSeconds:bike.seconds,powerAverage:digitTest?power:150,
 metrics:{Power:sample(power),Cadence:sample(85),Resistance:sample(42),'Heart rate':sample(135),Speed:sample(30)}});
},250);
const server=createAppServer(root,{bike,rides,strava});
server.listen(8098,'127.0.0.1',()=>console.log('Synthetic recording preview: http://localhost:8098'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);server.closeAllConnections();server.close(()=>{rmSync(temporary,{recursive:true,force:true});process.exit(0);});});
