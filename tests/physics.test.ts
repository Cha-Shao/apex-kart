import test from 'node:test';
import assert from 'node:assert/strict';
import { KartPhysics } from '../src/physics.ts';
import { buildTrack, DEFAULT_SETTINGS, PRESETS } from '../src/track.ts';
const setup=()=>{const p=new KartPhysics();p.setTrack(buildTrack(PRESETS[0].points,DEFAULT_SETTINGS),DEFAULT_SETTINGS);for(let i=0;i<240;i++)p.step(1/120);return p;};
test('four-wheel suspension settles under gravity without ground penetration',()=>{const p=setup();assert.equal(p.telemetry.grounded,4);assert.ok(p.body.position.y>.3&&p.body.position.y<.7);assert.ok(Math.abs(p.body.velocity.y)<.1);});
test('rear-wheel engine accelerates the dynamic body and service brakes stop it',()=>{
  const p=setup(),start=p.body.position.clone();p.input.throttle=1;for(let i=0;i<480;i++)p.step(1/120);
  const fast=p.telemetry.speed;assert.ok(fast>35&&fast<100,`speed ${fast}`);assert.ok(p.body.position.distanceTo(start)>15);
  p.input.throttle=0;p.input.brake=1;for(let i=0;i<240;i++)p.step(1/120);assert.ok(p.telemetry.speed<fast*.2,`braked speed ${p.telemetry.speed}`);
});
test('steering, handbrake and terrain grip affect the physical wheel model',()=>{
  const p=setup();p.input.throttle=1;for(let i=0;i<120;i++)p.step(1/120);const start=p.body.quaternion.clone();p.input.steer=.65;for(let i=0;i<60;i++)p.step(1/120);assert.ok(Math.abs(p.body.quaternion.y-start.y)>.01);assert.ok(p.vehicle.wheelInfos[0].steering>p.vehicle.wheelInfos[1].steering);
  p.input.handbrake=true;p.step(1/60);assert.ok(p.vehicle.wheelInfos[2].frictionSlip<p.vehicle.wheelInfos[0].frictionSlip*.5);
  p.body.position.set(0,.6,0);p.input.handbrake=false;p.step(1/60);assert.equal(p.telemetry.offroad,true);assert.ok(p.vehicle.wheelInfos[0].frictionSlip<1);
});
test('guardrails create physical collisions and can be disabled',()=>{const p=setup();assert.ok(p.barriers.length>100);p.setTrack(p.track,{...DEFAULT_SETTINGS,barriers:false});assert.equal(p.barriers.length,0);});
test('a dynamic kart cannot drive through a guardrail',()=>{
  const p=setup(),s=p.track.samples[0],limit=p.track.width/2+1.55;
  p.body.position.set(s.x+s.nx*3.4,.5,s.z+s.nz*3.4);p.body.quaternion.setFromEuler(0,Math.atan2(-s.nx,-s.nz),0);p.body.velocity.set(s.nx*12,0,s.nz*12);p.body.aabbNeedsUpdate=true;
  let furthest=0;for(let i=0;i<180;i++){p.step(1/120);furthest=Math.max(furthest,(p.body.position.x-s.x)*s.nx+(p.body.position.z-s.z)*s.nz);}
  assert.ok(furthest<limit+.3,`crossed guardrail at ${furthest} m`);
});
