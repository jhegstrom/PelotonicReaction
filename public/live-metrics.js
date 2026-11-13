// Metric age arrives from the Mac, then advances on the browser's monotonic clock.
// This must not compare two computers' wall clocks (Peloton clocks can differ).
export function liveReading(snapshot, name, receivedAt, now) {
  const raw = snapshot.metrics?.[name];
  const age = Number.isFinite(raw?.ageMs) ? raw.ageMs + Math.max(0, now - receivedAt) : Infinity;
  const value = Number.isFinite(raw?.value) ? raw.value : null;
  return { value, fresh: snapshot.connected && value != null && age < 5000, age };
}
export function speedValue(kmh, unit) { return Number.isFinite(kmh) ? kmh / (unit === 'mph' ? 1.609344 : 1) : null; }
export function distanceValue(km, unit) { return Number.isFinite(km) ? km / (unit === 'mph' ? 1.609344 : 1) : null; }
