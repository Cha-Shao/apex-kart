import * as THREE from 'three';
import {VEHICLES} from './vehicles';

/** Original procedural RB20-inspired model; metre scale, with a real 3D Halo. */
export function makeRB20(){
 const spec=VEHICLES.rb20,root=new THREE.Group();
 const paint=new THREE.MeshStandardMaterial({color:0x122047,metalness:.28,roughness:.42});
 const carbon=new THREE.MeshStandardMaterial({color:0x101419,metalness:.25,roughness:.66});
 const red=new THREE.MeshStandardMaterial({color:0xd82a38,roughness:.48});
 const yellow=new THREE.MeshStandardMaterial({color:0xf2cb36,roughness:.45});
 const black=new THREE.MeshStandardMaterial({color:0x080c0e,roughness:.85});
 const metal=new THREE.MeshStandardMaterial({color:0x8a949e,metalness:.85,roughness:.4});
 const part=(geo:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,parent=root)=>{const mesh=new THREE.Mesh(geo,material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:THREE.Material,parent=root)=>part(new THREE.BoxGeometry(w,h,d),m,x,y,z,parent);
 const sphere=(x:number,y:number,z:number,sx:number,sy:number,sz:number,m:THREE.Material,parent=root)=>{const mesh=part(new THREE.SphereGeometry(1,24,14),m,x,y,z,parent);mesh.scale.set(sx,sy,sz);return mesh;};
 const rod=(a:THREE.Vector3,b:THREE.Vector3,r:number,m:THREE.Material,parent=root)=>{const direction=b.clone().sub(a),mesh=part(new THREE.CylinderGeometry(r,r,direction.length(),9),m,(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2,parent);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());return mesh;};
 // Narrow nose, floor and high-shouldered, downwashed sidepods.
 box(0,-.10,.15,1.54,.055,3.87,carbon);
 sphere(0,.12,-.54,.30,.19,1.62,paint);
 sphere(0,.11,-2.50,.18,.10,.49,yellow);
 for(const side of [-1,1]){
  sphere(side*.51,.13,.28,.30,.24,1.05,paint);
  box(side*.53,.24,-.43,.48,.12,.31,black);
  box(side*.59,.315,-.51,.56,.045,.10,paint);
  sphere(side*.48,.35,.15,.13,.12,.72,paint);
  box(side*.71,-.04,.5,.13,.045,1.43,carbon);
  for(let i=0;i<5;i++){const louvre=box(side*.51,.36,.44+i*.10,.24,.016,.045,carbon);louvre.rotation.z=side*.2;}
 }
 // Exposed cockpit rim, reclined seat and the spine behind the driver's head.
 box(0,.13,.39,.46,.25,1.12,black);
 for(const side of [-1,1])box(side*.28,.28,.30,.13,.21,1.16,paint);
 sphere(0,.29,1.18,.29,.29,.86,paint);
 const spine=box(0,.46,1.30,.045,.40,1.44,paint);spine.rotation.x=-.10;
 sphere(0,.66,.98,.16,.14,.19,black);box(0,.77,.98,.34,.08,.28,paint);
 // Multi-element front wing and upturned endplates, 2.0 m overall width.
 for(let i=0;i<4;i++){const wing=box(0,-.04+i*.035,-2.96+i*.095,1.94,.027,.17,i===0?carbon:paint);wing.rotation.x=-.14-i*.05;}
 for(const side of [-1,1]){box(side*.97,.015,-2.81,.055,.28,.52,paint);box(side*.84,.12,-2.67,.27,.03,.18,red);}
 // Rear wing, support pylons, beam wing, diffuser strakes and exhaust.
 for(const side of [-1,1]){box(side*.61,.45,2.27,.045,.68,.52,paint);rod(new THREE.Vector3(side*.14,.07,1.91),new THREE.Vector3(side*.14,.69,2.24),.022,carbon);}
 box(0,.71,2.27,1.28,.07,.48,paint);const flap=box(0,.84,2.34,1.27,.05,.27,paint);flap.rotation.x=.20;
 box(0,.08,2.16,1.05,.045,.30,carbon);
 for(const x of [-.42,-.21,0,.21,.42])box(x,-.04,1.91,.025,.16,.76,carbon);
 const exhaust=part(new THREE.CylinderGeometry(.055,.065,.31,12),metal,0,.40,1.98);exhaust.rotation.x=Math.PI/2;
 // Suspension wishbones and steering rods remain visible beside the cockpit.
 for(const [half,z] of [[spec.frontHalfTrack,spec.frontZ],[spec.rearHalfTrack,spec.rearZ]])for(const side of [-1,1]){
  const hub=new THREE.Vector3(side*half,.164,z);
  for(const [y,dz] of [[.02,-.32],[.02,.32],[.25,-.25],[.25,.25]])rod(new THREE.Vector3(side*.27,y,z+dz),hub,.019,carbon);
  rod(new THREE.Vector3(side*.31,.32,z+.20),new THREE.Vector3(side*(half-.12),.13,z),.022,carbon);
 }
 // Red/yellow livery cues are locally generated vector shapes, not remote textures.
 for(const side of [-1,1]){sphere(side*.755,.19,.35,.025,.19,.50,red);sphere(side*.777,.21,.20,.018,.16,.20,yellow);}
 const label=(text:string,w:number,h:number,color='#ffffff',bg='#122047')=>{const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d')!;c.fillStyle=bg;c.fillRect(0,0,1024,256);c.fillStyle=color;c.font='bold 175px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(text,512,140);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});};
 for(const side of [-1,1]){const name=part(new THREE.PlaneGeometry(1.04,.19),label('ORACLE',1,.2),side*.795,.17,.24);name.rotation.y=side*Math.PI/2;}
 const number=part(new THREE.PlaneGeometry(.23,.38),label('1',.23,.38,'#ffffff','#edc42d'),0,.254,-1.74);number.rotation.x=-Math.PI/2;
 part(new THREE.PlaneGeometry(1.08,.18),label('ORACLE',1,.2),0,.79,2.49);
 // Driver's helmet is hidden only in cockpit mode; Halo always remains visible.
 const head=new THREE.Group();head.position.set(0,.57,.62);root.add(head);
 sphere(0,0,0,.155,.16,.18,yellow,head);sphere(0,-.005,-.125,.146,.067,.067,black,head);
 box(0,.145,-.02,.055,.02,.23,red,head);
 sphere(0,.20,.54,.20,.23,.35,paint);
 const steering=new THREE.Group();steering.position.set(0,.38,-.13);steering.rotation.x=.22;root.add(steering);
 box(0,0,0,.36,.19,.055,carbon,steering);for(const side of [-1,1]){sphere(side*.19,0,0,.045,.11,.045,black,steering);for(const y of [-.035,.03])sphere(side*.13,y,.035,.014,.014,.007,y>0?yellow:red,steering);}
 const screenCanvas=document.createElement('canvas');screenCanvas.width=256;screenCanvas.height=128;const ctx=screenCanvas.getContext('2d')!;const screenTexture=new THREE.CanvasTexture(screenCanvas);screenTexture.colorSpace=THREE.SRGBColorSpace;let lastGear:number|undefined,lastLit=-1;const lampColors=['#54e85a','#54e85a',...Array(6).fill('#ff3030'),...Array(5).fill('#28cfff')];const updateDashboard=(gear:number,rpm:number)=>{const lit=Math.max(0,Math.min(13,Math.ceil((rpm-6500)/(11600-6500)*13)));if(gear===lastGear&&lit===lastLit)return;lastGear=gear;lastLit=lit;ctx.fillStyle='#06100d';ctx.fillRect(0,0,256,128);lampColors.forEach((color,i)=>{const x=28+i*16.7,y=23;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=i<lit?color:'#182725';ctx.fill();if(i<lit){ctx.shadowColor=color;ctx.shadowBlur=7;ctx.fill();ctx.shadowBlur=0;}});const displayGear=gear<0?'R':gear===0?'N':String(Math.min(8,Math.floor(gear)));ctx.fillStyle='#a9e4bb';ctx.font='bold 72px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(displayGear,128,83);screenTexture.needsUpdate=true;};updateDashboard(0,0);
 part(new THREE.PlaneGeometry(.15,.075),new THREE.MeshBasicMaterial({map:screenTexture}),0,.015,.034,steering);
 for(const side of [-1,1]){rod(new THREE.Vector3(side*.18,.27,.50),new THREE.Vector3(side*.24,.27,.11),.055,paint);rod(new THREE.Vector3(side*.24,.27,.11),new THREE.Vector3(side*.19,.36,-.12),.045,paint);sphere(side*.19,.37,-.13,.05,.06,.05,black);}
 const halo=new THREE.Group();halo.name='RB20 Halo';root.add(halo);
 const haloCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.30,.38,.87),new THREE.Vector3(-.35,.72,.62),new THREE.Vector3(-.31,.77,.04),new THREE.Vector3(0,.72,-.61),new THREE.Vector3(.31,.77,.04),new THREE.Vector3(.35,.72,.62),new THREE.Vector3(.30,.38,.87)],false,'centripetal');
 const haloRing=new THREE.Mesh(new THREE.TubeGeometry(haloCurve,64,.035,10,false),carbon);haloRing.castShadow=true;halo.add(haloRing);
 // Central pillar between the front mounting and the eye line is intentionally opaque.
 rod(new THREE.Vector3(0,.28,-.65),new THREE.Vector3(0,.72,-.61),.038,carbon,halo);
 const wheelMeshes:THREE.Group[]=[];
 for(let i=0;i<4;i++){
  const wheel=new THREE.Group(),width=i<2?spec.frontTyreWidth:spec.rearTyreWidth;
  const tyre=new THREE.Mesh(new THREE.CylinderGeometry(spec.wheelRadius,spec.wheelRadius,width,40),black);tyre.rotation.z=Math.PI/2;tyre.castShadow=true;wheel.add(tyre);
  for(const side of [-1,1]){const wall=new THREE.Mesh(new THREE.TorusGeometry(.285,.013,6,40),yellow);wall.rotation.y=Math.PI/2;wall.position.x=side*(width/2+.001);wheel.add(wall);const cover=new THREE.Mesh(new THREE.CylinderGeometry(.2286,.2286,.012,32),carbon);cover.rotation.z=Math.PI/2;cover.position.x=side*(width/2+.003);wheel.add(cover);const nut=new THREE.Mesh(new THREE.CylinderGeometry(.047,.047,.022,8),i<2?red:metal);nut.rotation.z=Math.PI/2;nut.position.x=side*(width/2+.013);wheel.add(nut);}
  wheelMeshes.push(wheel);
 }
 return {root,wheelMeshes,paint,steering,head,halo,updateDashboard};
}
