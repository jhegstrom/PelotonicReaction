import { createProfile, estimatedZones, validateProfile, loadProfile, PROFILE_KEY } from './rider-profile.js';
const $ = id => document.getElementById(id);
export class ProfileControls {
  constructor(onChange) {
    this.onChange = onChange;
    try { this.profile = loadProfile(localStorage); }
    catch { this.profile = createProfile(); $('profile-status').textContent = 'Using the default profile; saved profile could not be loaded. Export a copy to keep your settings.'; }
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
        this.draft = validateProfile(JSON.parse(await file.text())); this.fill();
        $('profile-message').textContent = 'Profile loaded for review. Save profile to apply, or Cancel to discard.';
      } catch (error) { $('profile-message').textContent = error.message; }
      event.target.value = '';
    };
    this.summary();
  }
  summary() { $('rider-profile-open').textContent = `${this.profile.displayName} · Profile`; }
  open() { this.draft = structuredClone(this.profile); this.fill(); $('profile-message').textContent = ''; $('rider-profile-dialog').showModal(); }
  fill() { $('profile-ftp').value = this.draft.power.ftpWatts ?? ''; $('profile-power-average').value = this.draft.preferences.powerAverageSeconds; $('profile-speed-units').value = this.draft.preferences.speedUnit; $('profile-name').value = this.draft.displayName; $('profile-age').value = this.draft.ageYears; $('profile-max').value = this.draft.heartRate.maxBpm; this.showZones(); }
  showZones() {
    $('profile-method').textContent = this.draft.heartRate.maxMethod === '220-age' ? `220 − ${this.draft.ageYears} = ${this.draft.heartRate.maxBpm} BPM (estimate)` : `Custom maximum: ${this.draft.heartRate.maxBpm} BPM`;
    const body = $('profile-zones'); body.replaceChildren();
    for (const zone of this.draft.heartRate.zones) {
      const row = document.createElement('tr');
      for (const text of [`Z${zone.zone} · ${zone.name}`, `${zone.minBpm}–${zone.maxBpm} BPM`]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
      body.append(row);
    }
  }
  commitDraft() {
    try {
      this.draft.power.ftpWatts = $('profile-ftp').value === '' ? null : Number($('profile-ftp').value);
      this.draft.preferences.powerAverageSeconds = Number($('profile-power-average').value);
      this.draft.preferences.speedUnit = $('profile-speed-units').value;
      this.draft.displayName = $('profile-name').value.trim(); this.draft.ageYears = Number($('profile-age').value);
      this.setProfile(validateProfile(this.draft)); $('rider-profile-dialog').close();
    } catch (error) { $('profile-message').textContent = error.message; }
  }
  setProfile(profile) {
    this.profile = validateProfile(profile);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile)); $('profile-status').textContent = ''; }
    catch { $('profile-status').textContent = 'Profile is active but could not be saved in this browser. Export a copy.'; }
    this.summary(); this.onChange(this.profile);
  }
  preference(key, value) { const next = structuredClone(this.profile); next.preferences[key] = value; this.setProfile(next); }
}
