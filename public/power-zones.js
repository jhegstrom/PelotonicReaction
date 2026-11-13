// Seven FTP-based zones, with contiguous integer watt boundaries and open Zone 7.
// Edges follow Peloton's 55/75/90/105/120/150 percent scheme.
export function powerZoneRange(zone, ftpWatts) {
  if (!Number.isInteger(zone) || zone < 1 || zone > 7 || !Number.isInteger(ftpWatts) || ftpWatts < 20 || ftpWatts > 1500) return null;
  const edges = [0, .55, .75, .9, 1.05, 1.2, 1.5];
  return { low: zone === 1 ? 0 : Math.floor(ftpWatts * edges[zone - 1]) + 1,
    high: zone === 7 ? Infinity : Math.floor(ftpWatts * edges[zone]), explicitRange: true, zone };
}
