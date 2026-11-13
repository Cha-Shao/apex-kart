import * as CANNON from 'cannon-es';
import { nearestOnTrack, type TrackData, type TrackSettings } from './track';

export interface DriveInput { throttle:number; brake:number; steer:number; handbrake:boolean; reverse:boolean }
export interface Telemetry { speed:number; signedSpeed:number; rpm:number; steering:number; grip:number; offroad:boolean; lateralG:number; longitudinalG:number; grounded:number }
export class KartPhysics {
  world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});
  body:CANNON.Body;
  vehicle:CANNON.RaycastVehicle;
  track!:TrackData;
  barriers:CANNON.Body[]=[];
  telemetry:Telemetry={speed:0,signedSpeed:0,rpm:1600,steering:0,grip:1,offroad:false,lateralG:0,longitudinalG:0,grounded:0};
  input:DriveInput={throttle:0,brake:0,steer:0,handbrake:false,reverse:false};
  gripMultiplier=1;
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
    const ground=new CANNON.Body({mass:0,shape:new CANNON.Plane(),material:groundMaterial});ground.quaternion.setFromEuler(-Math.PI/2,0,0);ground.updateAABB();this.world.addBody(ground);
    this.body=new CANNON.Body({mass:165,material:chassisMaterial,linearDamping:.025,angularDamping:.4});
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(.70,.16,1.08)),new CANNON.Vec3(0,.02,0));
    this.body.allowSleep=false;
    this.vehicle=new CANNON.RaycastVehicle({chassisBody:this.body,indexRightAxis:0,indexUpAxis:1,indexForwardAxis:2});
    const wheel={radius:.29,directionLocal:new CANNON.Vec3(0,-1,0),axleLocal:new CANNON.Vec3(-1,0,0),suspensionStiffness:55,suspensionRestLength:.24,frictionSlip:2.1,dampingRelaxation:5.8,dampingCompression:4.4,maxSuspensionForce:17000,maxSuspensionTravel:.15,rollInfluence:.08,customSlidingRotationalSpeed:-25,useCustomSlidingRotationalSpeed:true};
    for(const [x,z] of [[-.81,-.83],[.81,-.83],[-.84,.79],[.84,.79]])this.vehicle.addWheel({...wheel,chassisConnectionPointLocal:new CANNON.Vec3(x,0,z),isFrontWheel:z<0});
    this.vehicle.addToWorld(this.world);
  }
  setTrack(track:TrackData,settings:TrackSettings){
    this.track=track;
    for(const b of this.barriers)this.world.removeBody(b);this.barriers=[];
    if(settings.barriers){
      const samples=track.samples; const stride=3;
      for(const side of [-1,1])for(let i=0;i<samples.length;i+=stride){
        const a=samples[i],b=samples[(i+stride)%samples.length],offset=track.width/2+1.55;
        const ax=a.x+a.nx*offset*side,az=a.z+a.nz*offset*side,bx=b.x+b.nx*offset*side,bz=b.z+b.nz*offset*side;
        const len=Math.hypot(bx-ax,bz-az);
        const body=new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(.26,.38,len/2+.08)),position:new CANNON.Vec3((ax+bx)/2,.38,(az+bz)/2)});
        body.quaternion.setFromEuler(0,Math.atan2(bx-ax,bz-az),0);body.updateAABB();this.world.addBody(body);this.barriers.push(body);
      }
    }
    this.reset();
  }
  reset(index=0){
    if(!this.track)return;
    const s=this.track.samples[Math.max(0,index)%this.track.samples.length];
    this.body.position.set(s.x,.72,s.z);this.body.quaternion.setFromEuler(0,Math.atan2(-s.tx,-s.tz),0);
    this.body.velocity.setZero();this.body.angularVelocity.setZero();this.body.force.setZero();this.body.torque.setZero();
    this.body.previousPosition.copy(this.body.position);this.body.interpolatedPosition.copy(this.body.position);this.body.previousQuaternion.copy(this.body.quaternion);this.body.interpolatedQuaternion.copy(this.body.quaternion);
    this.body.aabbNeedsUpdate=true;this.body.wakeUp();this.steer=0;this.lastForward=0;this.lastLateral=0;this.accumulator=0;
    this.input={throttle:0,brake:0,steer:0,handbrake:false,reverse:false};
    for(let i=0;i<4;i++){this.vehicle.setBrake(0,i);this.vehicle.applyEngineForce(0,i);this.vehicle.setSteeringValue(0,i);this.vehicle.wheelInfos[i].rotation=0;}
  }
  step(dt:number){
    this.accumulator+=Math.min(dt,.1);
    while(this.accumulator>=1/120){this.fixedStep(1/120);this.accumulator-=1/120;}
    for(let i=0;i<4;i++){const w=this.vehicle.wheelInfos[i],contact=w.isInContact;this.vehicle.updateWheelTransform(i);w.isInContact=contact;}
  }
  private fixedStep(dt:number){
    const b=this.body;
    b.quaternion.vmult(new CANNON.Vec3(0,0,-1),this.forward);b.quaternion.vmult(new CANNON.Vec3(1,0,0),this.lateral);
    b.vectorToLocalFrame(b.velocity,this.localVelocity);
    const speed=b.velocity.dot(this.forward),sideSpeed=b.velocity.dot(this.lateral),abs=Math.abs(speed);
    const near=nearestOnTrack(this.track,{x:b.position.x,z:b.position.z});
    const offroad=near.distance>this.track.width/2+.6;
    const target=this.input.steer*(.51/(1+abs*.055));
    this.steer+=(target-this.steer)*(1-Math.exp(-dt*7.5));
    // Ackermann front steering: the inner wheel follows a tighter radius.
    const turnRadius=Math.abs(this.steer)>.001?1.62/Math.tan(Math.abs(this.steer)):1e6;
    const inner=Math.atan(1.62/Math.max(1.2,turnRadius-.81)),outer=Math.atan(1.62/(turnRadius+.81)),sign=Math.sign(this.steer);
    this.vehicle.setSteeringValue((this.steer>0?inner:outer)*sign,0);this.vehicle.setSteeringValue((this.steer>0?outer:inner)*sign,1);
    const engine=this.input.reverse?(speed>-6?-230:0):(560*this.input.throttle*Math.max(0,1-Math.pow(Math.max(0,speed)/27,3)));
    for(let i=0;i<4;i++){
      const w=this.vehicle.wheelInfos[i];
      w.frictionSlip=(offroad?.78:2.15)*this.gripMultiplier*(this.input.handbrake&&i>=2?.42:1);
      this.vehicle.applyEngineForce(i>=2?engine:0,i);
      this.vehicle.setBrake(this.input.handbrake&&i>=2?32:this.input.brake*(i<2?16:13)+(this.input.throttle===0&&!this.input.reverse?.14:0),i);
    }
    // Rolling resistance and quadratic air drag, in physical Newtons.
    const drag=(abs*abs*.46+(abs>.2?19:0))*(offroad?4.5:1);
    b.applyForce(this.forward.scale(-Math.sign(speed)*drag));
    this.world.step(dt);
    this.telemetry.speed=Math.hypot(b.velocity.x,b.velocity.z)*3.6;this.telemetry.signedSpeed=speed*3.6;
    this.telemetry.rpm=1600+Math.min(1,abs/26)*9000+this.input.throttle*500;
    this.telemetry.steering=this.steer;this.telemetry.offroad=offroad;
    const lat=(sideSpeed-this.lastLateral)/dt/9.81+speed*b.angularVelocity.y/9.81;
    this.telemetry.lateralG+=(Math.max(-2.5,Math.min(2.5,lat))-this.telemetry.lateralG)*.045;
    this.telemetry.longitudinalG+=((speed-this.lastForward)/dt/9.81-this.telemetry.longitudinalG)*.04;
    this.telemetry.grip=Math.min(...this.vehicle.wheelInfos.map(w=>w.isInContact?w.skidInfo:1));
    this.telemetry.grounded=this.vehicle.wheelInfos.filter(w=>w.isInContact).length;
    this.lastForward=speed;this.lastLateral=sideSpeed;
  }
}
