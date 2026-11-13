import { ProfileControls } from './profile-controls.js';
import { zoneAt, zoneRangeLabel } from './rider-profile.js';
import { TARGET_FIELDS, programTarget, targetCorrection, isPrimaryTarget } from './target-guidance.js';
import { liveReading, speedValue, distanceValue } from './live-metrics.js';
const node = (tag, text, className) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (className) n.className = className; return n; };
const number = value => Number.isFinite(value) ? String(Math.round(value)) : '—';
const targetNumber = value => String(Math.round(value * 10) / 10);
export class BikePanel {
  constructor() {
    this.snapshot = { metrics: {}, status: 'Bike connects at ride start', connected: false };
    this.receivedAt = performance.now(); this.recording = false;
    this.step = null; this.corrections = new Map();
    this.desired = false; this.noBikeOffered = false; this.posting = false;
    try { this.client = sessionStorage.getItem('pr-bike-client') || globalThis.crypto?.randomUUID?.() || `screen-${Date.now()}-${Math.random().toString(16).slice(2)}`; sessionStorage.setItem('pr-bike-client', this.client); }
    catch { this.client = `screen-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
    this.profileControls = new ProfileControls(profile => {
      this.profile = profile; this.seconds = profile.preferences.powerAverageSeconds; this.unit = profile.preferences.speedUnit;
      if (this.desired) this.command('average', { seconds: this.seconds });
      this.corrections.clear(); this.render();
    });
    this.profile = this.profileControls.profile;
    this.seconds = this.profile.preferences.powerAverageSeconds; this.unit = this.profile.preferences.speedUnit;
    this.status = document.getElementById('bike-status'); this.cards = [];
    const grid = document.getElementById('ride-metrics');
    const primary = node('div', null, 'primary-metrics'), secondary = node('div', null, 'secondary-metrics');
    grid.append(primary, secondary);
    for (const [key, label] of [['cadence', 'CADENCE'], ['power', 'OUTPUT'], ['resistance', 'RESISTANCE'], ['speed', 'SPEED'], ['hr', 'HEART RATE'], ['distance', 'DISTANCE'], ['calories', 'CALORIES']]) {
      const card = node('article', null, 'ride-metric'); card.dataset.metric = key;
      const title = node('h3', label), value = node('strong', '—', 'ride-metric-value');
      const unit = node('span', '', 'ride-metric-unit'), detail = node('p', '', 'ride-metric-detail');
      const actualRow = node('div', null, 'metric-actual-row'), arrow = node('span', '', 'metric-correction');
      arrow.setAttribute('role', 'img'); arrow.hidden = true;
      actualRow.append(value, arrow);
      const targetLabel = node('p', '', 'metric-target'); targetLabel.hidden = !(key in TARGET_FIELDS);
      card.append(title, actualRow, targetLabel, unit, detail); (['cadence', 'power', 'resistance'].includes(key) ? primary : secondary).append(card);
      this.cards.push({ key, card, value, unit, detail, arrow, targetLabel });
    }
    this.events = new EventSource(`/api/bike/events?client=${encodeURIComponent(this.client)}`);
    this.events.onmessage = event => {
      try { this.snapshot = JSON.parse(event.data); this.receivedAt = performance.now(); } catch { return; }
      if (this.desired && this.snapshot.noBike && !this.noBikeOffered) {
        this.noBikeOffered = true; document.getElementById('bike-dialog').showModal();
      }
      if (this.snapshot.connected) document.getElementById('bike-dialog').close();
      this.render();
    };
    this.events.onerror = () => { this.snapshot = { ...this.snapshot, connected: false, status: 'Reconnecting to workout server…' }; this.render(); };
    document.getElementById('bike-dialog-close').onclick = () => document.getElementById('bike-dialog').close();
    document.getElementById('bike-address-form').onsubmit = async event => {
      event.preventDefault();
      const ok = await this.command('address', { host: document.getElementById('bike-host').value.trim(), port: document.getElementById('bike-port').value });
      if (ok) document.getElementById('bike-dialog').close();
    };
    setInterval(() => this.render(), 250);
    // Reassert the ride session quietly after server restart or a missed request.
    setInterval(() => { if (this.desired) this.ensureSession(); }, 5000);
    this.render();
  }
  async command(action, fields = {}) {
    try {
      const response = await fetch('/api/bike/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, client: this.client, ...fields }), keepalive: action === 'stop' });
      if (!response.ok) { const data = await response.json(); this.snapshot.status = data.error || 'Bike connection retrying…'; return false; }
      return true;
    } catch { this.snapshot.status = 'Bike connection retrying…'; return false; }
  }
  async ensureSession() {
    if (this.posting || !this.desired) return;
    this.posting = true;
    try { if (await this.command('start') && this.desired) { await this.command('average', { seconds: this.seconds }); if (this.desired) await this.command('timing', { recording: this.recording }); } }
    finally { this.posting = false; }
  }
  begin() { if (!this.desired) { this.desired = true; this.noBikeOffered = false; this.ensureSession(); } }
  end() { this.desired = false; this.recording = false; document.getElementById('bike-dialog').close(); this.command('stop'); }
  setStep(step) {
    if (this.step !== step) { this.step = step; this.corrections.clear(); }
  }
  setRecording(recording) {
    if (recording === this.recording) return;
    this.recording = recording;
    if (this.desired) this.command('timing', { recording });
  }
  render() {
    const now = performance.now();
    const raw = key => liveReading(this.snapshot, key, this.receivedAt, now);
    const speed = raw('Speed'), cadence = raw('Cadence'), power = raw('Power'), hr = raw('Heart rate'), resistance = raw('Resistance');
    const ride = this.snapshot.ride || {};
    const decimal = value => Number.isFinite(value) ? value.toFixed(1) : '—';
    const stale = reading => reading.value == null ? 'Waiting for bike data' : reading.fresh ? '' : 'Last reading · reconnecting';
    const diagnostics = this.snapshot.notificationCount;
    this.status.textContent = this.snapshot.status + (Number.isFinite(diagnostics) ? ` · ${diagnostics} bike updates` : '');
    const avg = this.snapshot.averagingSeconds === this.seconds && Number.isFinite(this.snapshot.powerAverage) ? this.snapshot.powerAverage : power.value;
    for (const { key, card, value, unit, detail, arrow, targetLabel } of this.cards) {
      const reading = ({ speed, cadence, power, hr, resistance })[key];
      card.dataset.stale = String(reading ? !reading.fresh : false);
      if (key === 'speed') {
        value.textContent = decimal(speedValue(speed.value, this.unit)); unit.textContent = this.unit;
        detail.textContent = `Ride avg ${decimal(speedValue(ride.speedAverageKmh, this.unit))} ${this.unit}${stale(speed) ? ' · ' + stale(speed) : ''}`;
      } else if (key === 'cadence') {
        value.textContent = number(cadence.value); unit.textContent = 'RPM';
        detail.textContent = `Ride avg ${number(ride.cadenceAverageRpm)} RPM${stale(cadence) ? ' · ' + stale(cadence) : ''}`;
      } else if (key === 'resistance') {
        value.textContent = number(resistance.value); unit.textContent = '0–100';
        detail.textContent = stale(resistance) || 'Current';
      } else if (key === 'power') {
        value.textContent = number(avg); unit.textContent = this.seconds ? `W · ${this.seconds}s average` : 'W · current';
        detail.textContent = `Current ${number(power.value)} W · ${decimal(ride.energyKj)} kJ${stale(power) ? ' · ' + stale(power) : ''}`;
      } else if (key === 'hr') {
        const zone = zoneAt(hr.value, this.profile);
        const zoneMode = this.profile.preferences.heartRateDisplay === 'zone';
        value.textContent = hr.value == null ? '—' : zoneMode ? zone.label : number(hr.value);
        unit.textContent = zoneMode ? 'ZONE' : 'BPM';
        detail.textContent = (hr.value == null ? '' : zoneMode ? `${number(hr.value)} BPM` : zone.label) + (stale(hr) ? ' · ' + stale(hr) : '');
      } else if (key === 'distance') {
        value.textContent = decimal(distanceValue(ride.distanceKm, this.unit)); unit.textContent = this.unit === 'mph' ? 'miles' : 'km';
        detail.textContent = 'Ride total';
      } else if (key === 'calories') {
        value.textContent = number(ride.estimatedCaloriesKcal); unit.textContent = 'kcal';
        detail.textContent = 'Ride total';
      }
      if (key in TARGET_FIELDS) {
        const target = programTarget(this.step, key, this.profile);
        const actual = key === 'power' ? avg : reading.value;
        const primary = isPrimaryTarget(this.step, key);
        const correction = targetCorrection(actual, target, reading.fresh && primary, this.corrections.get(key));
        this.corrections.set(key, correction); card.dataset.correction = correction.level;
        const numericTarget = target ? target.high === Infinity ? `${targetNumber(target.low)}+` : target.low === target.high ? targetNumber(target.low) : `${targetNumber(target.low)}–${targetNumber(target.high)}` : null;
        const targetText = target && key === 'hr' && this.profile.preferences.heartRateDisplay === 'zone' ? zoneRangeLabel([target.low, target.high], this.profile) : numericTarget;
        targetLabel.textContent = target ? `/ ${target?.zone ? `Z${target.zone} · ` : ''}${targetText} ${primary ? 'primary' : 'reference'}` : key === 'power' && this.step?.powerZone != null ? `/ Z${this.step.powerZone} · set FTP` : 'No target';
        card.dataset.primary = String(primary);
        targetLabel.title = target && key === 'hr' ? `${numericTarget} BPM target` : '';
        // HR comparisons always use BPM, even when the displayed number is a zone.
        if (target && key === 'hr' && this.profile.preferences.heartRateDisplay === 'zone') detail.textContent += ` · target ${numericTarget} BPM`;
        arrow.hidden = correction.direction == null;
        arrow.textContent = correction.direction === 'increase' ? '↑' : correction.direction === 'decrease' ? '↓' : '';
        const instruction = correction.direction ? `${correction.level === 'large' ? 'Large' : 'Small'} correction: ${correction.direction} ${key === 'hr' ? 'heart rate / effort' : key === 'power' ? 'power' : key}` : '';
        arrow.setAttribute('aria-label', instruction); arrow.title = instruction;
        if (correction.level === 'on') targetLabel.title = targetLabel.title ? `${targetLabel.title} · On target` : 'On target';
      }
    }
  }
}
