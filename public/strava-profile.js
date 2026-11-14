// Whitelist the portable athlete snapshot. OAuth credentials never belong in a rider profile.
export function sanitizeStravaProfile(input) {
  if (!input || !Number.isSafeInteger(input.athleteId) || input.athleteId <= 0) throw Error('Invalid Strava athlete.');
  const zones = list => {
    if (!Array.isArray(list) || !list.length || list.length > 10) return [];
    const result = list.map(({ min, max }, i) => ({ zone: i + 1, min, max: max === -1 ? null : max }));
    if (result.some((z, i) => !Number.isInteger(z.min) || z.min < 0 || (z.max !== null && (!Number.isInteger(z.max) || z.max <= z.min)) || (z.max === null && i !== result.length - 1) || (i && z.min !== result[i - 1].max))) return [];
    return result;
  };
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  return { athleteId: input.athleteId, displayName: typeof input.displayName === 'string' && input.displayName.trim() ? input.displayName.trim().slice(0,80) : null,
    ftpWatts: Number.isInteger(input.ftpWatts) && input.ftpWatts >= 20 && input.ftpWatts <= 1500 ? input.ftpWatts : null,
    speedUnit: ['mph','km/h'].includes(input.speedUnit) ? input.speedUnit : null,
    weightKg: Number.isFinite(input.weightKg) && input.weightKg > 0 && input.weightKg < 500 ? input.weightKg : null,
    sex: ['M','F'].includes(input.sex) ? input.sex : null,
    bikes: Array.isArray(input.bikes) ? input.bikes.slice(0,50).map(b => ({ id: String(b.id).slice(0,80), name: String(b.name || 'Bike').slice(0,120), primary: b.primary === true, distance: Number.isFinite(b.distance) && b.distance >= 0 ? b.distance : null })) : [],
    heartRateZones: zones(input.heartRateZones), powerZones: zones(input.powerZones), customHeartRateZones: input.customHeartRateZones === true,
    syncedAt: date(input.syncedAt), zonesSyncedAt: date(input.zonesSyncedAt) };
}
export function effectiveProfile(local, remote) {
  const p = structuredClone(local); delete p.strava;
  if (!remote) return p;
  p.strava = sanitizeStravaProfile(remote);
  if (p.strava.displayName) p.displayName = p.strava.displayName;
  if (p.strava.ftpWatts !== null) p.power.ftpWatts = p.strava.ftpWatts;
  if (p.strava.speedUnit) p.preferences.speedUnit = p.strava.speedUnit;
  return p;
}
// Strava ranges share boundaries; treat the upper edge as exclusive, with null = open.
export function importedZoneRange(zones, zone) {
  const z = zones?.find(z => z.zone === zone);
  return z ? { low: z.min, high: z.max === null ? Infinity : z.max - 1, explicitRange: true, zone } : null;
}
