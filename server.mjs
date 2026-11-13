import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { BikeService } from './lib/bike-service.mjs';
import { compileWorkout } from './public/workout.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
export function createAppServer(base = root, { bike = new BikeService(base) } = {}) {
  const server = http.createServer(async (req, res) => {
    const send = (status, text, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(req.method === 'HEAD' ? '' : text); };
    try {
      const url = new URL(req.url, 'http://localhost');
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
          if (body.action === 'start') await bike.start(body.client);
          else if (body.action === 'stop') bike.stop(body.client);
          else if (['average', 'address', 'timing'].includes(body.action)) bike.configure(body.client, body);
          else return send(400, '{}');
          return send(200, JSON.stringify({ ok: true }));
        } catch (error) { return send(error.status || 500, JSON.stringify({ error: error.message })); }
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, JSON.stringify({ error: 'Read-only server.' }));
      if (url.pathname === '/api/workouts') {
        const workouts = [], errors = [];
        const files = (await readdir(path.join(base, 'workouts'))).filter(f => f.endsWith('.json')).sort();
        for (const filename of files) {
          try { const raw = JSON.parse(await readFile(path.join(base, 'workouts', filename), 'utf8')); compileWorkout(raw); workouts.push({ filename, workout: raw }); }
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
  server.on('close', () => bike.close());
  return server;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const value = (flag, fallback) => { const i = process.argv.indexOf(flag); return i === -1 ? fallback : process.argv[i + 1]; };
  const port = Number(value('--port', process.env.PORT || 8080));
  const host = value('--host', '127.0.0.1');
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('Choose a port from 1 to 65535.'); process.exit(1); }
  const server = createAppServer();
  server.on('error', e => { console.error(`Cannot start server: ${e.message}`); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`PelotonicReaction: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n${host === '0.0.0.0' ? 'LAN sharing enabled. Open this computer’s LAN IP and port on another device.' : 'Local access. Use --host 0.0.0.0 to allow other devices on your network.'}`));
}
