import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Decoder, Stream } from '@garmin/fitsdk';
import { compileWorkout } from '../public/workout.js';

// Experimental terrain interpretation, not a replay of outdoor power or speed.
export function terrainWorkout(records, { minutes = 45, name = 'Garmin terrain test' } = {}) {
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 180) throw Error('Minutes must be an integer from 15 to 180.');
  const points = [];
  for (const r of records) {
    const altitude = r.enhancedAltitude ?? r.altitude;
    if (!Number.isFinite(r.distance) || !Number.isFinite(altitude)) continue;
    if (points.length && r.distance <= points.at(-1).distance) continue;
    points.push({ distance: r.distance, altitude });
  }
  if (points.length < 2 || points.at(-1).distance - points[0].distance < 1000) throw Error('At least 1 km of distance/elevation samples is required.');
  const origin = points[0].distance, distance = points.at(-1).distance - origin;
  // Resample elevation every 100 m, then average nearby samples to suppress noise.
  let cursor = 1;
  const elevation = d => {
    while (cursor < points.length - 1 && points[cursor].distance < d) cursor++;
    const a = points[cursor - 1], b = points[cursor];
    return a.altitude + (b.altitude - a.altitude) * (d - a.distance) / (b.distance - a.distance);
  };
  const samples = [];
  for (let d = 0; d < distance; d += 100) samples.push({ d, h: elevation(origin + d) });
  samples.push({ d: distance, h: elevation(origin + distance) });
  const smooth = samples.map((p, i) => ({ ...p, h: samples.slice(Math.max(0, i - 2), i + 3).reduce((s, q) => s + q.h, 0) / samples.slice(Math.max(0, i - 2), i + 3).length }));
  const presets = {
    descent: { label: 'Downhill spin', cadence: 95, powerZone: 1 },
    flat: { label: 'Steady terrain', cadence: 85, powerZone: 2 },
    climb: { label: 'Climb', cadence: 75, powerZone: 3 },
    steep: { label: 'Steep climb', cadence: 65, powerZone: 4 },
  };
  const blocks = [];
  // Approximately 1 km sections; limit block count on very long recordings.
  const stride = Math.max(10, Math.ceil((smooth.length - 1) / 100));
  for (let i = 0; i < smooth.length - 1; i += stride) {
    const a = smooth[i], b = smooth[Math.min(i + stride, smooth.length - 1)];
    const grade = 100 * (b.h - a.h) / (b.d - a.d);
    const terrain = grade < -1 ? 'descent' : grade < 1.5 ? 'flat' : grade < 5 ? 'climb' : 'steep';
    const previous = blocks.at(-1);
    if (previous?.terrain === terrain) previous.end = b.d;
    else blocks.push({ terrain, start: a.d, end: b.d });
  }
  const terrainSeconds = minutes * 60 - 480;
  let assigned = 0;
  const steps = [{ label: 'Warm up', kind: 'warmup', durationSeconds: 300, cadence: 80, powerZone: 1, primaryTargets: ['watts', 'cadence'] }];
  blocks.forEach(b => {
    const endSecond = Math.round(b.end / distance * terrainSeconds);
    const durationSeconds = endSecond - assigned;
    assigned = endSecond;
    if (!durationSeconds) return;
    const { label, ...targets } = presets[b.terrain];
    steps.push({ label: `${label} · ${(b.start / 1000).toFixed(1)}–${(b.end / 1000).toFixed(1)} km`,
      kind: b.terrain === 'descent' ? 'recovery' : 'work', durationSeconds,
      ...targets, primaryTargets: ['watts', 'cadence'] });
  });
  steps.push({ label: 'Cool down', kind: 'cooldown', durationSeconds: 180, cadence: 80, powerZone: 1, primaryTargets: ['watts'] });
  const workout = { schemaVersion: 1, name, description: 'Experimental terrain interpretation. Includes 5 min warmup and 3 min cooldown. Route time is scaled by distance, not outdoor speed. Power zones require your rider profile; resistance is adjusted to meet power/cadence, not inferred from road grade. Short hills may be smoothed out. Review targets before riding.',
    source: { type: 'local-fit-terrain', distanceKm: Math.round(distance / 10) / 100, method: '100 m elevation samples, five-point smoothing, approximately 1 km sections; grade thresholds -1%, 1.5%, 5%' }, steps };
  compileWorkout(workout);
  return workout;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, minutes = '45'] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node scripts/import_fit_route.mjs input.fit output.json [minutes]');
  const decoder = new Decoder(Stream.fromByteArray(await readFile(input)));
  if (!decoder.checkIntegrity()) throw Error('FIT integrity check failed.');
  const { messages, errors } = decoder.read();
  if (errors.length) throw Error(`FIT decoding failed: ${errors.map(String).join('; ')}`);
  const workout = terrainWorkout(messages.recordMesgs || [], { minutes: Number(minutes) });
  await writeFile(output, JSON.stringify(workout, null, 2) + '\n');
  console.log(JSON.stringify({ output, distanceKm: workout.source.distanceKm, durationSeconds: compileWorkout(workout).totalSeconds, blocks: workout.steps.length, subSport: messages.sessionMesgs?.[0]?.subSport }, null, 2));
}
