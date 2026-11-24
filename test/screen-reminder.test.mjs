import test from 'node:test';
import assert from 'node:assert/strict';
import { RideScreenReminder, SCREEN_REMINDER_INTERVAL_MS as interval } from '../public/screen-reminder.js';
function setup(){let now=0,shows=0;const button={},root={hidden:true,querySelector:()=>button};const reminder=new RideScreenReminder(root,{now:()=>now,onShow:()=>shows++});return {root,button,reminder,advance:ms=>{now+=ms;},shows:()=>shows};}
const ride={rideId:'test-ride-001',started:true};
test('reminder uses wall time, remains visible, and repeats 15 minutes after acknowledgement',()=>{
 const f=setup();f.reminder.update(ride);f.advance(interval-1);f.reminder.update(ride);assert.equal(f.root.hidden,true);
 f.advance(1);f.reminder.update(ride);assert.equal(f.root.hidden,false);assert.equal(f.shows(),1);
 f.advance(interval);f.reminder.update(ride);assert.equal(f.shows(),1,'no repeated alerts while the same reminder is visible');
 f.button.onclick();assert.equal(f.root.hidden,true);f.advance(interval);f.reminder.update(ride);assert.equal(f.shows(),2);
});
test('paused started rides still get reminders and synthetic interactions cannot dismiss them',()=>{
 const f=setup();f.reminder.update(ride);f.advance(interval);f.reminder.update({...ride,running:false});assert.equal(f.root.hidden,false);
 f.reminder.handleInteraction({isTrusted:false});assert.equal(f.root.hidden,false);
 f.reminder.handleInteraction({isTrusted:true});assert.equal(f.root.hidden,true);
});
test('overdue reminders survive reload and completed or new rides clear the old schedule',()=>{
 const f=setup();f.reminder.update(ride);const saved=f.reminder.snapshot();f.advance(interval+1000);
 f.reminder.restore(saved);f.reminder.update(ride);assert.equal(f.root.hidden,false);
 f.reminder.update({...ride,started:false});assert.equal(f.root.hidden,true);assert.equal(f.reminder.snapshot(),null);
 f.reminder.update({...ride,rideId:'different-ride'});assert.equal(f.root.hidden,true);
 assert.ok(f.reminder.snapshot().nextDueAt>saved.nextDueAt);
});
