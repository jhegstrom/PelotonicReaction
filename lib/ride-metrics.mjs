// Integrate unsmoothed telemetry over active workout time, never packet counts.
// A source reading is held for at most 5 seconds; unknown intervals add no zeros.
export class RideMetrics {
  constructor(now = 0) {
    this.last = now; this.running = false; this.latest = null;
    this.activeSeconds = 0; this.integral = { Speed: 0, Cadence: 0, Power: 0 };
    this.coverage = { Speed: 0, Cadence: 0, Power: 0 };
  }
  advance(now) {
    const elapsed = Math.max(0, now - this.last) / 1000;
    if (this.running) {
      this.activeSeconds += elapsed;
      if (this.latest?.connected) for (const key of ['Speed', 'Cadence', 'Power']) {
        const sample = this.latest.metrics?.[key];
        if (!Number.isFinite(sample?.value) || sample.value < 0 || !Number.isFinite(sample.ageMs)) continue;
        const remainingMs = Math.max(0, 5000 - sample.ageMs);
        const covered = Math.max(0, Math.min(now, this.latest.receivedAt + remainingMs) - Math.max(this.last, this.latest.receivedAt)) / 1000;
        this.integral[key] += sample.value * covered;
        this.coverage[key] += covered;
      }
    }
    this.last = Math.max(now, this.last);
  }
  ingest(snapshot, now) {
    this.advance(now);
    this.latest = { ...snapshot, receivedAt: now };
  }
  setRunning(running, now) { this.advance(now); this.running = running; }
  summary(now) {
    this.advance(now);
    const energyKj = this.coverage.Power > 0 ? this.integral.Power / 1000 : null;
    return {
      activeSeconds: this.activeSeconds,
      speedAverageKmh: this.coverage.Speed > 0 ? this.integral.Speed / this.coverage.Speed : null,
      cadenceAverageRpm: this.coverage.Cadence > 0 ? this.integral.Cadence / this.coverage.Cadence : null,
      distanceKm: this.coverage.Speed > 0 ? this.integral.Speed / 3600 : null,
      energyKj,
      // Mechanical work -> metabolic energy, assuming 24% gross efficiency.
      estimatedCaloriesKcal: energyKj == null ? null : energyKj / (4.184 * .24),
      coverageSeconds: { speed: this.coverage.Speed, cadence: this.coverage.Cadence, power: this.coverage.Power },
    };
  }
}
export function sourceSnapshot(value, wallNow = Date.now()) {
  return { ...value, metrics: Object.fromEntries(Object.entries(value.metrics || {}).map(([name, sample]) => [name, {
    ...sample, ageMs: Number.isFinite(sample.at) ? Math.max(0, wallNow - sample.at) : null,
  }])) };
}
