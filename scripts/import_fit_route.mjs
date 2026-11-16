import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Decoder, Stream } from '@garmin/fitsdk';
import { compileWorkout } from '../public/workout.js';

import { terrainWorkout } from '../lib/fit-route.mjs';
export { terrainWorkout } from '../lib/fit-route.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, minutes = '45'] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node scripts/import_fit_route.mjs input.fit output.json [minutes]');
  const decoder = new Decoder(Stream.fromByteArray(await readFile(input)));
  if (!decoder.checkIntegrity()) throw Error('FIT integrity check failed.');
  const { messages, errors } = decoder.read();
  if (errors.length) throw Error(`FIT decoding failed: ${errors.map(String).join('; ')}`);
  const workout = terrainWorkout(messages.recordMesgs || [], { minutes: Number(minutes), name: messages.courseMesgs?.[0]?.name || 'Garmin terrain test', coursePoints: messages.coursePointMesgs || [] });
  await writeFile(output, JSON.stringify(workout, null, 2) + '\n');
  console.log(JSON.stringify({ output, distanceKm: workout.source.distanceKm, durationSeconds: compileWorkout(workout).totalSeconds, blocks: workout.steps.length, subSport: messages.sessionMesgs?.[0]?.subSport }, null, 2));
}
