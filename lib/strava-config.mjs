import { readFile } from 'node:fs/promises';
import path from 'node:path';
// A small literal .env reader; no expansion or shell evaluation. Environment wins.
export async function stravaEnvironment(base, env = process.env) {
  const values = {};
  try {
    for (const line of (await readFile(path.join(base, '.env'), 'utf8')).split(/\r?\n/)) {
      const match = line.match(/^\s*(STRAVA_CLIENT_ID|STRAVA_CLIENT_SECRET|STRAVA_REDIRECT_URI)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1,-1);
      values[match[1]] = value;
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { ...values, ...env };
}
