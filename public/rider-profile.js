export const PROFILE_KEY = 'pelotonic-reaction-rider-profile-v1';
const ZONE_NAMES = ['Very light', 'Light', 'Moderate', 'Hard', 'Maximum'];
export function estimatedZones(maxBpm) {
  return ZONE_NAMES.map((name, i) => ({ zone: i + 1, name,
    minBpm: Math.ceil(maxBpm * (50 + i * 10) / 100),
    maxBpm: i === 4 ? maxBpm : Math.ceil(maxBpm * (60 + i * 10) / 100) - 1 }));
}
export function createProfile(ageYears = 64) {
  const maxBpm = 220 - ageYears;
  return { schemaVersion: 1, kind: 'pelotonic-reaction-rider-profile', id: 'local-rider', displayName: 'Rider', ageYears,
    heartRate: { maxBpm, maxMethod: '220-age', zones: estimatedZones(maxBpm) },
    power: { ftpWatts: null },
    preferences: { heartRateDisplay: 'bpm', speedUnit: 'km/h', powerAverageSeconds: 3 } };
}
export function validateProfile(input) {
  const bad = message => { throw Error(message); };
  if (!input || input.schemaVersion !== 1 || input.kind !== 'pelotonic-reaction-rider-profile') bad('Choose a version 1 PelotonicReaction rider profile.');
  if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 100) bad('Profile needs a stable ID.');
  if (typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 80) bad('Enter a rider name (1–80 characters).');
  if (!Number.isInteger(input.ageYears) || input.ageYears < 1 || input.ageYears > 120) bad('Age must be 1–120 years.');
  const hr = input.heartRate;
  if (!hr || !Number.isInteger(hr.maxBpm) || hr.maxBpm < 60 || hr.maxBpm > 240 || !['220-age', 'manual'].includes(hr.maxMethod)) bad('Enter a maximum heart rate from 60–240 BPM.');
  if (hr.maxMethod === '220-age' && hr.maxBpm !== 220 - input.ageYears) bad('Estimated maximum must equal 220 minus age.');
  if (!Array.isArray(hr.zones) || hr.zones.length !== 5) bad('Provide five heart-rate zones.');
  hr.zones.forEach((zone, i) => {
    if (zone.zone !== i + 1 || typeof zone.name !== 'string' || !zone.name.trim() || zone.name.length > 60 || !Number.isInteger(zone.minBpm) || !Number.isInteger(zone.maxBpm) || zone.minBpm < 1 || zone.maxBpm > hr.maxBpm || zone.minBpm > zone.maxBpm || (i && zone.minBpm !== hr.zones[i - 1].maxBpm + 1)) bad('Zone ranges must be ordered, contiguous, whole BPM values without overlaps.');
  });
  if (hr.zones[4].maxBpm !== hr.maxBpm) bad('Zone 5 must end at the configured maximum.');
  const prefs = input.preferences;
  if (!prefs || !['bpm', 'zone'].includes(prefs.heartRateDisplay) || !['km/h', 'mph'].includes(prefs.speedUnit) || !Number.isInteger(prefs.powerAverageSeconds) || prefs.powerAverageSeconds < 0 || prefs.powerAverageSeconds > 300) bad('Profile display preferences are invalid.');
  if (input.power != null && (typeof input.power !== 'object' || Array.isArray(input.power) || (input.power.ftpWatts !== null && (!Number.isInteger(input.power.ftpWatts) || input.power.ftpWatts < 20 || input.power.ftpWatts > 1500)))) bad('FTP must be a whole number from 20–1500 W, or left unset.');
  const normalized = structuredClone(input); normalized.power ??= { ftpWatts: null };
  return normalized;
}
export function zoneAt(bpm, profile) {
  if (!Number.isFinite(bpm)) return null;
  const zones = profile.heartRate.zones;
  if (bpm < zones[0].minBpm) return { label: 'Below Z1', zone: 0 };
  if (bpm > zones[4].maxBpm) return { label: 'Above Z5', zone: 6 };
  // Sensor HR is whole BPM; intervals also classify fractional target bounds without gaps.
  const found = zones.find((z, i) => bpm >= z.minBpm && (i === 4 || bpm < zones[i + 1].minBpm));
  return found ? { label: `Z${found.zone}`, zone: found.zone } : null;
}
export function zoneRangeLabel(range, profile) {
  const low = zoneAt(range[0], profile)?.label, high = zoneAt(range[1], profile)?.label;
  return low === high ? low : `${low}–${high}`;
}
export function loadProfile(storage) {
  const saved = storage.getItem(PROFILE_KEY);
  if (saved) return validateProfile(JSON.parse(saved));
  const profile = createProfile();
  // Carry existing browser preferences into the new portable profile once.
  try {
    const speed = JSON.parse(storage.getItem('pr-bike-speed'));
    const average = JSON.parse(storage.getItem('pr-bike-average'));
    if (['km/h', 'mph'].includes(speed)) profile.preferences.speedUnit = speed;
    if (Number.isInteger(average) && average >= 0 && average <= 300) profile.preferences.powerAverageSeconds = average;
  } catch {}
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}
