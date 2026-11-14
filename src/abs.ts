import * as CANNON from 'cannon-es';

/** Load-based ABS for Cannon's impulse tyres (which have no independent wheel inertia).
 * Run after this step's suspension solve, before friction: never estimate tyre slip
 * from deltaRotation, since RaycastVehicle forcibly zeros it whenever braking.
 */
export class AssistedVehicle extends CANNON.RaycastVehicle {
  serviceImpulse=0;
  demand=0;
  handbrake=false;
  appliedBrake=0;
  absActive=false;
  private pressure=new Float64Array([1,1,1,1]);
  private rotations=new Float64Array(4);
  private axle=new CANNON.Vec3();
  private direction=new CANNON.Vec3();
  private velocity=new CANNON.Vec3();
  private groundVelocity=new CANNON.Vec3();
  private relative=new CANNON.Vec3();
  private normalPart=new CANNON.Vec3();
  resetABS(){this.pressure.fill(1);this.serviceImpulse=0;this.demand=0;this.appliedBrake=0;this.absActive=false;}
  updateFriction(dt:number){
    const wheels=this.wheelInfos,body=this.chassisBody;
    if(body.invMass===0){this.resetABS();for(const wheel of wheels){wheel.brake=0;wheel.forwardImpulse=0;wheel.sideImpulse=0;wheel.skidInfo=1;}return;}
    // Match friction capacity to the normal impulse actually applied by Cannon.
    let load=0;
    for(const wheel of wheels){wheel.suspensionForce=Math.min(wheel.maxSuspensionForce,wheel.suspensionForce);if(wheel.isInContact)load+=wheel.suspensionForce;}
    let applied=0;this.absActive=false;
    for(let i=0;i<wheels.length;i++){
      const wheel=wheels[i],ground=wheel.raycastResult.body;
      const request=load>0&&wheel.isInContact?this.serviceImpulse*wheel.suspensionForce/load:0;
      let limited=request;
      if(request>0&&ground){
        // Same lateral demand as RaycastVehicle.resolveSingleBilateral, so ABS
        // reserves steering grip before allocating the remaining friction circle.
        wheel.worldTransform.quaternion.vmult(CANNON.Vec3.UNIT_X,this.axle);
        const normal=wheel.raycastResult.hitNormalWorld;
        normal.scale(this.axle.dot(normal),this.normalPart);this.axle.vsub(this.normalPart,this.axle);this.axle.normalize();
        body.getVelocityAtWorldPoint(wheel.raycastResult.hitPointWorld,this.velocity);
        ground.getVelocityAtWorldPoint(wheel.raycastResult.hitPointWorld,this.groundVelocity);
        this.velocity.vsub(this.groundVelocity,this.relative);
        const side=.2*Math.abs(this.relative.dot(this.axle))/(body.invMass+ground.invMass);
        const capacity=wheel.suspensionForce*dt*wheel.frictionSlip*.97;
        const remaining=Math.sqrt(Math.max(0,capacity*capacity-side*side))/(.5/wheel.forwardAcceleration);
        const target=Math.min(1,remaining/request);
        // Release immediately; rebuild pressure progressively as grip returns.
        this.pressure[i]=target<this.pressure[i]?target:Math.min(target,this.pressure[i]+dt*12);
        limited=request*this.pressure[i];
      }else this.pressure[i]=1;
      applied+=limited;
      if(limited<request*.985&&this.demand>.02)this.absActive=true;
      wheel.brake=this.handbrake&&i>=2?6:limited;
    }
    this.appliedBrake=this.serviceImpulse>0?this.demand*Math.min(1,applied/this.serviceImpulse):0;
    if(this.serviceImpulse>0&&load===0&&this.demand>.02)this.absActive=true;
    super.updateFriction(dt);
  }
  updateVehicle(dt:number){
    this.wheelInfos.forEach((wheel,i)=>this.rotations[i]=wheel.rotation);
    super.updateVehicle(dt);
    // Preserve rolling visuals during ABS; base Cannon otherwise locks every
    // coasting/braking wheel regardless of its actual friction demand.
    this.wheelInfos.forEach((wheel,i)=>{
      if(!wheel.isInContact||(this.handbrake&&i>=2)||wheel.brake<=0)return;
      // Derive the rolling tangent from the axle, which is invariant under
      // wheel spin. A rotated UNIT_Z would reverse direction every half-turn.
      wheel.worldTransform.quaternion.vmult(CANNON.Vec3.UNIT_X,this.axle);
      const normal=wheel.raycastResult.hitNormalWorld;
      normal.cross(this.axle,this.direction);this.direction.normalize();
      this.chassisBody.getVelocityAtWorldPoint(wheel.raycastResult.hitPointWorld,this.velocity);
      const delta=this.velocity.dot(this.direction)*dt/wheel.radius;
      wheel.rotation=this.rotations[i]+delta;wheel.deltaRotation=delta*.99;
    });
  }
}
