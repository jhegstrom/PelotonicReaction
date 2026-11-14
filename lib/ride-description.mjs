const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
const duration = seconds => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;
const number = value => value == null ? '—' : String(Math.round(value * 10) / 10);

// Difference cumulative integrals at actual block transitions. Packet counts and
// display smoothing never enter these averages. Revisiting a block is a new row.
export function summarizeBlocks(entries, finalSummary) {
  const boundaries = entries.filter(e => e.type === 'block');
  const result = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i], low = start.summary || {}, high = boundaries[i + 1]?.summary || finalSummary || {};
    const activeSeconds = Math.max(0, (high.activeSeconds || 0) - (low.activeSeconds || 0));
    if (activeSeconds <= 0) continue;
    const coverageSeconds = {}, average = (key, total) => {
      const covered = Math.max(0, (high.coverageSeconds?.[key] || 0) - (low.coverageSeconds?.[key] || 0));
      coverageSeconds[key] = covered;
      return covered > 0 ? Math.max(0, total(high) - total(low)) / covered : null;
    };
    const powerWatts = average('power', s => (s.energyKj || 0) * 1000);
    const cadenceRpm = average('cadence', s => (s.cadenceAverageRpm || 0) * (s.coverageSeconds?.cadence || 0));
    const resistance = average('resistance', s => (s.resistanceAverage || 0) * (s.coverageSeconds?.resistance || 0));
    result.push({ index: start.block.index, label: clean(start.block.label), activeSeconds, powerWatts, cadenceRpm, resistance, coverageSeconds });
  }
  return result;
}
export function rideDescription(ride) {
  const lines = ['Recorded by PelotonicReaction from Grupetto.'];
  if (ride.programDescription) lines.push('', clean(ride.programDescription));
  if (ride.blockSummaries?.length) {
    lines.push('', 'Actual block averages (active time; missing readings excluded):');
    for (const [i, block] of ride.blockSummaries.entries()) {
      const partial = Object.values(block.coverageSeconds).some(n => n + .1 < block.activeSeconds);
      const line = `${block.index + 1}. ${block.label} (${duration(block.activeSeconds)}): ${number(block.powerWatts)} W · ${number(block.cadenceRpm)} rpm · resistance ${number(block.resistance)}${partial ? ' [partial data]' : ''}`;
      if (lines.join('\n').length + line.length > 7800) { lines.push(`… ${ride.blockSummaries.length - i} further blocks omitted.`); break; }
      lines.push(line);
    }
  } else lines.push('', 'Block averages are unavailable for this recording.');
  return lines.join('\n');
}
