import test from 'node:test';
import assert from 'node:assert/strict';
import {nameQueryBounds,namesGeoJSON,geographicNames} from '../public/geographic-names.js';
test('GNIS labels retain real positions, deduplicate counties and filter out-of-view points',()=>{
 const f={attributes:{gaz_id:1,gaz_name:'Creek',gaz_featureclass:'Stream'},geometry:{points:[[-119.3,39.9],[-120,40]]}};
 const data=namesGeoJSON([{features:[f,f]}],[-119.4,39.8,-119.2,40]);
 assert.equal(data.features.length,1);assert.deepEqual(data.features[0].geometry.coordinates,[-119.3,39.9]);
 assert.equal(data.features[0].properties.name,'Creek');
 assert.equal(nameQueryBounds(-180,-80,180,80),null);
 assert.deepEqual(nameQueryBounds(-119.34,39.83,-119.31,39.87),[-119.35,39.8,-119.3,39.9]);
});
test('online name query requests only geography and handles service errors',async()=>{
 let calls=0;await geographicNames([-120,39,-119,40],{fetcher:async url=>{calls++;assert.equal(url.searchParams.get('geometry'),'-120,39,-119,40');return {ok:true,json:async()=>({features:[]})};}});assert.equal(calls,3);
 await assert.rejects(()=>geographicNames([-120,39,-119,40],{fetcher:async()=>({ok:true,json:async()=>({error:{code:500}})})}),/unavailable/);
});
