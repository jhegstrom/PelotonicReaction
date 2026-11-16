import { createHash } from 'node:crypto';
import { Decoder, Stream } from '@garmin/fitsdk';
import { compileWorkout } from '../public/workout.js';

// Experimental terrain interpretation, not a replay of outdoor power or speed.
export function terrainWorkout(records, { minutes = 45, name = 'Garmin terrain test', coursePoints = [] } = {}) {
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 180) throw Error('Minutes must be an integer from 15 to 180.');
  const points = [];
  for (const r of records) {
    const altitude = r.enhancedAltitude ?? r.altitude;
    if (!Number.isFinite(r.distance) || !Number.isFinite(altitude)) continue;
    if (points.length && r.distance <= points.at(-1).distance) continue;
    const gps = Number.isFinite(r.positionLat) && Number.isFinite(r.positionLong) && Math.abs(r.positionLat) < 2147483647 && Math.abs(r.positionLong) < 2147483647;
    points.push({ distance: r.distance, altitude, ...(gps ? { lat: r.positionLat * 180 / 2147483648, lon: r.positionLong * 180 / 2147483648 } : {}) });
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
    descent: { label: 'Downhill spin', cue: 'Release resistance. Let your breathing settle and keep your pedals controlled.', cadence: 95, powerZone: 1 },
    flat: { label: 'Steady terrain', cue: 'Find a comfortable rhythm. Keep your effort steady through the changing scenery.', cadence: 85, powerZone: 2 },
    climb: { label: 'Climb', cue: 'Add resistance and keep your pedal stroke smooth.', cadence: 75, powerZone: 3 },
    steep: { label: 'Steep climb', cue: 'Hold a controlled effort. Keep your shoulders relaxed as the trail steepens.', cadence: 65, powerZone: 4 },
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
  const terrainSeconds = minutes * 60;
  let assigned = 0;
  const steps = [];
  blocks.forEach(b => {
    const endSecond = Math.round(b.end / distance * terrainSeconds);
    const durationSeconds = endSecond - assigned;
    assigned = endSecond;
    if (!durationSeconds) return;
    const { label, ...targets } = presets[b.terrain];
    steps.push({ label: `${label} · ${(b.start / 1000).toFixed(1)}–${(b.end / 1000).toFixed(1)} km`,
      kind: b.terrain === 'descent' ? 'recovery' : 'work', durationSeconds, distanceMeters: b.end - b.start,
      ...targets, primaryTargets: ['watts'] });
  });
  if (steps.length > 1) {
    if (steps[0].powerZone <= 2) Object.assign(steps[0], {kind:'warmup', cue:'Find a comfortable rhythm. Gradually add load.'});
    if (steps.at(-1).powerZone <= 2) Object.assign(steps.at(-1), {kind:'cooldown', cue:'Ease down gradually and let your breathing settle.'});
  }
  const lastClimb = steps.findLast(s => s.powerZone >= 3);
  if (lastClimb) lastClimb.cue = 'Last substantial climb. Finish with control.';
  const route = { points: points.map(p => ({ ...p, distance: p.distance - origin })), landmarks: coursePoints.filter(c => Number.isFinite(c.distance) && c.distance >= origin && c.distance <= origin + distance && typeof c.name === 'string').slice(0,1000).map(c => ({ distance: c.distance - origin, name: (c.name === 'Sharp' && c.type === 'sharpRight' ? 'Sharp right' : c.name === 'Sharp' && c.type === 'sharpLeft' ? 'Sharp left' : c.name).slice(0,160) })) };
  const workout = { completionMetric: 'distance', tags: ['Spinulator', 'Power Zone'], route, schemaVersion: 1, name, description: 'Experimental terrain interpretation. Segments complete by distance traveled on the bike. Duration is an estimate; elapsed time does not advance the route. First and final easy sections serve as warmup and cooldown. Power zones require your rider profile; resistance is adjusted to meet power/cadence, not inferred from road grade. Short hills may be smoothed out. Review targets before riding.',
    source: { type: 'local-fit-terrain', distanceKm: Math.round(distance / 10) / 100, method: '100 m elevation samples, five-point smoothing, approximately 1 km sections; grade thresholds -1%, 1.5%, 5%' }, steps };
  compileWorkout(workout);
  return workout;
}


export function importFitWorkout(bytes, filename = 'Garmin ride.fit') {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  if (!decoder.checkIntegrity()) throw Error('This is not a valid FIT file, or its integrity check failed.');
  const { messages, errors } = decoder.read();
  if (errors.length) throw Error('The FIT recording could not be decoded.');
  const session = messages.sessionMesgs?.[0];
  const seconds = session?.totalTimerTime ?? session?.totalElapsedTime;
  const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.max(15, Math.min(180, Math.round(seconds / 60))) : 45;
  const name = (messages.courseMesgs?.[0]?.name || filename.replace(/\.fit$/i, '').replace(/[_-]+/g, ' ') || 'Garmin ride').slice(0, 150);
  const workout = terrainWorkout(messages.recordMesgs || [], { minutes, name, coursePoints: messages.coursePointMesgs || [] });
  workout.id = `fit-route-${createHash('sha256').update(bytes).digest('hex').slice(0,24)}`;
  if (Number.isFinite(seconds)) workout.source.recordedDurationSeconds = seconds;
  if (Number.isFinite(session?.totalAscent)) workout.source.recordedAscentMeters = session.totalAscent;
  return workout;
}
