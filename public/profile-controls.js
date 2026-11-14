import { effectiveProfile } from './strava-profile.js';
import { createProfile, estimatedZones, validateProfile, loadProfile, PROFILE_KEY } from './rider-profile.js';
const $ = id => document.getElementById(id);
export class ProfileControls {
  constructor(onChange) {
    this.onChange = onChange;
    try { this.profile = loadProfile(localStorage); }
    catch { this.profile = createProfile(); $('profile-status').textContent = 'Using the default profile; saved profile could not be loaded. Export a copy to keep your settings.'; }
    this.localProfile = this.profile; delete this.localProfile.strava; this.remote = null;
    $('rider-profile-open').onclick = () => this.open();
    $('profile-cancel').onclick = () => $('rider-profile-dialog').close();
    $('profile-form').onsubmit = event => { event.preventDefault(); this.commitDraft(); };
    $('profile-recalculate').onclick = () => {
      const age = Number($('profile-age').value);
      if (!Number.isInteger(age) || age < 1 || age > 120) { $('profile-message').textContent = 'Age must be 1–120 years.'; return; }
      this.draft.ageYears = age; this.draft.heartRate = { maxBpm: 220 - age, maxMethod: '220-age', zones: estimatedZones(220 - age) };
      $('profile-max').value = this.draft.heartRate.maxBpm; this.showZones();
    };
    $('profile-max').onchange = () => {
      const max = Number($('profile-max').value);
      if (!Number.isInteger(max) || max < 60 || max > 240) return;
      this.draft.heartRate = { maxBpm: max, maxMethod: 'manual', zones: estimatedZones(max) }; this.showZones();
    };
    $('profile-export').onclick = () => {
      const blob = new Blob([JSON.stringify(this.profile, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'pelotonic-rider-profile.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    $('profile-import-open').onclick = () => $('profile-import-file').click();
    $('profile-import-file').onchange = async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 65536) throw Error('Choose a profile smaller than 64 KB.');
        this.draft = validateProfile(JSON.parse(await file.text())); delete this.draft.strava; this.fill();
        $('profile-message').textContent = 'Profile loaded for review. Save profile to apply, or Cancel to discard.';
      } catch (error) { $('profile-message').textContent = error.message; }
      event.target.value = '';
    };
    this.summary();
    $('strava-connect').onclick = () => this.connectStrava();
    $('strava-refresh').onclick = () => this.syncStrava(true);
    $('strava-disconnect').onclick = () => this.syncStrava(false, true);
    void this.syncStrava(false);
  }
  summary() { $('rider-profile-open').textContent = `${this.profile.displayName} · Profile`; }
  open() { if (!document.getElementById('player').hidden) return; this.draft = structuredClone(this.localProfile); this.fill(); $('profile-message').textContent = ''; $('rider-profile-dialog').showModal(); }
  fill() {
    const p = effectiveProfile(this.draft, this.remote), r = p.strava;
    $('profile-ftp').value = p.power.ftpWatts ?? '';
    $('profile-power-average').value = p.preferences.powerAverageSeconds;
    $('profile-speed-units').value = p.preferences.speedUnit;
    $('profile-name').value = p.displayName; $('profile-age').value = p.ageYears; $('profile-max').value = p.heartRate.maxBpm;
    $('profile-name').readOnly = Boolean(r?.displayName);
    $('profile-ftp').readOnly = r?.ftpWatts != null;
    $('profile-speed-units').disabled = Boolean(r?.speedUnit);
    for (const id of ['profile-age','profile-max','profile-recalculate']) { $(id).disabled = Boolean(r?.heartRateZones.length); if (id !== 'profile-recalculate') $(id).closest('label').hidden = Boolean(r?.heartRateZones.length); else $(id).hidden = Boolean(r?.heartRateZones.length); }
    $('profile-ftp').title = r?.ftpWatts != null ? 'Edit FTP in Strava, then refresh.' : 'Strava did not supply FTP. Enter a local fallback if needed.';
    this.showZones();
  }
  showZones() {
    const r = this.remote;
    $('profile-method').textContent = r?.heartRateZones.length ? `Heart-rate zones from Strava${r.customHeartRateZones ? ' · Custom' : ''}` : this.draft.heartRate.maxMethod === '220-age' ? `220 − ${this.draft.ageYears} = ${this.draft.heartRate.maxBpm} BPM (local estimate)` : `Local maximum: ${this.draft.heartRate.maxBpm} BPM`;
    const rows = (id, values) => {
      const body = $(id); body.replaceChildren();
      for (const texts of values) { const row = document.createElement('tr'); for (const text of texts) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); } body.append(row); }
    };
    const range = (z, unit) => `${z.min}${z.max === null ? '+' : '–' + (z.max - 1)} ${unit}`;
    rows('profile-zones', r?.heartRateZones.length ? r.heartRateZones.map(z => [`Z${z.zone}`, range(z,'BPM')]) : this.draft.heartRate.zones.map(z => [`Z${z.zone} · ${z.name}`, `${z.minBpm}–${z.maxBpm} BPM`]));
    $('profile-power-table').hidden = !r?.powerZones.length;
    rows('profile-power-zones', (r?.powerZones || []).map(z => [`Z${z.zone}`, range(z,'W')]));
  }
  async api(action, body = {}) {
    const response = await fetch('/api/strava/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw Error(result.error || 'Unable to contact Strava.'); return result;
  }
  async connectStrava() {
    try { const result = await this.api('connect'); location.assign(result.url); }
    catch (e) { $('strava-status').textContent = e.message; }
  }
  async syncStrava(force, disconnect = false) {
    if (this.syncing) return;
    this.syncing = true;
    for (const id of ['strava-connect','strava-refresh','strava-disconnect']) $(id).disabled = true;
    $('strava-status').textContent = disconnect ? 'Disconnecting…' : 'Refreshing Strava profile…';
    try {
      if (!force && !disconnect) {
        const cached = await (await fetch('/api/strava/profile')).json();
        this.remote = cached.profile; this.setProfile(this.localProfile);
        if ($('rider-profile-dialog').open) this.fill();
      }
      const status = await this.api(disconnect ? 'disconnect' : 'refresh', { force });
      this.remote = status.profile;
      this.setProfile(this.localProfile);
      if ($('rider-profile-dialog').open) this.fill();
      const when = this.remote?.syncedAt ? new Date(this.remote.syncedAt).toLocaleString() : null;
      $('strava-status').textContent = [status.needsReconnect ? 'Reconnect Strava to restore access.' : status.connected ? 'Connected to Strava.' : 'Strava is not connected.', when ? `Profile updated ${when}.` : '', status.connected && !status.canUpload ? 'Reconnect and allow activity uploads to send recorded rides to Strava.' : '', status.error || ''].filter(Boolean).join(' ');
      const returnStatus = new URLSearchParams(location.search).get('strava');
      if (returnStatus === 'failed') $('strava-status').textContent += ' Authorization was cancelled, expired, or profile access was not granted. Try connecting again.';
      $('strava-help').replaceChildren();
      if (!status.configured) $('strava-help').textContent = 'Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET on the Mac, then restart the app. See README for setup.';
      else if (status.connectOrigin !== location.origin) {
        $('strava-help').append('Connect using the Mac browser at ');
        const link = document.createElement('a'); link.href = status.connectOrigin; link.textContent = status.connectOrigin; $('strava-help').append(link, '. The bike uses the same connected profile.');
      } else $('strava-help').textContent = 'Edit imported values in Strava, then refresh here. Completed rides upload automatically when activity upload permission is granted. Missing values use local fallbacks.';
      const r = this.remote;
      $('strava-details').textContent = r ? [`Athlete ${r.athleteId}`, r.weightKg ? `${r.weightKg} kg` : '', r.sex ? `Sex: ${r.sex}` : '', ...r.bikes.map(b => `${b.name}${b.primary ? ' (primary bike)' : ''}`), r.zonesSyncedAt && r.zonesSyncedAt !== r.syncedAt ? `Zones last updated ${new Date(r.zonesSyncedAt).toLocaleString()}` : ''].filter(Boolean).join(' · ') : '';
      $('strava-connect').textContent = status.connected ? 'Reconnect with Strava' : 'Connect with Strava';
      $('strava-connect').disabled = !status.configured || status.connectOrigin !== location.origin;
      $('strava-refresh').disabled = !status.connected || status.needsReconnect;
      $('strava-disconnect').disabled = !status.connected && !status.profile;
    } catch { $('strava-status').textContent = 'The profile server is unavailable. Your current settings remain in use.'; for (const id of ['strava-connect','strava-refresh','strava-disconnect']) $(id).disabled = false; }
    finally { this.syncing = false; }
  }
  commitDraft() {
    try {
      if (this.remote?.ftpWatts == null) this.draft.power.ftpWatts = $('profile-ftp').value === '' ? null : Number($('profile-ftp').value);
      this.draft.preferences.powerAverageSeconds = Number($('profile-power-average').value);
      if (!this.remote?.speedUnit) this.draft.preferences.speedUnit = $('profile-speed-units').value;
      if (!this.remote?.displayName) this.draft.displayName = $('profile-name').value.trim();
      if (!this.remote?.heartRateZones.length) this.draft.ageYears = Number($('profile-age').value);
      this.setProfile(validateProfile(this.draft)); $('rider-profile-dialog').close();
    } catch (error) { $('profile-message').textContent = error.message; }
  }
  setProfile(profile) {
    this.localProfile = validateProfile(profile); delete this.localProfile.strava;
    this.profile = effectiveProfile(this.localProfile, this.remote);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(this.localProfile)); $('profile-status').textContent = ''; }
    catch { $('profile-status').textContent = 'Profile is active but could not be saved in this browser. Export a copy.'; }
    this.summary(); this.onChange(this.profile);
  }
  preference(key, value) { const next = structuredClone(this.localProfile); next.preferences[key] = value; this.setProfile(next); }
}
