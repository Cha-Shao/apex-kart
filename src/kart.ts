import * as THREE from 'three';
const mat=(color:number,metalness=0,roughness=.65)=>new THREE.MeshStandardMaterial({color,metalness,roughness});
export function makeKart(){
  const root=new THREE.Group();
  const paint=mat(0xc4ed4c,.25,.32),dark=mat(0x192c30,.25,.42),black=mat(0x10191b,.05,.85),metal=mat(0x879a9a,.85,.3),white=mat(0xf0f1e9,.1,.4),suit=mat(0x23454a,.1,.8);
  const part=(geo:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,parent=root)=>{const mesh=new THREE.Mesh(geo,m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:THREE.Material,parent=root)=>part(new THREE.BoxGeometry(w,h,d),m,x,y,z,parent);
  const tube=(a:THREE.Vector3,b:THREE.Vector3,r:number,m:THREE.Material,parent=root)=>{const v=b.clone().sub(a);const mesh=part(new THREE.CylinderGeometry(r,r,v.length(),10),m,...a.clone().add(b).multiplyScalar(.5).toArray() as [number,number,number],parent);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return mesh;};
  // Welded tubular chassis, side pods and front nose.
  box(0,-.09,0,1.15,.14,1.94,dark);
  for(const x of [-.57,.57]){tube(new THREE.Vector3(x,-.02,.9),new THREE.Vector3(x,-.02,-1.0),.045,metal);box(x*1.24,.05,.02,.34,.25,1.21,paint);box(x*1.24,.185,.03,.26,.022,.85,dark);}
  box(0,-.02,-1.05,1.73,.18,.27,paint);box(0,-.035,1.10,1.70,.14,.15,dark);
  const nose=box(0,.12,-.72,.68,.22,.62,paint);nose.rotation.x=-.12;
  box(0,.24,-.74,.16,.018,.42,dark);
  box(0,.02,-.15,.55,.12,.64,metal);
  // Bucket seat, exposed engine, exhaust and rear axle.
  box(0,.16,.30,.55,.18,.58,black);const seat=box(0,.44,.58,.56,.62,.13,black);seat.rotation.x=-.16;
  tube(new THREE.Vector3(-.87,-.02,.79),new THREE.Vector3(.87,-.02,.79),.065,metal);
  box(.48,.22,.70,.38,.37,.43,dark);for(let i=0;i<6;i++)box(.48,.20+i*.041,.70,.40,.018,.45,metal);
  tube(new THREE.Vector3(.58,.31,.87),new THREE.Vector3(.58,.30,1.22),.07,dark);
  part(new THREE.CylinderGeometry(.11,.11,.23,16),black,-.45,.24,.7).rotation.z=Math.PI/2;
  // Driver: legs, torso, articulated arms and a helmet with a dark visor.
  for(const x of [-.16,.16]){const leg=box(x,.20,-.20,.19,.20,.65,suit);leg.rotation.x=.15;box(x,.14,-.60,.20,.13,.24,black);}
  const torso=part(new THREE.CapsuleGeometry(.22,.22,5,10),suit,0,.60,.32);torso.rotation.x=-.18;
  part(new THREE.SphereGeometry(.265,24,16),white,0,1.05,.28);
  const visor=part(new THREE.SphereGeometry(.272,24,12,Math.PI*.55,Math.PI*.9,Math.PI*.30,Math.PI*.40),dark,0,1.06,.28);visor.rotation.y=Math.PI;
  box(0,1.302,.27,.065,.016,.22,paint);
  const steering=new THREE.Group();steering.position.set(0,.47,-.32);steering.rotation.x=.60;root.add(steering);
  const ring=part(new THREE.TorusGeometry(.22,.027,8,24),black,0,0,0,steering);ring.rotation.x=0;
  for(const a of [0,Math.PI*2/3,Math.PI*4/3]){const spoke=box(Math.sin(a)*.10,Math.cos(a)*.10,0,.025,.22,.025,metal,steering);spoke.rotation.z=-a;}
  tube(new THREE.Vector3(0,.30,-.24),new THREE.Vector3(0,.45,-.33),.035,metal);
  for(const side of [-1,1]){tube(new THREE.Vector3(side*.20,.71,.28),new THREE.Vector3(side*.32,.50,.0),.075,suit);tube(new THREE.Vector3(side*.32,.50,0),new THREE.Vector3(side*.19,.51,-.29),.065,suit);part(new THREE.SphereGeometry(.085,10,8),black,side*.19,.51,-.29);}
  // Number plates generated locally: no remote assets are needed to play.
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#eef0d8';ctx.fillRect(0,0,128,128);ctx.fillStyle='#152629';ctx.font='900 100px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('07',64,70);
  const number=new THREE.CanvasTexture(canvas);number.colorSpace=THREE.SRGBColorSpace;
  const plate=part(new THREE.PlaneGeometry(.40,.32),new THREE.MeshStandardMaterial({map:number,roughness:.5}),0,.28,-.93);plate.rotation.x=-Math.PI/2+.22;
  const rear=part(new THREE.PlaneGeometry(.40,.28),new THREE.MeshStandardMaterial({map:number}),0,.30,1.13);rear.rotation.y=Math.PI;
  const wheelMeshes:THREE.Group[]=[];
  const tire=mat(0x141b1c,.0,.94),rubberEdge=mat(0x202929,.0,.9);
  for(let i=0;i<4;i++){
    const wheel=new THREE.Group();const width=i<2?.23:.29;
    const cylinder=new THREE.Mesh(new THREE.CylinderGeometry(.29,.29,width,24),tire);cylinder.rotation.z=Math.PI/2;cylinder.castShadow=true;wheel.add(cylinder);
    for(const side of [-1,1]){const sideWall=new THREE.Mesh(new THREE.TorusGeometry(.228,.048,8,24),rubberEdge);sideWall.rotation.y=Math.PI/2;sideWall.position.x=side*width/2;wheel.add(sideWall);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.125,.125,.012,12),metal);hub.rotation.z=Math.PI/2;hub.position.x=side*(width/2+.007);wheel.add(hub);const cap=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.02,8),dark);cap.rotation.z=Math.PI/2;cap.position.x=side*(width/2+.017);wheel.add(cap);}
    const wrapper=new THREE.Group();wrapper.add(wheel);wheelMeshes.push(wrapper);
  }
  return {root,wheelMeshes,paint,steering};
}
