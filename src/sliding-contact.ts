import * as CANNON from 'cannon-es';
import {smoothGuardrailContact} from './guardrail-collision';
import type {TerrainField} from './terrain';

/** Keep chassis impact impulses separate from penetration recovery. Tyre grip
 * still belongs to RaycastVehicle; the body shell can slide on static surfaces. */
export class SlidingContactSolver extends CANNON.GSSolver {
  terrainBody:CANNON.Body|null=null;
  terrain:TerrainField|null=null;
  private point=new CANNON.Vec3();
  private normal=new CANNON.Vec3();
  private separation=new CANNON.Vec3();
  private correction=new CANNON.Vec3();
  constructor(private chassis:CANNON.Body){super();this.iterations=12;}

  private isChassisContact(equation:CANNON.Equation){
    return (equation.bi===this.chassis&&equation.bj.type===CANNON.Body.STATIC)
      ||(equation.bj===this.chassis&&equation.bi.type===CANNON.Body.STATIC);
  }
  private gap(contact:CANNON.ContactEquation){
    contact.bj.position.vadd(contact.rj,this.separation);
    this.separation.vsub(contact.bi.position,this.separation);
    this.separation.vsub(contact.ri,this.separation);
    return contact.ni.dot(this.separation);
  }
  addEquation(equation:CANNON.Equation){
    if(!this.isChassisContact(equation)){super.addEquation(equation);return;}
    // Multiple mesh/rail contacts must not add up to a handbrake on the shell.
    if(equation instanceof CANNON.FrictionEquation)return;
    if(equation instanceof CANNON.ContactEquation){
      const contact=equation,first=contact.bi===this.chassis,other=first?contact.bj:contact.bi;
      if(other===this.terrainBody&&this.terrain){
        // Heightfield triangle pillars have internal side faces. Resolve against
        // the actual terrain surface instead of letting an edge pin the floor.
        this.chassis.position.vadd(first?contact.ri:contact.rj,this.point);
        const {x,z}=this.point,f=this.terrain,epsilon=.025;
        this.normal.set((f.sample(x-epsilon,z)-f.sample(x+epsilon,z))/(2*epsilon),1,(f.sample(x,z-epsilon)-f.sample(x,z+epsilon))/(2*epsilon));
        this.normal.normalize();this.normal.scale(first?-1:1,contact.ni);
        this.point.y=f.sample(x,z);this.point.vsub(other.position,first?contact.rj:contact.ri);
      }else smoothGuardrailContact(contact,this.chassis);
      if(this.gap(contact)>.002)return;
      // A velocity-only, inelastic solve removes inward motion, retaining the
      // tangential component. Correct overlap below without injecting a bounce.
      contact.restitution=0;contact.a=0;contact.b=1;
    }
    super.addEquation(equation);
  }
  solve(dt:number,world:CANNON.World){
    const iterations=super.solve(dt,world);
    if(this.chassis.invMass===0)return iterations;
    this.correction.setZero();
    for(let pass=0;pass<3;pass++)for(const equation of this.equations){
      if(!(equation instanceof CANNON.ContactEquation)||!this.isChassisContact(equation))continue;
      const sign=equation.bi===this.chassis?-1:1;
      equation.ni.scale(sign,this.normal);
      const depth=-this.gap(equation)-.002-this.normal.dot(this.correction);
      if(depth>0)this.correction.addScaledVector(depth,this.normal,this.correction);
    }
    // Bound recovery from a deep overlap, while keeping it out of the body's
    // linear/angular velocity so bottoming out cannot store a launch impulse.
    const distance=this.correction.length();
    if(distance>0){
      if(distance>.25)this.correction.scale(.25/distance,this.correction);
      this.chassis.position.vadd(this.correction,this.chassis.position);
      this.chassis.aabbNeedsUpdate=true;
    }
    return iterations;
  }
}
