import * as CANNON from 'cannon-es';
import {GUARDRAIL_PROFILE,guardrailHeight,guardrailLayout,type GuardrailPoint} from './guardrail-layout';
import type {TrackData} from './track';
import type {TerrainField} from './terrain';

export const GUARDRAIL_COLLISION_GROUP=2;
interface RailContactSurface {
  ax:number;az:number;bx:number;bz:number;halfThickness:number;
  a:GuardrailPoint;b:GuardrailPoint;startJoined:boolean;endJoined:boolean;
}
const contactSurfaces=new WeakMap<CANNON.Shape,RailContactSurface>();
const railNormal=new CANNON.Vec3(),railPoint=new CANNON.Vec3();

/** Join side normals across the small overlapping prisms. Their internal end
 * caps are construction seams, whereas marshal openings keep real end caps. */
export function smoothGuardrailContact(contact:CANNON.ContactEquation,chassis:CANNON.Body){
  const first=contact.bi===chassis,surface=contactSurfaces.get(contact.si)??contactSurfaces.get(contact.sj);
  if(!surface||Math.abs(contact.ni.y)>.65)return;
  const {ax,az,bx,bz,a,b,halfThickness,startJoined,endJoined}=surface;
  const dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz),other=first?contact.bj:contact.bi;
  other.position.vadd(first?contact.rj:contact.ri,railPoint);
  const along=((railPoint.x-ax)*dx+(railPoint.z-az)*dz)/(length*length);
  const endNormal=Math.abs((contact.ni.x*dx+contact.ni.z*dz)/length)>.7;
  if(endNormal&&((along<.05&&!startJoined)||(along>.95&&!endJoined)))return;
  const t=Math.max(0,Math.min(1,along));
  railNormal.set(a.nx+(b.nx-a.nx)*t,0,a.nz+(b.nz-a.nz)*t);railNormal.normalize();
  // Select the contacted side using the incoming normal, falling back to the
  // chassis side for a seam cap whose normal points along the rail.
  const alignment=contact.ni.dot(railNormal)*(first?-1:1);
  const side=Math.sign(Math.abs(alignment)>.2?alignment:(chassis.position.x-ax-dx*t)*railNormal.x+(chassis.position.z-az-dz*t)*railNormal.z)||1;
  railNormal.scale(side,railNormal);railNormal.scale(first?-1:1,contact.ni);
  const arm=first?contact.ri:contact.rj;
  // The RB20's raised safety sphere must not turn a shallow side scrape into
  // a large roll impulse. Keep the yaw lever so the body can settle along it.
  arm.y=0;
  chassis.position.vadd(arm,railPoint);
  railPoint.set(ax+dx*t+railNormal.x*halfThickness,railPoint.y,az+dz*t+railNormal.z*halfThickness);
  railPoint.vsub(other.position,first?contact.rj:contact.ri);
}

/** Closed, sloped prisms work with both the kart's box and the RB20's sphere.
 * Each render chunk gets one static compound body, with the same open ends. */
export function guardrailBodies(track:TrackData,terrain:TerrainField,material:CANNON.Material){
  const bodies:CANNON.Body[]=[],profile=GUARDRAIL_PROFILE;
  const paths=guardrailLayout(track).paths,endpoints=new Map<string,number>();
  const key=(p:GuardrailPoint)=>`${p.x.toFixed(3)},${p.z.toFixed(3)},${p.deck.toFixed(3)}`;
  for(const path of paths)for(const p of [path[0],path[path.length-1]])endpoints.set(key(p),(endpoints.get(key(p))??0)+1);
  const bands=[
    {offset:(profile.front+profile.back)/2,thickness:profile.back-profile.front+.04,bottom:profile.base,top:profile.base+(profile.tiers-1)*profile.tierStep+profile.tierHeight},
    {offset:profile.fenceOffset,thickness:.055,bottom:profile.fenceBottom,top:profile.fenceTop},
  ];
  const addSegment=(body:CANNON.Body,a:GuardrailPoint,b:GuardrailPoint,startJoined:boolean,endJoined:boolean)=>{
    const ay=guardrailHeight(a,terrain),by=guardrailHeight(b,terrain);
    for(const band of bands){
      const ax=a.x+a.nx*band.offset,az=a.z+a.nz*band.offset,bx=b.x+b.nx*band.offset,bz=b.z+b.nz*band.offset,dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz);
      if(length<1e-5)continue;
      // A tiny overlap closes segment joints while keeping marshal gaps open.
      const x=length/2+.015,y=(band.top-band.bottom)/2,z=band.thickness/2,rise=(by-ay)*(x*2/length),halfRise=rise/2;
      const shape=Math.abs(rise)<1e-6?new CANNON.Box(new CANNON.Vec3(x,y,z)):new CANNON.ConvexPolyhedron({
        vertices:[
          new CANNON.Vec3(-x,-y-halfRise,-z),new CANNON.Vec3(x,-y+halfRise,-z),
          new CANNON.Vec3(x,y+halfRise,-z),new CANNON.Vec3(-x,y-halfRise,-z),
          new CANNON.Vec3(-x,-y-halfRise,z),new CANNON.Vec3(x,-y+halfRise,z),
          new CANNON.Vec3(x,y+halfRise,z),new CANNON.Vec3(-x,y-halfRise,z),
        ],
        faces:[[3,2,1,0],[4,5,6,7],[5,4,0,1],[2,3,7,6],[0,4,7,3],[1,2,6,5]],
      });
      const orientation=new CANNON.Quaternion();orientation.setFromEuler(0,Math.atan2(-dz,dx),0);
      shape.collisionFilterGroup=GUARDRAIL_COLLISION_GROUP;
      body.addShape(shape,new CANNON.Vec3((ax+bx)/2-body.position.x,(ay+by+band.bottom+band.top)/2-body.position.y,(az+bz)/2-body.position.z),orientation);
      contactSurfaces.set(shape,{ax,az,bx,bz,halfThickness:z,a,b,startJoined,endJoined});
    }
  };
  for(const path of paths){
    const center=path.reduce((sum,p)=>{sum.x+=p.x;sum.y+=guardrailHeight(p,terrain);sum.z+=p.z;return sum;},new CANNON.Vec3());center.scale(1/path.length,center);center.y+=(profile.base+profile.fenceTop)/2;
    const body=new CANNON.Body({mass:0,material,position:center,collisionFilterGroup:GUARDRAIL_COLLISION_GROUP});
    for(let i=0;i<path.length-1;i++)addSegment(body,path[i],path[i+1],i>0||(endpoints.get(key(path[i]))??0)>1,i<path.length-2||(endpoints.get(key(path[i+1]))??0)>1);
    if(!body.shapes.length)continue;body.updateAABB();bodies.push(body);
  }
  return bodies;
}
