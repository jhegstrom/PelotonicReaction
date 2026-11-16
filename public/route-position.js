// Route distances are metres; bike distance is kilometres. Never advance from time.
export function validateRoute(route) {
  if (route == null) return;
  if (!route || !Array.isArray(route.points) || route.points.length < 2 || route.points.length > 20000) throw Error('route.points needs 2–20000 distance/elevation samples.');
  if (route.landmarks != null && (!Array.isArray(route.landmarks) || route.landmarks.length > 1000 || route.landmarks.some(p => !p || !Number.isFinite(p.distance) || p.distance < 0 || p.distance > route.points.at(-1).distance || typeof p.name !== 'string' || p.name.length > 160))) throw Error('Route landmarks need a valid distance and short name.');
  let previous = -1;
  for (const p of route.points) {
    if (!p || !Number.isFinite(p.distance) || p.distance <= previous || !Number.isFinite(p.altitude) || p.altitude < -12000 || p.altitude > 12000) throw Error('Route distances must increase and elevations must be finite metres.');
    if (previous === -1 && p.distance !== 0) throw Error('Route distance must start at zero.');
    const gps = p.lat != null || p.lon != null;
    if (gps && (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) throw Error('Route coordinates must be valid latitude/longitude degrees.');
    previous = p.distance;
  }
}
export function routePosition(points, distanceKm) {
  const distance = Math.min(points.at(-1).distance, Math.max(0, Number.isFinite(distanceKm) ? distanceKm * 1000 : 0));
  let lo = 1, hi = points.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid].distance < distance) lo = mid + 1; else hi = mid; }
  const a = points[lo - 1], b = points[lo], f = (distance - a.distance) / (b.distance - a.distance);
  const mix = key => a[key] + (b[key] - a[key]) * f;
  return { distance, altitude: mix('altitude'), lat: mix('lat'), lon: mix('lon'), grade: 100 * (b.altitude - a.altitude) / (b.distance - a.distance) };
}
