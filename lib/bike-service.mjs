import { nullLogger } from './event-log.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { validateRoute } from '../public/route-position.js';
import { RideRecorder } from './ride-recorder.mjs';
import { RideMetrics, sourceSnapshot } from './ride-metrics.mjs';

export class BikeService {
  constructor(root, { launch = spawn, platform = process.platform, helperPath = null, rides = null, athleteId = () => null, onFinish = () => {}, now = () => performance.now(), wallNow = Date.now, logger = rides?.logger || nullLogger } = {}) {
    this.logger=logger;this.staleMetrics=new Set();this.reconnectAttempt=0;this.now=now;this.wallNow=wallNow;
    this.recorder = rides ? new RideRecorder(rides, { onFinish, now, wallNow, logger }) : null; this.athleteId = athleteId;
    this.helperPath = helperPath; this.root = root; this.launch = launch; this.platform = platform;
    this.clients = new Set(); this.owner = null; this.child = null; this.retry = null; this.building = false;
    this.snapshot = { status: 'Bike connects at ride start', connected: false, metrics: {}, powerAverage: null, averagingSeconds: 3, noBike: false };
    this.seconds = 3; this.lastSeen = 0;
    this.stats = new RideMetrics(this.now());
    this.watch = setInterval(() => this.checkOwner(), 10000); this.watch.unref();
    this.recordWatch = setInterval(() => this.recordTick(), 1000); this.recordWatch.unref();
  }
  checkOwner() {
    // Losing the browser lease saves a resumable ride; it never changes its ID.
    if(this.owner && this.wallNow()-this.lastSeen>90000){this.logger.event('WARN','browser.session_timeout',{rideId:this.rideId});this.stop(this.owner,{reason:'timeout'});}
  }
  recordTick() {
    if(this.owner && this.recordUntil!=null && this.now()>=this.recordUntil)this.stop(this.owner,{reason:'complete'});
    const snapshot=sourceSnapshot(this.snapshot,this.wallNow());
    if(this.stats.running&&snapshot.connected){
      const stale=new Set(Object.entries(snapshot.metrics||{}).filter(([,s])=>Number.isFinite(s.value)&&(!Number.isFinite(s.ageMs)||s.ageMs>5000)).map(([key])=>key));
      const lost=[...stale].filter(key=>!this.staleMetrics.has(key)),restored=[...this.staleMetrics].filter(key=>!stale.has(key)&&Number.isFinite(snapshot.metrics?.[key]?.ageMs));
      if(lost.length)this.logger.event('WARN','telemetry.stale',{rideId:this.rideId,metrics:lost});
      if(restored.length)this.logger.event('INFO','telemetry.restored',{rideId:this.rideId,metrics:restored});
      this.staleMetrics=stale;
    }
    this.recorder?.safe(()=>this.recorder.sample(snapshot,this.stats.summary(this.now())));
  }

  present() { return { ...sourceSnapshot(this.snapshot,this.wallNow()), recording: this.recorder?.status(), rideId: this.rideId ?? null, ride: this.stats.summary(this.now()) }; }
  publish(value) {
    const disconnected=this.snapshot.connected&&!value.connected;
    if(Number.isInteger(value.connectionAttempts)&&value.connectionAttempts>(this.nativeAttempt||0)){this.logger.event('INFO','bike.reconnect_attempt',{rideId:this.rideId,attempt:value.connectionAttempts,source:'native_transport'});this.nativeAttempt=value.connectionAttempts;}
    if(value.status!==this.snapshot.status&&/Local Network.*blocked/i.test(value.status||''))this.logger.event('WARN','bike.network_permission_blocked',{rideId:this.rideId});
    if(value.status!==this.snapshot.status)this.logger.event('DEBUG','bike.status_changed',{rideId:this.rideId,status:value.status});
    if(!this.snapshot.connected&&value.connected){this.logger.event('INFO',this.hasConnected?'bike.reconnected':'bike.connected',{rideId:this.rideId});this.hasConnected=true;this.reconnectAttempt=0;}
    if(disconnected)this.logger.event(this.owner?'WARN':'INFO',this.owner?'bike.connection_lost':'bike.disconnected',{rideId:this.rideId});
    if(value.noBike&&!this.snapshot.noBike)this.logger.event('WARN','bike.discovery_failed',{rideId:this.rideId});
    this.snapshot = value;
    this.stats.ingest(sourceSnapshot(value,this.wallNow()), this.now());
    if(disconnected)this.recorder?.safe(()=>this.recorder.checkpoint(this.stats.summary(this.now())));
    const snapshot = this.present(); for (const client of this.clients) client(snapshot);
  }
  subscribe(client) { this.clients.add(client); client(this.present()); return () => this.clients.delete(client); }
  command(value) { this.logger.event('FULL','bike.command',{rideId:this.rideId,action:value.action});if(this.owner&&value.action==='start'&&!this.snapshot.connected)this.logger.event('DEBUG','bike.reconnect_attempt',{rideId:this.rideId,attempt:++this.reconnectAttempt,source:'command'});if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(value) + '\n'); }
  async start(client, body = {}) {
    if (this.owner && this.owner !== client) {this.logger.event('WARN','bike.session_conflict',{rideId:this.rideId});throw Object.assign(Error('Another screen is using the bike.'), { status: 409 });}
    if (this.owner && body.rideId && this.rideId && body.rideId !== this.rideId) throw Object.assign(Error('The previous ride is still ending. Retrying…'), {status:409});

    if (!this.owner || (!this.rideId && body.rideId)) {
      this.logger.event('INFO','bike.connect_requested',{rideId:body.rideId});
      if (body.virtualRoute != null) {
        try { validateRoute(body.virtualRoute); } catch (error) { throw Object.assign(error, {status:400}); }
      }
      if (body.routeOffsetKm != null && (!Number.isFinite(body.routeOffsetKm) || body.routeOffsetKm < 0)) throw Object.assign(Error('Invalid route offset.'), {status:400});
      const stats = new RideMetrics(this.now());
      if(this.recorder && body.rideId) {
        if(this.recorder.store.rides.has(body.rideId)) {
          const ride=this.recorder.resume(body.rideId);stats.restore(ride.summary,this.now());
        } else this.recorder.begin(body.rideId, body.name, this.athleteId(), body.description, body.virtualRoute, body.routeOffsetKm, body.summaryProfile);
      }
      this.stats=stats;this.staleMetrics.clear();this.rideId=body.rideId;
    }
    this.owner = client; this.lastSeen = this.wallNow();
    if (!this.child && !this.building) this.ensureBridge();
    else this.command({ action: 'start' });
  }
  async connect(client) {
    // A preflight owns the connection but creates no recording or running clock.
    if (this.owner === client && this.rideId) { this.touch(client); return; }
    await this.start(client);
  }
  touch(client) { if (client === this.owner) this.lastSeen = this.wallNow(); }
  stop(client, body = {}) {
    if (this.owner !== client || (body.rideId && this.rideId !== body.rideId)) return;
    this.stats.setRunning(false, this.now());
    this.recorder?.safe(() => this.recorder.finish(body.reason, sourceSnapshot(this.snapshot,this.wallNow()), this.stats.summary(this.now())));
    this.recordUntil = null; this.rideId = null; this.owner = null; clearTimeout(this.retry); this.retry = null;
    this.command({ action: 'stop' });
    this.publish({ ...this.snapshot, status: 'Ride ended · bike disconnected', connected: false, noBike: false });
  }
  configure(client, body) {
    if (client !== this.owner) throw Object.assign(Error('Start a ride before configuring the bike.'), { status: 409 });
    if (body.rideId && this.rideId !== body.rideId) throw Object.assign(Error('Ride session changed.'), {status:409});
    if (body.action === 'timing') {
      if (typeof body.recording !== 'boolean') throw Object.assign(Error('Invalid workout timing state.'), { status: 400 });
      if(body.remainingSeconds != null && (!Number.isFinite(body.remainingSeconds) || body.remainingSeconds < 0 || body.remainingSeconds > 86400)) throw Object.assign(Error('Invalid remaining ride time.'),{status:400});
      if(body.block != null && (!Number.isInteger(body.block.index)||body.block.index<0||body.block.index>=5000||typeof body.block.label!=='string'||!body.block.label.trim()||body.block.label.length>320)) throw Object.assign(Error('Invalid workout block.'),{status:400});
      this.recordUntil = body.recording && Number.isFinite(body.remainingSeconds) ? this.now()+body.remainingSeconds*1000 : null;
      this.stats.setRunning(body.recording, this.now());
      this.recorder?.safe(() => {
        const summary=this.stats.summary(this.now());
        if(body.block)this.recorder.setBlock(body.block,summary);
        this.recorder.timing(body.recording, sourceSnapshot(this.snapshot,this.wallNow()), summary);
      });
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
    if (this.helperPath) { this.runBridge(); return; }
    this.building = true;this.logger.event('DEBUG','bike.bridge_build_started');
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
        this.logger.event('ERROR','bike.bridge_build_failed',{exitCode:code,message:errorText});
        this.publish({ ...this.snapshot, status: 'Mac bike connection preparing · retrying automatically', connected: false });
        this.retry = setTimeout(() => this.ensureBridge(), 15000); this.retry.unref(); return;
      }
      this.runBridge();
    };
    build.on('error', error => { errorText = error.message; done(1); }); build.on('exit', done);
  }
  runBridge() {
    if (!this.owner) return;
    this.logger.event('INFO','bike.reconnect_attempt',{rideId:this.rideId,attempt:++this.reconnectAttempt,source:'bridge'});
    this.nativeAttempt=0;
    const executable = this.helperPath || path.join(this.root, 'tools/grupetto-wifi-harness/dist/Grupetto WiFi Test.app/Contents/MacOS/GrupettoWiFi');
    const child = this.launch(executable, ['--bridge'], { cwd: this.helperPath ? path.dirname(this.helperPath) : this.root, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const value = JSON.parse(line);
        if (typeof value.connected === 'boolean' && value.metrics && this.owner) this.publish(value);
      } catch { /* Ignore non-protocol lines. */ }
    });
    child.stdin.on('error', error => this.logger.event('WARN','bike.bridge_command_failed',{rideId:this.rideId,error}));
    child.stderr.on('data', data => this.logger.event('DEBUG','bike.bridge_diagnostic',{message:String(data).slice(-1000).trim()}));
    let ended = false;
    const recover = (code,signal) => {
      if (ended) return; ended = true; lines.close(); this.child = null;this.logger.event(this.owner?'WARN':'INFO','bike.bridge_stopped',{rideId:this.rideId,...(code instanceof Error?{error:code}:{exitCode:code,signal})});
      this.publish({ ...this.snapshot, connected: false, noBike: false, status: this.owner ? 'Reconnecting to bike…' : 'Bike disconnected' });
      if (this.owner) { this.retry = setTimeout(() => this.runBridge(), 2000); this.retry.unref(); }
    };
    child.on('error', recover); child.on('exit', recover);
    this.command({ action: 'average', seconds: this.seconds });
    this.command({ action: 'start' });
  }
  close() { this.stats.setRunning(false,this.now()); this.recorder?.safe(() => this.recorder.finish('timeout', sourceSnapshot(this.snapshot,this.wallNow()), this.stats.summary(this.now()))); this.owner = null; clearInterval(this.watch); clearInterval(this.recordWatch); clearTimeout(this.retry); this.builder?.kill(); this.child?.kill(); this.clients.clear(); }
}
