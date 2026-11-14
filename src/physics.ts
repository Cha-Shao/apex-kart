import * as CANNON from 'cannon-es';
import { bridgeHeight, curbGeometry, isOnAsphalt, nearestOnTrack, type TrackData, type TrackSettings } from './track';
import { TerrainField } from './terrain';
import {VEHICLES,type VehicleId,type VehicleProfile} from './vehicles';
import {AssistedVehicle} from './abs';

export interface DriveInput { throttle:number; brake:number; steer:number; handbrake:boolean; reverse:boolean }
export interface Telemetry { speed:number; signedSpeed:number; rpm:number; steering:number; grip:number; offroad:boolean; lateralG:number; longitudinalG:number; grounded:number;runoff?:boolean;fourWheelsOutside:boolean;gear?:number;brakeApplied:number;absActive:boolean;downforce:number }
export class KartPhysics {
  world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});
  body:CANNON.Body;
  vehicle:AssistedVehicle;
  track!:TrackData;
  barriers:CANNON.Body[]=[];
  terrain=new TerrainField();
  terrainBody:CANNON.Body|null=null;
  roadBody:CANNON.Body|null=null;
  curbBody:CANNON.Body|null=null;
  telemetry:Telemetry={speed:0,signedSpeed:0,rpm:1600,steering:0,grip:1,offroad:false,lateralG:0,longitudinalG:0,grounded:0,fourWheelsOutside:false,brakeApplied:0,absActive:false,downforce:0};
  input:DriveInput={throttle:0,brake:0,steer:0,handbrake:false,reverse:false};
  gripMultiplier=1;
  profile:VehicleProfile=VEHICLES.kart;
  private gear=1;
  staged=false;
  trackLimitsExceeded=false;
  private wheelRight=new CANNON.Vec3(1,0,0);
  private trackLimitAxle=new CANNON.Vec3();
  get visualOffset(){return this.profile.visualOffset;}
  private brake=0;
  private steer=0;
  private lastForward=0;
  private lastLateral=0;
  private accumulator=0;
  private forward=new CANNON.Vec3();
  private lateral=new CANNON.Vec3();
  private localVelocity=new CANNON.Vec3();
  constructor(){
    this.world.broadphase=new CANNON.SAPBroadphase(this.world);
    (this.world.solver as CANNON.GSSolver).iterations=12;
    this.world.defaultContactMaterial.friction=.45;
    this.world.defaultContactMaterial.restitution=.08;
    const groundMaterial=new CANNON.Material('ground');const chassisMaterial=new CANNON.Material('kart');
    this.world.addContactMaterial(new CANNON.ContactMaterial(groundMaterial,chassisMaterial,{friction:.25,restitution:.1,contactEquationStiffness:1e7}));
    const ground=new CANNON.Body({mass:0,shape:new CANNON.Plane(),material:groundMaterial,position:new CANNON.Vec3(0,-70,0)});ground.quaternion.setFromEuler(-Math.PI/2,0,0);ground.updateAABB();this.world.addBody(ground);
    this.body=new CANNON.Body({mass:165,material:chassisMaterial,linearDamping:.025,angularDamping:.4});
    this.body.allowSleep=false;
    this.vehicle=new AssistedVehicle({chassisBody:this.body,indexRightAxis:0,indexUpAxis:1,indexForwardAxis:2});
    this.configureVehicle();
    this.vehicle.addToWorld(this.world);
  }
  private configureVehicle(){
    const spec=this.profile;this.body.mass=spec.mass;while(this.body.shapes.length)this.body.removeShape(this.body.shapes[0]);
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(...spec.chassisHalf)),new CANNON.Vec3(0,spec.chassisOffset,0));this.body.linearDamping=spec.id==='rb20'?.006:.025;
    this.vehicle.wheelInfos.length=0;
    const wheel={radius:spec.wheelRadius,directionLocal:new CANNON.Vec3(0,-1,0),axleLocal:new CANNON.Vec3(-1,0,0),suspensionStiffness:spec.suspensionStiffness,suspensionRestLength:spec.suspensionRestLength,frictionSlip:spec.grip,dampingRelaxation:spec.id==='rb20'?10:5.8,dampingCompression:spec.id==='rb20'?7:4.4,maxSuspensionForce:spec.id==='rb20'?35000:17000,maxSuspensionTravel:spec.suspensionTravel,rollInfluence:.08,customSlidingRotationalSpeed:-25,useCustomSlidingRotationalSpeed:true};
    for(const [x,z] of [[-spec.frontHalfTrack,spec.frontZ],[spec.frontHalfTrack,spec.frontZ],[-spec.rearHalfTrack,spec.rearZ],[spec.rearHalfTrack,spec.rearZ]])this.vehicle.addWheel({...wheel,chassisConnectionPointLocal:new CANNON.Vec3(x,spec.connectionY,z),isFrontWheel:z<0});
    // Cannon defaults to twice the longitudinal friction allowance. Use a
    // physical friction circle shared by braking and cornering instead.
    for(const wheel of this.vehicle.wheelInfos)wheel.forwardAcceleration=.5;
    this.body.updateMassProperties();this.body.updateBoundingRadius();this.body.aabbNeedsUpdate=true;this.telemetry.rpm=spec.idleRPM;
  }
  setVehicle(id:VehicleId){
    if(this.profile.id===id)return;this.setStaged(false);this.profile=VEHICLES[id];this.configureVehicle();if(this.track)this.reset();
  }
  setTrack(track:TrackData,_settings:TrackSettings,terrain:TerrainField=new TerrainField()){
    this.track=track;
    for(const b of this.barriers)this.world.removeBody(b);this.barriers=[];
    if(this.terrainBody)this.world.removeBody(this.terrainBody);if(this.roadBody)this.world.removeBody(this.roadBody);this.roadBody=null;
    if(this.curbBody)this.world.removeBody(this.curbBody);this.curbBody=null;
    this.terrain=terrain.clone();const f=this.terrain,n=f.resolution;
    const data=Array.from({length:n},(_,x)=>Array.from({length:n},(_,j)=>f.heights[(n-1-j)*n+x]));
    const heightfield=new CANNON.Heightfield(data,{elementSize:f.cellSize});
    this.terrainBody=new CANNON.Body({mass:0,shape:heightfield,position:new CANNON.Vec3(f.originX,0,f.originZ+f.size)});this.terrainBody.quaternion.setFromEuler(-Math.PI/2,0,0);this.terrainBody.updateAABB();this.world.addBody(this.terrainBody);
    if(track.bridges.length){
      const vertices:number[]=[],indices:number[]=[],count=track.samples.length;
      for(let i=0;i<count;i++){const s=track.samples[i];for(const side of [-1,1]){const x=s.x+s.nx*track.width*.5*side,z=s.z+s.nz*track.width*.5*side;vertices.push(x,f.sample(x,z)+bridgeHeight(track,i)+.018,z);}}
      for(let i=0;i<count;i++){const a=i*2,b=((i+1)%count)*2;indices.push(a,a+1,b,a+1,b+1,b);}
      const mesh=new CANNON.Trimesh(vertices,indices);this.roadBody=new CANNON.Body({mass:0,shape:mesh});this.roadBody.updateAABB();this.world.addBody(this.roadBody);
    }
    if(_settings.curbs){const data=curbGeometry(track,(x,z)=>f.sample(x,z));if(data.vertices.length){this.curbBody=new CANNON.Body({mass:0});for(let start=0;start<data.vertices.length/3;start+=14000){const end=Math.min(start+14000,data.vertices.length/3),vertices=data.vertices.slice(start*3,end*3),indices=data.indices.filter((_,i,all)=>all[Math.floor(i/3)*3]>=start&&all[Math.floor(i/3)*3]<end).map(i=>i-start);this.curbBody.addShape(new CANNON.Trimesh(vertices,indices));}this.curbBody.updateAABB();this.world.addBody(this.curbBody);}}
    this.reset();
  }
  reset(index=0){
    if(!this.track)return;
    this.setStaged(false);this.clearTrackLimits();this.telemetry.fourWheelsOutside=false;
    const s=this.track.samples[Math.max(0,index)%this.track.samples.length];
    this.body.position.set(s.x,this.terrain.sample(s.x,s.z)+bridgeHeight(this.track,index)+this.profile.rideHeight,s.z);this.body.quaternion.setFromEuler(0,Math.atan2(-s.tx,-s.tz),0);
    this.body.velocity.setZero();this.body.angularVelocity.setZero();this.body.force.setZero();this.body.torque.setZero();
    this.body.previousPosition.copy(this.body.position);this.body.interpolatedPosition.copy(this.body.position);this.body.previousQuaternion.copy(this.body.quaternion);this.body.interpolatedQuaternion.copy(this.body.quaternion);
    this.body.aabbNeedsUpdate=true;this.body.wakeUp();this.steer=0;this.brake=0;this.gear=1;this.lastForward=0;this.lastLateral=0;this.accumulator=0;this.telemetry.speed=0;this.telemetry.signedSpeed=0;this.telemetry.rpm=this.profile.idleRPM;this.telemetry.gear=0;
    this.input={throttle:0,brake:0,steer:0,handbrake:false,reverse:false};
    this.vehicle.resetABS();this.telemetry.brakeApplied=0;this.telemetry.absActive=false;this.telemetry.downforce=0;
    for(let i=0;i<4;i++){this.vehicle.setBrake(0,i);this.vehicle.applyEngineForce(0,i);this.vehicle.setSteeringValue(0,i);this.vehicle.wheelInfos[i].rotation=0;}
  }
  setStaged(staged:boolean){this.staged=staged;this.body.type=staged?CANNON.Body.KINEMATIC:CANNON.Body.DYNAMIC;this.body.updateMassProperties();this.body.velocity.setZero();this.body.angularVelocity.setZero();this.body.force.setZero();this.body.torque.setZero();this.body.aabbNeedsUpdate=true;this.body.wakeUp();}
  clearTrackLimits(){this.trackLimitsExceeded=false;}
  private updateTrackLimits(){
    // The white line is part of the track. A tyre still overlapping it is inside.
    // White stripe: centre width/2-.24 m, stripe half-width .065 m.
    const whiteEdge=this.track.width/2-.175;
    let allOutside=true;
    for(let i=0;i<4;i++){
      const wheel=this.vehicle.wheelInfos[i],contact=wheel.isInContact;
      this.vehicle.updateWheelTransform(i);wheel.isInContact=contact;
      const point=contact&&wheel.raycastResult.hasHit?wheel.raycastResult.hitPointWorld:wheel.worldTransform.position;
      const near=nearestOnTrack(this.track,point);
      wheel.worldTransform.quaternion.vmult(this.wheelRight,this.trackLimitAxle);
      const halfTread=(i<2?this.profile.frontTyreWidth:this.profile.rearTyreWidth)*.5;
      const overlap=halfTread*Math.abs(this.trackLimitAxle.x*near.sample.nx+this.trackLimitAxle.z*near.sample.nz);
      if(near.distance-overlap<=whiteEdge+.005)allOutside=false;
    }
    this.telemetry.fourWheelsOutside=allOutside;
    this.trackLimitsExceeded ||= allOutside;
  }
  step(dt:number){
    this.accumulator+=Math.min(dt,.1);
    while(this.accumulator>=1/120){this.fixedStep(1/120);this.accumulator-=1/120;}
    for(let i=0;i<4;i++){const w=this.vehicle.wheelInfos[i],contact=w.isInContact;this.vehicle.updateWheelTransform(i);w.isInContact=contact;}
  }
  private fixedStep(dt:number){
    const b=this.body;
    if(this.staged){this.input={throttle:0,brake:0,steer:0,handbrake:false,reverse:false};for(let i=0;i<4;i++){this.vehicle.applyEngineForce(0,i);this.vehicle.setBrake(0,i);this.vehicle.setSteeringValue(0,i);}this.vehicle.updateVehicle(dt);this.telemetry.speed=0;this.telemetry.signedSpeed=0;this.telemetry.rpm=this.profile.idleRPM;return;}
    b.quaternion.vmult(new CANNON.Vec3(0,0,-1),this.forward);b.quaternion.vmult(new CANNON.Vec3(1,0,0),this.lateral);
    b.vectorToLocalFrame(b.velocity,this.localVelocity);
    const speed=b.velocity.dot(this.forward),sideSpeed=b.velocity.dot(this.lateral),abs=Math.abs(speed);
    const near=nearestOnTrack(this.track,{x:b.position.x,z:b.position.z});
    const offroad=!isOnAsphalt(this.track,b.position,near.distance,near);
    this.telemetry.runoff=!offroad&&near.distance>this.track.width/2;
    const spec=this.profile,isF1=spec.id==='rb20';
    const target=this.input.steer*((isF1?.40:.51)/(1+abs*(isF1?.024:.055)));
    this.steer+=(target-this.steer)*(1-Math.exp(-dt*7.5));
    // Ackermann front steering: the inner wheel follows a tighter radius.
    const wheelbase=spec.wheelbase,halfTrack=spec.frontHalfTrack;
    const turnRadius=Math.abs(this.steer)>.001?wheelbase/Math.tan(Math.abs(this.steer)):1e6;
    const inner=Math.atan(wheelbase/Math.max(wheelbase*.72,turnRadius-halfTrack)),outer=Math.atan(wheelbase/(turnRadius+halfTrack)),sign=Math.sign(this.steer);
    this.vehicle.setSteeringValue((this.steer>0?inner:outer)*sign,0);this.vehicle.setSteeringValue((this.steer>0?outer:inner)*sign,1);
    const forwardForce=isF1?(speed<spec.topSpeed?Math.min(spec.driveForce,spec.powerWatts/Math.max(20,abs)):0):spec.driveForce*Math.max(0,1-Math.pow(Math.max(0,speed)/spec.topSpeed,3));
    const engine=this.input.brake>0?0:this.input.reverse?(speed>-6?-Math.min(1000,spec.driveForce*.42)*.5:0):forwardForce*.5*this.input.throttle;
    this.brake+=(this.input.brake-this.brake)*(1-Math.exp(-dt*36));
    // setBrake takes an impulse per step. Convert the vehicle's target
    // deceleration to N·s; the F1 braking envelope increases with aero load.
    const downforce=spec.downforce*abs*abs;
    const deceleration=isF1?Math.min(6*9.81,spec.brakeG*9.81+downforce/spec.mass*1.9):spec.brakeG*9.81;
    const brakeImpulse=this.body.mass*deceleration*this.brake*dt,handbrake=!isF1&&this.input.handbrake;
    this.vehicle.serviceImpulse=brakeImpulse;this.vehicle.demand=this.brake;this.vehicle.handbrake=handbrake;
    for(let i=0;i<4;i++){
      const w=this.vehicle.wheelInfos[i];
      w.frictionSlip=(offroad?(isF1?.60:.78):spec.grip)*this.gripMultiplier*(handbrake&&i>=2?.42:1);
      this.vehicle.applyEngineForce(i>=2?engine:0,i);
    }
    // Rolling resistance and quadratic air drag, in physical Newtons.
    const drag=(abs*abs*spec.drag+(abs>.2?spec.rollingResistance:0))*(offroad?4.5:1);
    b.applyForce(this.forward.scale(-Math.sign(speed)*drag));
    if(downforce>0)b.applyForce(new CANNON.Vec3(0,-downforce,0));
    this.world.step(dt);
    this.telemetry.brakeApplied=this.vehicle.appliedBrake;this.telemetry.absActive=this.vehicle.absActive;this.telemetry.downforce=downforce;
    this.updateTrackLimits();
    this.telemetry.speed=Math.hypot(b.velocity.x,b.velocity.z)*3.6;this.telemetry.signedSpeed=speed*3.6;
    if(isF1){const ratios=[3.20,2.55,2.08,1.75,1.50,1.31,1.17,1.06],wheelRPM=abs/(2*Math.PI*spec.wheelRadius)*60;let rpm=wheelRPM*4.2*ratios[this.gear-1];if(rpm>11800&&this.gear<8)this.gear++;else if(rpm<6500&&this.gear>1)this.gear--;rpm=wheelRPM*4.2*ratios[this.gear-1];this.telemetry.rpm=Math.min(spec.maxRPM,Math.max(spec.idleRPM+this.input.throttle*2200,rpm));this.telemetry.gear=speed<-.3?-1:abs<.3?0:this.gear;}
    else{this.telemetry.rpm=1500+Math.min(1,abs/26)*2600+this.input.throttle*350;this.telemetry.gear=speed<-.3?-1:abs<.3?0:1;}
    this.telemetry.steering=this.steer;this.telemetry.offroad=offroad;
    const lat=(sideSpeed-this.lastLateral)/dt/9.81+speed*b.angularVelocity.y/9.81;
    this.telemetry.lateralG+=(Math.max(-2.5,Math.min(2.5,lat))-this.telemetry.lateralG)*.045;
    this.telemetry.longitudinalG+=((speed-this.lastForward)/dt/9.81-this.telemetry.longitudinalG)*.04;
    this.telemetry.grip=Math.min(...this.vehicle.wheelInfos.map(w=>w.isInContact?w.skidInfo:1));
    this.telemetry.grounded=this.vehicle.wheelInfos.filter(w=>w.isInContact).length;
    this.lastForward=speed;this.lastLateral=sideSpeed;
  }
}
