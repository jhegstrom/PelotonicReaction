import {listPackage,extractFile} from '@electron/asar';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const archive=process.argv[2];if(!archive)throw Error('Pass the path to app.asar.');
const entries=listPackage(archive).map(n=>n.replace(/^\//,''));
for(const n of entries)if(/(^|\/)(\.env|\.git|\.data|\.build)(\/|$)/.test(n)||/\.(xlsx|p12|pfx|key)$/.test(n))throw Error('Private/build file in package: '+n);
for(const required of ['server.mjs','desktop/main.mjs','public/index.html','node_modules/@garmin/fitsdk/src/index.js'])if(!entries.includes(required))throw Error('Missing packaged file: '+required);
// Refuse an installer containing this checkout's configured secret.
let secret;
try{secret=(await readFile('.env','utf8')).match(/^\s*STRAVA_CLIENT_SECRET\s*=\s*["']?([^\s"']+)/m)?.[1];}catch{}
if(secret)for(const n of entries){try{const data=extractFile(archive,n);if(data.includes(Buffer.from(secret)))throw Error('Configured secret found in package: '+n);}catch(e){if(e.message.startsWith('Configured secret'))throw e;}}
console.log(`Verified ${entries.length} packaged paths; no private configuration or recorded data included.`);
if(process.platform==='darwin'){
 const helper=path.join(path.dirname(archive),'bike-helper/Grupetto Bridge.app/Contents/MacOS/GrupettoWiFi');
 if(!(await stat(helper)).isFile())throw Error('Packaged bike helper is missing.');
 console.log('Prebuilt Mac bike helper is present.');
}
