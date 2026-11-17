import * as THREE from 'three';
import type {KartPhysics} from './physics';
import type {TerrainField} from './terrain';
import type {DetailLayer} from './track-environment';
import {drapeTriangles} from './terrain-mesh';

export interface GroundContact {x:number;z:number;radiusX:number;radiusZ:number;strength:number;angle?:number}

/** Small terrain-draped root/footing occlusion; sunlight supplies the canopy. */
export function addGroundContactShadows(group:THREE.Group,terrain:TerrainField,contacts:GroundContact[],name:string):DetailLayer[]{
  if(!contacts.length)return [];
  const cells=new Map<string,GroundContact[]>(),layers:DetailLayer[]=[];
  for(const p of contacts){const key=`${Math.floor(p.x/70)},${Math.floor(p.z/70)}`,cell=cells.get(key)??[];cell.push(p);cells.set(key,cell);}
  const material=new THREE.MeshBasicMaterial({color:0x17231b,vertexColors:true,transparent:true,depthTest:true,depthWrite:false,toneMapped:false});
  for(const cell of cells.values()){
    const positions:number[]=[],colors:number[]=[],indices:number[]=[];
    for(const p of cell){
      const c=Math.cos(p.angle??0),s=Math.sin(p.angle??0),triangles:{x:number;z:number}[][]=[],point=(radius:number,angle:number)=>{const x=Math.cos(angle)*radius*p.radiusX,z=Math.sin(angle)*radius*p.radiusZ;return{x:p.x+c*x-s*z,z:p.z+s*x+c*z};};
      for(let i=0;i<8;i++){
        const a=i/8*Math.PI*2,b=(i+1)/8*Math.PI*2,innerA=point(.42,a),innerB=point(.42,b),outerA=point(1,a),outerB=point(1,b);
        triangles.push([{x:p.x,z:p.z},innerA,innerB],[innerA,outerA,innerB],[innerB,outerA,outerB]);
      }
      const data=drapeTriangles(triangles,(x,z)=>terrain.sample(x,z)-.011,terrain),base=positions.length/3;
      for(let i=0;i<data.vertices.length;i+=3){
        const x=data.vertices[i],z=data.vertices[i+2],dx=x-p.x,dz=z-p.z,r=Math.hypot((c*dx+s*dz)/p.radiusX,(-s*dx+c*dz)/p.radiusZ),fade=1-THREE.MathUtils.smoothstep(r,0,1);
        positions.push(x,data.vertices[i+1],z);colors.push(1,1,1,p.strength*fade);
      }
      for(const i of data.indices)indices.push(base+i);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));geometry.setIndex(indices);geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.renderOrder=2;group.add(mesh);
    if(geometry.boundingSphere)layers.push({object:mesh,center:geometry.boundingSphere.center.clone(),distance:320+geometry.boundingSphere.radius});
  }
  return layers;
}

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
