import * as THREE from 'three';
import type {KartPhysics} from './physics';

/** A cheap, local occlusion layer beneath the chassis, separate from sunlight. */
export class ContactShadow {
  readonly mesh:THREE.Mesh;
  private normal=new THREE.Vector3();
  private tilt=new THREE.Quaternion();
  private yaw=new THREE.Quaternion();
  private up=new THREE.Vector3(0,1,0);
  constructor(){
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=512;const ctx=canvas.getContext('2d')!;
    ctx.scale(1,2);const gradient=ctx.createRadialGradient(128,128,15,128,128,126);gradient.addColorStop(0,'rgba(0,0,0,.82)');gradient.addColorStop(.48,'rgba(0,0,0,.55)');gradient.addColorStop(.8,'rgba(0,0,0,.17)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);
    const map=new THREE.CanvasTexture(canvas),geometry=new THREE.PlaneGeometry(1,1);geometry.rotateX(-Math.PI/2);
    this.mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map,transparent:true,opacity:.36,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,toneMapped:false}));this.mesh.name='chassis-contact-occlusion';this.mesh.renderOrder=2;this.mesh.visible=false;
  }
  update(physics:KartPhysics){
    let height=0,count=0;this.normal.set(0,0,0);
    for(const wheel of physics.vehicle.wheelInfos)if(wheel.isInContact){height+=wheel.raycastResult.hitPointWorld.y;this.normal.add(wheel.raycastResult.hitNormalWorld as unknown as THREE.Vector3);count++;}
    if(count<2){this.mesh.visible=false;return;}
    height/=count;this.normal.normalize();this.tilt.setFromUnitVectors(this.up,this.normal);
    const q=physics.body.quaternion,heading=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.z*q.z));this.yaw.setFromAxisAngle(this.up,heading);
    this.mesh.quaternion.copy(this.tilt).multiply(this.yaw);this.mesh.position.set(physics.body.position.x,height+.028,physics.body.position.z);this.mesh.scale.set(physics.profile.width*1.12,1,physics.profile.length*.98);
    const clearance=physics.body.position.y-height;(this.mesh.material as THREE.MeshBasicMaterial).opacity=.4*THREE.MathUtils.clamp(1-(clearance-.25)*1.2,.1,1);this.mesh.visible=true;
  }
}
