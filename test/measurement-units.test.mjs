import test from 'node:test';
import assert from 'node:assert/strict';
import {formatRouteDistance,formatElevation,formatNearbyDistance,formatRouteLabel} from '../public/measurement-units.js';
test('route distance and elevation share metric or customary preference',()=>{
 assert.equal(formatRouteDistance(1609.344,'mph'),'1.00 mi');
 assert.equal(formatRouteDistance(1000,'km/h'),'1.00 km');
 assert.equal(formatElevation(304.8,'mph'),'1,000 ft');
 assert.equal(formatElevation(304.8,'km/h'),'305 m');
 assert.equal(formatElevation(-30.48,'mph'),'-100 ft');
 assert.equal(formatNearbyDistance(30.48,'mph'),'100 ft');
 assert.equal(formatNearbyDistance(100,'km/h'),'100 m');
 assert.equal(formatRouteLabel('Climb · 0.0–4.0 km','mph'),'Climb · 0.0–2.5 mi');
 assert.equal(formatRouteLabel('Climb to the lookout','mph'),'Climb to the lookout');
});
