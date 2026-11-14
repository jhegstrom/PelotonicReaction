import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { stravaEnvironment } from './lib/strava-config.mjs';
import { RideStore, validRideId } from './lib/ride-store.mjs';
import { RideUploads } from './lib/ride-uploads.mjs';
import { StravaService } from './lib/strava-service.mjs';
import { BikeService } from './lib/bike-service.mjs';
import { compileWorkout } from './public/workout.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
export function createAppServer(base = root, { dataRoot = base, helperPath = null, workoutsRoot = path.join(base, 'workouts'), bike, strava = new StravaService(dataRoot), rides = new RideStore(dataRoot) } = {}) {
  const uploads = new RideUploads(rides, strava);
  bike ??= new BikeService(base, { helperPath, rides, athleteId: () => strava.data?.athleteId || strava.data?.profile?.athleteId || null, onFinish: ride => uploads.complete(ride) });
  if (bike.recorder) bike.recorder.onFinish = ride => uploads.complete(ride);
  const server = http.createServer(async (req, res) => {
    const send = (status, text, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(req.method === 'HEAD' ? '' : text); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/rides' && req.method === 'GET') return send(200, JSON.stringify({ rides: rides.list() }));
      const rideRoute = url.pathname.match(/^\/api\/rides\/([a-zA-Z0-9-]{8,80})\/(fit|upload)$/);
      if (rideRoute) {
        const [,id,action] = rideRoute;
        try {
          if(action === 'fit' && ['GET','HEAD'].includes(req.method)) {
            res.setHeader('Content-Disposition', `attachment; filename="pelotonic-${id}.fit"`);
            return send(200,rides.fit(id),'application/octet-stream');
          }
          if(action === 'upload' && req.method === 'POST') {
            if(!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) return send(403,'{}');
            if(!req.headers['content-type']?.startsWith('application/json'))return send(415,'{}');
            let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)return send(413,'{}');}
            let input;try{input=JSON.parse(body);}catch{return send(400,'{}');}
            const ride=rides.get(id);
            if(ride.upload?.state==='uncertain' && input?.confirmRetry!==true) return send(409,JSON.stringify({error:'Check Strava before retrying this upload.',uncertain:true}));
            uploads.queue(ride,true);return send(202,JSON.stringify({ride}));
          }
          return send(405,'{}');
        }catch(error){return send(error.status||500,JSON.stringify({error:error.status?error.message:'Unable to load the saved ride.'}));}
      }
      if (url.pathname.startsWith('/api/strava/')) {
        if (url.pathname === '/api/strava/callback' && req.method === 'GET') {
          const binding = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('pr-strava='))?.slice(10);
          let result = 'connected';
          try { await strava.callback(url.searchParams, binding); } catch { result = 'failed'; }
          res.writeHead(303, { Location: '/?strava=' + result, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': 'pr-strava=; HttpOnly; SameSite=Lax; Path=/api/strava/callback; Max-Age=0' });
          return res.end();
        }
        if (url.pathname === '/api/strava/profile' && req.method === 'GET') return send(200, JSON.stringify(await strava.status()));
        if (req.method !== 'POST') return send(405, '{}');
        if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) return send(403, '{}');
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, '{}');
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2048) return send(413, '{}'); }
        let input; try { input = JSON.parse(body); } catch { return send(400, '{}'); }
        try {
          if (url.pathname === '/api/strava/connect') {
            const result = strava.begin(req.headers.origin);
            res.setHeader('Set-Cookie', `pr-strava=${result.binding}; HttpOnly; SameSite=Lax; Path=/api/strava/callback; Max-Age=600${req.headers.origin.startsWith('https:') ? '; Secure' : ''}`);
            return send(200, JSON.stringify({ url: result.url }));
          }
          if (url.pathname === '/api/strava/refresh') return send(200, JSON.stringify(await strava.refresh(input?.force === true)));
          if (url.pathname === '/api/strava/disconnect') return send(200, JSON.stringify(await strava.disconnect()));
          return send(404, '{}');
        } catch (error) { return send(400, JSON.stringify({ error: error.message })); }
      }
      if (url.pathname === '/api/bike/events' && req.method === 'GET') {
        const client = url.searchParams.get('client');
        if (!client || !/^[a-zA-Z0-9-]{8,80}$/.test(client)) return send(400, '{}');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
        const unsubscribe = bike.subscribe(value => res.write(`data: ${JSON.stringify(value)}\n\n`));
        bike.touch(client);
        const heartbeat = setInterval(() => { bike.touch(client); res.write(': heartbeat\n\n'); }, 15000);
        res.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
        return;
      }
      if (url.pathname === '/api/bike/session' && req.method === 'POST') {
        // Browser commands must come from this origin; catalog and files remain read-only.
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, '{}');
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, '{}');
        let text = '';
        for await (const chunk of req) { text += chunk; if (text.length > 2048) return send(413, '{}'); }
        let body; try { body = JSON.parse(text); } catch { return send(400, '{}'); }
        if (!body || typeof body.client !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.client)) return send(400, '{}');
        try {
          if (body.rideId != null && !validRideId(body.rideId)) return send(400, '{}');
          if (body.action === 'start') await bike.start(body.client, body);
          else if (body.action === 'stop') bike.stop(body.client, body);
          else if (['average', 'address', 'timing'].includes(body.action)) bike.configure(body.client, body);
          else return send(400, '{}');
          return send(200, JSON.stringify({ ok: true }));
        } catch (error) { return send(error.status || 500, JSON.stringify({ error: error.message, code: error.code })); }
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, JSON.stringify({ error: 'Read-only server.' }));
      if (url.pathname === '/api/workouts') {
        const workouts = [], errors = [];
        const files = (await readdir(workoutsRoot)).filter(f => f.endsWith('.json')).sort();
        for (const filename of files) {
          try { const raw = JSON.parse(await readFile(path.join(workoutsRoot, filename), 'utf8')); compileWorkout(raw); workouts.push({ filename, workout: raw }); }
          catch (e) { errors.push({ filename, message: e.message }); }
        }
        return send(200, JSON.stringify({ workouts, errors }));
      }
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0') || pathname.includes('\\')) return send(400, '{}');
      const publicRoot = path.resolve(base, 'public');
      const target = path.resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!target.startsWith(publicRoot + path.sep)) return send(403, '{}');
      try { return send(200, await readFile(target), mime[path.extname(target)] || 'application/octet-stream'); }
      catch (e) { if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(e.code)) return send(404, JSON.stringify({ error: 'Not found.' })); throw e; }
    } catch { return send(500, JSON.stringify({ error: 'Unable to load this request.' })); }
  });
  server.on('close', () => { bike.close(); uploads.close(); });
  return server;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const value = (flag, fallback) => { const i = process.argv.indexOf(flag); return i === -1 ? fallback : process.argv[i + 1]; };
  const port = Number(value('--port', process.env.PORT || 8080));
  const host = value('--host', '127.0.0.1');
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('Choose a port from 1 to 65535.'); process.exit(1); }
  const strava = new StravaService(root, { env: { ...await stravaEnvironment(root), PORT: String(port) } });
  const server = createAppServer(root, { strava });
  void strava.refresh();
  server.on('error', e => { console.error(`Cannot start server: ${e.message}`); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`PelotonicReaction: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n${host === '0.0.0.0' ? 'LAN sharing enabled. Open this computer’s LAN IP and port on another device.' : 'Local access. Use --host 0.0.0.0 to allow other devices on your network.'}`));
}
