import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { compileWorkout } from './public/workout.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
export function createAppServer(base = root) {
  return http.createServer(async (req, res) => {
    const send = (status, text, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(req.method === 'HEAD' ? '' : text); };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, JSON.stringify({ error: 'Read-only server.' }));
      const url = new URL(req.url, 'http://localhost');
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
