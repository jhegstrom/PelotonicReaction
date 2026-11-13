import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { RideMetrics, sourceSnapshot } from './ride-metrics.mjs';

export class BikeService {
  constructor(root, { launch = spawn, platform = process.platform } = {}) {
    this.root = root; this.launch = launch; this.platform = platform;
    this.clients = new Set(); this.owner = null; this.child = null; this.retry = null; this.building = false;
    this.snapshot = { status: 'Bike connects at ride start', connected: false, metrics: {}, powerAverage: null, averagingSeconds: 3, noBike: false };
    this.seconds = 3; this.lastSeen = 0;
    this.stats = new RideMetrics(performance.now());
    this.watch = setInterval(() => {
      // The SSE heartbeat renews ownership, including while the countdown/ride is paused.
      if (this.owner && Date.now() - this.lastSeen > 90000) this.stop(this.owner);
    }, 10000); this.watch.unref();
  }
  present() { return { ...sourceSnapshot(this.snapshot), ride: this.stats.summary(performance.now()) }; }
  publish(value) {
    this.snapshot = value;
    this.stats.ingest(sourceSnapshot(value), performance.now());
    const snapshot = this.present(); for (const client of this.clients) client(snapshot);
  }
  subscribe(client) { this.clients.add(client); client(this.present()); return () => this.clients.delete(client); }
  command(value) { if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(value) + '\n'); }
  async start(client) {
    if (this.owner && this.owner !== client) throw Object.assign(Error('Another screen is using the bike.'), { status: 409 });
    if (!this.owner) this.stats = new RideMetrics(performance.now());
    this.owner = client; this.lastSeen = Date.now();
    if (!this.child && !this.building) this.ensureBridge();
    else this.command({ action: 'start' });
  }
  touch(client) { if (client === this.owner) this.lastSeen = Date.now(); }
  stop(client) {
    if (this.owner !== client) return;
    this.stats.setRunning(false, performance.now());
    this.owner = null; clearTimeout(this.retry); this.retry = null;
    this.command({ action: 'stop' });
    this.publish({ ...this.snapshot, status: 'Ride ended · bike disconnected', connected: false, noBike: false });
  }
  configure(client, body) {
    if (client !== this.owner) throw Object.assign(Error('Start a ride before configuring the bike.'), { status: 409 });
    if (body.action === 'timing') {
      if (typeof body.recording !== 'boolean') throw Object.assign(Error('Invalid workout timing state.'), { status: 400 });
      this.stats.setRunning(body.recording, performance.now());
    } else if (body.action === 'average') {
      if (!Number.isInteger(body.seconds) || body.seconds < 0 || body.seconds > 300) throw Object.assign(Error('Average must be 0–300 seconds.'), { status: 400 });
      this.seconds = body.seconds; this.command({ action: 'average', seconds: body.seconds });
    } else if (body.action === 'address') {
      if (typeof body.host !== 'string' || !/^[a-zA-Z0-9.:%_-]{1,253}$/.test(body.host) || !/^\d{1,5}$/.test(String(body.port)) || Number(body.port) < 1 || Number(body.port) > 65535) throw Object.assign(Error('Enter a bike hostname/IP and valid port.'), { status: 400 });
      this.command({ action: 'address', host: body.host, port: String(body.port) });
    }
  }
  ensureBridge() {
    if (!this.owner || this.child || this.building) return;
    if (this.platform !== 'darwin') {
      this.publish({ ...this.snapshot, status: 'Live Grupetto connection currently requires the Mac host', connected: false }); return;
    }
    this.building = true;
    this.publish({ ...this.snapshot, status: 'Preparing Mac bike connection…', connected: false });
    const build = this.launch('sh', [path.join(this.root, 'tools/grupetto-wifi-harness/build.sh')], { cwd: this.root, stdio: ['ignore', 'ignore', 'pipe'] });
    this.builder = build;
    let errorText = '';
    build.stderr?.on('data', data => { errorText = (errorText + data).slice(-2000); });
    let finished = false;
    const done = code => {
      if (finished) return; finished = true; this.builder = null; this.building = false;
      if (!this.owner) return;
      if (code !== 0) {
        console.error('Bike bridge build failed:', errorText);
        this.publish({ ...this.snapshot, status: 'Mac bike connection preparing · retrying automatically', connected: false });
        this.retry = setTimeout(() => this.ensureBridge(), 15000); this.retry.unref(); return;
      }
      this.runBridge();
    };
    build.on('error', error => { errorText = error.message; done(1); }); build.on('exit', done);
  }
  runBridge() {
    if (!this.owner) return;
    const executable = path.join(this.root, 'tools/grupetto-wifi-harness/dist/Grupetto WiFi Test.app/Contents/MacOS/GrupettoWiFi');
    const child = this.launch(executable, ['--bridge'], { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const value = JSON.parse(line);
        if (typeof value.connected === 'boolean' && value.metrics && this.owner) this.publish(value);
      } catch { /* Ignore non-protocol lines. */ }
    });
    child.stdin.on('error', () => {});
    child.stderr.on('data', data => { console.error('Bike bridge:', String(data).slice(-1000).trim()); });
    let ended = false;
    const recover = () => {
      if (ended) return; ended = true; lines.close(); this.child = null;
      this.publish({ ...this.snapshot, connected: false, noBike: false, status: this.owner ? 'Reconnecting to bike…' : 'Bike disconnected' });
      if (this.owner) { this.retry = setTimeout(() => this.runBridge(), 2000); this.retry.unref(); }
    };
    child.on('error', recover); child.on('exit', recover);
    this.command({ action: 'average', seconds: this.seconds });
    this.command({ action: 'start' });
  }
  close() { this.owner = null; clearInterval(this.watch); clearTimeout(this.retry); this.builder?.kill(); this.child?.kill(); this.clients.clear(); }
}
