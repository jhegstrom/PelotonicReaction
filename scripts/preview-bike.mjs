// Local visual-test fixture: never starts the native bridge or connects to hardware.
import { createAppServer } from '../server.mjs';
import { BikeService } from '../lib/bike-service.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const bike = new BikeService(root, { platform: 'preview' });
const make = (value, unit) => ({ value, unit, at: Date.now() });
setInterval(() => {
  if (!bike.owner) return;
  bike.publish({ status: 'SIMULATED BIKE · layout preview', connected: true, noBike: false, averagingSeconds: bike.seconds,
    powerAverage: 54, metrics: { Power: make(71, 'W'), Cadence: make(70, 'rpm'), Resistance: make(36, '0–100'), 'Heart rate': make(138, 'bpm'), Speed: make(25, 'km/h') } });
}, 250).unref();
createAppServer(root, { bike }).listen(8094, '127.0.0.1', () => console.log('Simulated bike preview: http://localhost:8094'));
