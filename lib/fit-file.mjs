import { Encoder, Profile } from '@garmin/fitsdk';

// FIT uses SI units. Do not put display smoothing or program targets in records.
export function encodeRide(ride, entries) {
  const encoder = new Encoder();
  const write = (name, fields) => encoder.onMesg(Profile.MesgNum[name], fields);
  const start = new Date(ride.startedAt), end = new Date(ride.endedAt);
  write('FILE_ID', { type: 'activity', manufacturer: 'development', product: 1, timeCreated: start });
  write('DEVICE_INFO', { timestamp: start, deviceIndex: 0, manufacturer: 'development', product: 1, productName: 'PelotonicReaction' });
  for (const entry of entries) {
    const timestamp = new Date(entry.at);
    if (entry.type === 'timer') write('EVENT', { timestamp, event: 'timer', eventType: entry.running ? 'start' : 'stopAll', eventGroup: 0 });
    if (entry.type === 'sample') {
      const fields = { timestamp };
      const values = { power: entry.power, cadence: entry.cadence, heartRate: entry.heartRate, resistance: entry.resistance,
        speed: entry.speedKmh == null ? null : entry.speedKmh / 3.6, distance: entry.distanceKm == null ? null : entry.distanceKm * 1000 };
      for (const [key,value] of Object.entries(values)) if (Number.isFinite(value)) fields[key] = value;
      write('RECORD', fields);
    }
  }
  const summary = ride.summary || {};
  const common = { timestamp: end, startTime: start, sport: 'cycling', subSport: 'indoorCycling',
    totalElapsedTime: Math.max(0,(ride.endedAt-ride.startedAt)/1000), totalTimerTime: summary.activeSeconds || 0 };
  for (const [key,value] of Object.entries({ totalDistance: summary.distanceKm == null ? null : summary.distanceKm * 1000,
    totalWork: summary.energyKj == null ? null : Math.round(summary.energyKj * 1000),
    totalCalories: summary.estimatedCaloriesKcal == null ? null : Math.round(summary.estimatedCaloriesKcal),
    avgSpeed: summary.speedAverageKmh == null ? null : summary.speedAverageKmh / 3.6,
    avgCadence: summary.cadenceAverageRpm == null ? null : Math.round(summary.cadenceAverageRpm),
    avgPower: summary.coverageSeconds?.power > 0 ? Math.round(summary.energyKj * 1000 / summary.coverageSeconds.power) : null })) if (Number.isFinite(value)) common[key]=value;
  write('LAP', { ...common, messageIndex: 0, event: 'lap', eventType: 'stop', lapTrigger: 'sessionEnd' });
  write('SESSION', { ...common, messageIndex: 0, event: 'session', eventType: 'stop', firstLapIndex: 0, numLaps: 1 });
  write('ACTIVITY', { timestamp: end, totalTimerTime: common.totalTimerTime, numSessions: 1, type: 'manual', event: 'activity', eventType: 'stop' });
  return Buffer.from(encoder.close());
}
