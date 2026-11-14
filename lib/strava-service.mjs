import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeStravaProfile } from '../public/strava-profile.js';
const profileScopes = ['read', 'profile:read_all'];
const scopes = [...profileScopes, 'activity:write'];
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class StravaService {
  constructor(base, { env = process.env, fetcher = fetch, now = Date.now } = {}) {
    this.clientId = env.STRAVA_CLIENT_ID; this.secret = env.STRAVA_CLIENT_SECRET;
    this.redirect = env.STRAVA_REDIRECT_URI || `http://localhost:${env.PORT || 8080}/api/strava/callback`;
    try { const u = new URL(this.redirect); if (!['http:', 'https:'].includes(u.protocol) || u.pathname !== '/api/strava/callback' || u.search || u.hash || u.username || u.password) throw Error(); this.origin = u.origin; } catch { this.origin = null; }
    this.configured = Boolean(this.clientId && this.secret && this.origin);
    this.file = path.join(base, '.data', 'strava.json'); this.fetcher = fetcher; this.now = now;
    this.state = null; this.data = {}; this.error = null; this.needsReconnect = false;
    this.ready = this.load();
  }
  async load() {
    try { this.data = JSON.parse(await readFile(this.file, 'utf8')); this.data.profile = this.data.profile ? sanitizeStravaProfile(this.data.profile) : null; }
    catch (e) { this.data = {}; if (e.code !== 'ENOENT') this.error = 'Saved Strava connection could not be loaded. Connect again.'; }
  }
  save() {
    const contents=JSON.stringify(this.data);
    this.saving=(this.saving||Promise.resolve()).catch(()=>{}).then(async()=>{
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await chmod(path.dirname(this.file), 0o700);
      const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temporary, contents, { mode: 0o600 });
      await rename(temporary, this.file);
    });
    return this.saving;
  }
  async status() {
    await this.ready;
    return { configured: this.configured, connectOrigin: this.origin, connected: Boolean(this.data.tokens), needsReconnect: this.needsReconnect,
      canUpload: this.data.scopes?.includes('activity:write') === true && !this.needsReconnect, athleteId: this.data.athleteId || this.data.profile?.athleteId || null,
      refreshing: Boolean(this.refreshing), profile: this.data.profile || null, error: this.error };
  }
  begin(origin) {
    if (!this.configured) throw Error('Configure the Strava client ID and secret on the Mac first.');
    if (origin !== this.origin) throw Error(`Open the rider profile at ${this.origin} on the Mac to connect Strava.`);
    // One pending flow per local rider. A new attempt invalidates the previous one.
    const state = randomBytes(32).toString('hex'), binding = randomBytes(32).toString('hex');
    this.state = { state, binding, expires: this.now() + 600000 };
    const url = new URL('https://www.strava.com/oauth/authorize');
    for (const [key, value] of Object.entries({ client_id: this.clientId, redirect_uri: this.redirect, response_type: 'code', approval_prompt: 'force', scope: scopes.join(','), state })) url.searchParams.set(key, value);
    return { url: url.href, binding };
  }
  async request(url, options = {}) {
    let response;
    try { response = await this.fetcher(url, { ...options, signal: AbortSignal.timeout(15000) }); }
    catch { throw Error('Strava is unavailable. Your saved data remains on the Mac.'); }
    if (!response.ok) {
      const error = Error(response.status === 429 ? 'Strava rate limit reached. Try refreshing later.' : `Strava request failed (${response.status}). Your saved data remains on the Mac.`);
      error.status = response.status;
      try { const body=await response.json();const duplicate=JSON.stringify(body).match(/duplicate of activity (\d+)/i);if(duplicate)error.duplicateActivityId=duplicate[1]; } catch {}
      throw error;
    }
    return response.json();
  }
  async token(fields) {
    const result = await this.request('https://www.strava.com/oauth/token', { method: 'POST', body: new URLSearchParams({ client_id: this.clientId, client_secret: this.secret, ...fields }) });
    if (!result.access_token || !result.refresh_token || !Number.isFinite(result.expires_at)) throw Error('Strava returned an incomplete authorization. Connect again.');
    return { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: result.expires_at };
  }
  async callback(params, binding) {
    await this.ready;
    const pending = this.state;
    if (!pending || !equal(params.get('state'), pending.state) || !equal(binding, pending.binding) || pending.expires < this.now()) throw Error('Strava authorization expired or did not match this browser. Connect again.');
    this.state = null;
    if (params.get('error') || !params.get('code')) throw Error('Strava authorization was cancelled.');
    const granted = (params.get('scope') || '').split(',');
    if (!profileScopes.every(scope => granted.includes(scope))) throw Error('Allow profile access in Strava to import your zones.');
    if (this.refreshing) await this.refreshing;
    const tokens = await this.token({ grant_type: 'authorization_code', code: params.get('code') });
    // Clear the previous athlete before loading the newly authorized account.
    this.data = { tokens, scopes: granted }; this.needsReconnect = false; this.error = null;
    await this.save(); await this.refresh(true);
  }
  async accessToken(force = false) {
    await this.ready;
    if (this.tokenRefresh) return this.tokenRefresh;
    if (!this.data.tokens) throw Error('Connect Strava first.');
    if (force || this.data.tokens.expires_at * 1000 < this.now() + 60000) {
      this.tokenRefresh = (async () => {
        try { const account=this.data;const tokens=await this.token({ grant_type: 'refresh_token', refresh_token: account.tokens.refresh_token }); if(this.data!==account)throw Object.assign(Error('Strava account changed during authorization.'),{status:403}); this.data.tokens=tokens;await this.save(); return tokens.access_token; }
        catch (e) { if ([400, 401].includes(e.status)) this.needsReconnect = true; throw e; }
        finally { this.tokenRefresh = null; }
      })();
      return this.tokenRefresh;
    }
    return this.data.tokens.access_token;
  }
  async uploadActivity(file, ride) {
    const status = await this.status();
    if (!status.connected || !status.canUpload) throw Object.assign(Error('Reconnect Strava and allow activity uploads from Rider Profile.'), {status:403});
    if (ride.athleteId && status.athleteId !== ride.athleteId) throw Object.assign(Error('Connect the Strava account used for this recording before uploading.'),{status:403});
    const form = new FormData();
    form.set('file', new Blob([file], {type:'application/octet-stream'}), `pelotonic-${ride.id}.fit`);
    form.set('data_type','fit'); form.set('trainer','1'); form.set('name',ride.name);
    form.set('external_id',`pelotonic-${ride.id}.fit`);
    form.set('description',ride.description || 'Recorded by PelotonicReaction from Grupetto.');
    let token;try{token=await this.accessToken();}catch(e){e.beforeSubmit=true;throw e;}
    if ((await this.status()).athleteId !== status.athleteId) throw Object.assign(Error('Strava account changed. Retry after checking Rider Profile.'),{status:403});
    const submit=()=>this.request('https://www.strava.com/api/v3/uploads',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});
    try { return await submit(); } catch(e) { if(e.status!==401)throw e;token=await this.accessToken(true);if((await this.status()).athleteId!==status.athleteId)throw Object.assign(Error('Strava account changed. Check Rider Profile.'),{status:403});return submit(); }
  }
  async get(resource) {
    let token = await this.accessToken();
    const request = () => this.request(`https://www.strava.com/api/v3/${resource}`, { headers: { Authorization: `Bearer ${token}` } });
    try { return await request(); }
    catch (e) { if (e.status !== 401) throw e; token = await this.accessToken(true); return request(); }
  }
  async refresh(force = false) {
    await this.ready;
    if (this.refreshing) return this.refreshing;
    if (!this.configured || !this.data.tokens || this.needsReconnect) return this.status();
    if (!force && this.lastAttempt && this.now() - this.lastAttempt < 60000) return this.status();
    this.lastAttempt = this.now();
    this.refreshing = (async () => {
      try {
        // Sequential so a rotated refresh token is persisted before the next request.
        const account=this.data;
        const athlete = await this.get('athlete');
        let zones, zoneError;
        try { zones = await this.get('athlete/zones'); } catch { zoneError = 'Zones could not be refreshed; previous zones are retained when available.'; }
        if(this.data!==account)return this.status();
        const old = this.data.profile?.athleteId === athlete.id ? this.data.profile : null;
        this.data.athleteId = athlete.id;
        this.data.profile = sanitizeStravaProfile({ athleteId: athlete.id,
          displayName: [athlete.firstname, athlete.lastname].filter(Boolean).join(' ').slice(0, 80) || null,
          ftpWatts: athlete.ftp ?? null, speedUnit: athlete.measurement_preference === 'feet' ? 'mph' : athlete.measurement_preference === 'meters' ? 'km/h' : null,
          weightKg: athlete.weight ?? null, sex: athlete.sex ?? null,
          bikes: athlete.bikes || [], heartRateZones: zones ? zones.heart_rate?.zones : old?.heartRateZones,
          powerZones: zones ? zones.power?.zones : old?.powerZones,
          customHeartRateZones: zones ? zones.heart_rate?.custom_zones === true : old?.customHeartRateZones,
          syncedAt: new Date(this.now()).toISOString(), zonesSyncedAt: zones ? new Date(this.now()).toISOString() : old?.zonesSyncedAt || null });
        await this.save(); this.error = zoneError || null;
      } catch (e) { this.error = e.message; }
      finally { this.refreshing = null; }
      return this.status();
    })();
    return this.refreshing;
  }
  async disconnect() {
    await this.ready; if (this.refreshing) await this.refreshing;
    // Forget locally even if Strava is offline. Revocation is also available in Strava settings.
    let warning = null;
    if (this.data.tokens) try { await this.request('https://www.strava.com/oauth/deauthorize', { method: 'POST', body: new URLSearchParams({ access_token: this.data.tokens.access_token }) }); }
    catch { warning = 'Disconnected locally. To revoke access while Strava is unavailable, use Strava’s My Apps settings.'; }
    this.data = {}; this.state = null; this.needsReconnect = false; this.error = warning; await this.save(); return this.status();
  }
}
