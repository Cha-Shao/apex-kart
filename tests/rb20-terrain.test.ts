import test from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import {KartPhysics} from '../src/physics.ts';
import {buildTrack,DEFAULT_SETTINGS} from '../src/track.ts';
import {TerrainField} from '../src/terrain.ts';
import {CIRCUIT_LIBRARY} from '../src/circuit-library.ts';

const track=buildTrack([{x:0,z:100},{x:0,z:40},{x:0,z:-120},{x:80,z:-120},{x:80,z:100}],DEFAULT_SETTINGS);
function terrain(height:(x:number,z:number)=>number){
  const field=new TerrainField();
  for(let z=0;z<field.resolution;z++)for(let x=0;x<field.resolution;x++)field.heights[z*field.resolution+x]=height(field.originX+x*field.cellSize,field.originZ+z*field.cellSize);
  return field;
}
function setup(field:TerrainField){
  const p=new KartPhysics();p.setVehicle('rb20');p.setTrack(track,DEFAULT_SETTINGS,field);return p;
}

for(const grade of [.1,.2,.3])for(const speed of [10,40,80])test(`RB20 enters a ${grade*100}% uphill at ${speed*3.6} km/h without snagging`,()=>{
  const p=setup(terrain((_x,z)=>Math.min(50,Math.max(0,-z))*grade));
  p.body.position.set(0,p.profile.rideHeight,18);p.body.quaternion.setFromEuler(0,0,0);p.body.aabbNeedsUpdate=true;
  for(let i=0;i<240;i++)p.step(1/120);
  p.body.velocity.set(0,0,-speed);p.input.throttle=1;
  let previous=speed*3.6,maxLoss=0,chassisContacts=0;
  for(let i=0;i<720&&p.body.position.z>-45;i++){
    p.step(1/120);
    maxLoss=Math.max(maxLoss,previous-p.telemetry.speed);previous=p.telemetry.speed;
    chassisContacts+=p.world.contacts.filter(c=>c.bi===p.body||c.bj===p.body).length;
  }
  assert.ok(p.body.position.z<-45,`stuck at z=${p.body.position.z}, speed=${p.telemetry.speed}`);
  if(speed<=40&&grade<=.2)assert.equal(chassisContacts,0,'the suspension should reach the ramp before the chassis');
  // A sharp ramp at racing speed can touch the hitbox, but must not anchor it.
  assert.ok(p.telemetry.speed>speed*3.6*.45,`exit speed ${p.telemetry.speed}`);
  assert.ok(maxLoss<Math.max(5,speed*3.6*.2),`lost ${maxLoss} km/h in one physics step`);
});

for(const feature of ['crest','dip'])for(const direction of [-1,1])test(`RB20 crosses a curved ${feature} in direction ${direction} without grounding its body`,()=>{
  const p=setup(terrain((x,z)=>(feature==='crest'?3:-3)*Math.exp(-(((z+20)/6)**2))+x*.08));
  const start=direction<0?18:-58,end=direction<0?-58:18;
  p.body.position.set(0,p.profile.rideHeight+p.terrain.sample(0,start),start);
  p.body.quaternion.setFromEuler(0,direction<0?0:Math.PI,0);p.body.aabbNeedsUpdate=true;
  p.input.brake=1;for(let i=0;i<240;i++)p.step(1/120);
  p.body.velocity.set(0,0,direction*6);p.input.brake=0;
  let contacts=0;
  for(let i=0;i<1800&&direction*(end-p.body.position.z)>0;i++){
    const speed=p.body.velocity.length();
    p.input.throttle=Math.max(0,Math.min(1,(6-speed)*.5));
    p.input.brake=Math.max(0,Math.min(1,(speed-6)*.5));
    p.step(1/120);
    contacts+=p.world.contacts.filter(c=>(c.bi===p.body&&c.bj===p.terrainBody)||(c.bj===p.body&&c.bi===p.terrainBody)).length;
  }
  assert.ok(direction*(p.body.position.z-end)>=0,`stuck on the ${feature} at ${p.body.position}, velocity=${p.body.velocity}, contacts=${contacts}, grounded=${p.telemetry.grounded}`);
  assert.equal(contacts,0,'the tyres should follow the curved ground without the body hitbox scraping it');
});

test('RB20 reset follows the slope and keeps the chassis above terrain',()=>{
  const gradeX=.12,gradeZ=-.2,p=setup(terrain((x,z)=>gradeX*x+gradeZ*z));
  p.reset();
  const up=p.body.quaternion.vmult(CANNON.Vec3.UNIT_Y),normal=new CANNON.Vec3(-gradeX,1,-gradeZ).unit();
  assert.ok(up.dot(normal)>.9999,'reset should align the chassis with the supporting plane');
  const shape=p.body.shapes[0],offset=p.body.shapeOffsets[0];
  if(shape instanceof CANNON.Sphere){
    const center=p.body.pointToWorldFrame(offset);
    const clearance=(center.y-p.terrain.sample(center.x,center.z))*normal.y-shape.radius;
    assert.ok(clearance>.04,'reset placed the hitbox in the ground');
  }else{
    const vertices=(shape as CANNON.Box).convexPolyhedronRepresentation.vertices;
    for(const vertex of vertices){
      const world=p.body.pointToWorldFrame(vertex.vadd(offset));
      assert.ok(world.y-p.terrain.sample(world.x,world.z)>.04,'reset placed a chassis corner in the ground');
    }
  }
  p.input.brake=1;for(let i=0;i<240;i++)p.step(1/120);
  assert.equal(p.telemetry.grounded,4);
  assert.ok(p.body.velocity.length()<.2,`velocity=${p.body.velocity}`);
});

test('RB20 still collides with solid obstacles',()=>{
  const p=setup(new TerrainField());
  p.body.position.set(0,p.profile.rideHeight,5);p.body.quaternion.setFromEuler(0,0,0);p.body.aabbNeedsUpdate=true;
  p.world.addBody(new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(5,2,.5)),position:new CANNON.Vec3(0,2,-5)}));
  for(let i=0;i<240;i++)p.step(1/120);
  p.body.velocity.set(0,0,-15);let contacts=0;
  for(let i=0;i<180;i++){p.step(1/120);contacts+=p.world.contacts.filter(c=>c.bi===p.body||c.bj===p.body).length;}
  assert.ok(contacts>0,'the chassis collider must remain active');
  assert.ok(p.body.position.z>-5,'the chassis passed through the wall');
});

test('RB20 reset stays on the upper branch of a bridge crossing',()=>{
  const circuit=CIRCUIT_LIBRARY.find(c=>c.id==='suzuka')!;
  const bridgeTrack=buildTrack(circuit.nativePoints,DEFAULT_SETTINGS,{preserveLayout:true,allowCrossings:true});
  const p=new KartPhysics();p.setVehicle('rb20');p.setTrack(bridgeTrack,DEFAULT_SETTINGS);
  assert.ok(bridgeTrack.bridges.length>0);
  const bridge=bridgeTrack.bridges[0];p.reset(bridge.index);
  assert.ok(p.body.position.y>=bridge.height+p.profile.rideHeight-.01);
  p.input.brake=1;for(let i=0;i<240;i++)p.step(1/120);
  assert.equal(p.telemetry.grounded,4);
  assert.ok(p.body.position.y>bridge.height,'reset dropped the car onto the lower road');
});
