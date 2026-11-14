import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleColumns,scheduleTarget} from '../public/schedule-targets.js';
test('schedule includes only metric families targeted anywhere in the program',()=>{
 const steps=[{cadence:120,primaryTargets:['cadence']},{heartRateZone:3,primaryTargets:['heartRate']},{}];
 const columns=scheduleColumns(steps);assert.deepEqual(columns.map(c=>c.key),['cadence','hr']);
 assert.deepEqual(scheduleTarget(steps[0],columns[0]),{text:'120',primary:true});
 assert.deepEqual(scheduleTarget(steps[1],columns[1]),{text:'Z3',primary:true});
 assert.deepEqual(scheduleTarget(steps[0],columns[1]),{text:'—',primary:false});
 assert.deepEqual(scheduleColumns([{}]),[]);
});
test('ranges, zero values and combined watts/zone cues display without hiding reference targets',()=>{
 const step={cadence:0,resistance:43,watts:130,powerZone:3,targetRanges:{heartRate:[130,140]},primaryTargets:['watts']};
 const columns=scheduleColumns([step]);assert.deepEqual(columns.map(c=>scheduleTarget(step,c)),[{text:'0',primary:false},{text:'43',primary:false},{text:'130 W · Z3',primary:true},{text:'130–140 BPM',primary:false}]);
});
