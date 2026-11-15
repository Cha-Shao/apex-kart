import * as CANNON from 'cannon-es';
import {GUARDRAIL_PROFILE,guardrailHeight,guardrailLayout,type GuardrailPoint} from './guardrail-layout';
import type {TrackData} from './track';
import type {TerrainField} from './terrain';

/** Closed, sloped prisms work with both the kart's box and the RB20's sphere.
 * Each render chunk gets one static compound body, with the same open ends. */
export function guardrailBodies(track:TrackData,terrain:TerrainField,material:CANNON.Material){
  const bodies:CANNON.Body[]=[],profile=GUARDRAIL_PROFILE;
  const bands=[
    {offset:(profile.front+profile.back)/2,thickness:profile.back-profile.front+.04,bottom:profile.base,top:profile.base+(profile.tiers-1)*profile.tierStep+profile.tierHeight},
    {offset:profile.fenceOffset,thickness:.055,bottom:profile.fenceBottom,top:profile.fenceTop},
  ];
  const addSegment=(body:CANNON.Body,a:GuardrailPoint,b:GuardrailPoint)=>{
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
      body.addShape(shape,new CANNON.Vec3((ax+bx)/2-body.position.x,(ay+by+band.bottom+band.top)/2-body.position.y,(az+bz)/2-body.position.z),orientation);
    }
  };
  for(const path of guardrailLayout(track).paths){
    const center=path.reduce((sum,p)=>{sum.x+=p.x;sum.y+=guardrailHeight(p,terrain);sum.z+=p.z;return sum;},new CANNON.Vec3());center.scale(1/path.length,center);center.y+=(profile.base+profile.fenceTop)/2;
    const body=new CANNON.Body({mass:0,material,position:center});
    for(let i=0;i<path.length-1;i++)addSegment(body,path[i],path[i+1]);
    if(!body.shapes.length)continue;body.updateAABB();bodies.push(body);
  }
  return bodies;
}
