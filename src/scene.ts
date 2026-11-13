import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeKart } from './kart';
import { KartPhysics } from './physics';
import { nearestOnTrack, type TrackData, type TrackSettings } from './track';

export type CameraMode='orbit'|'chase'|'top'|'cockpit';
const material=(color:number,roughness=.9)=>new THREE.MeshStandardMaterial({color,roughness});
export class GameScene {
  renderer:THREE.WebGLRenderer;
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,1,1,1400);
  orbit:OrbitControls;
  kart=makeKart();
  circuit=new THREE.Group();
  scenery=new THREE.Group();
  physics:KartPhysics;
  track!:TrackData;
  mode:CameraMode='orbit';
  private target=new THREE.Vector3();
  private desired=new THREE.Vector3();
  private resizeObserver:ResizeObserver;
  private skidPositions:number[]=[];
  private skidLine:THREE.LineSegments;
  private previousSkid:(THREE.Vector3|null)[]=[null,null];
  private time=0;
  onContextLost=()=>{};
  constructor(public container:HTMLElement,physics:KartPhysics){
    this.physics=physics;
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate=false;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
    container.append(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','3D 卡丁车赛道。拖动旋转视角，滚轮缩放。');
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.onContextLost();});
    this.scene.background=new THREE.Color(0xc6d2c7);this.scene.fog=new THREE.Fog(0xc6d2c7,400,950);
    const hemi=new THREE.HemisphereLight(0xebf5f2,0x6d8065,2.4);this.scene.add(hemi);
    const sun=new THREE.DirectionalLight(0xfff3d4,3.3);sun.position.set(-100,180,80);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-225,right:225,top:200,bottom:-200,near:1,far:500});sun.shadow.normalBias=.035;sun.shadow.bias=-.0004;this.scene.add(sun);this.scene.add(sun.target);
    const grass=material(0x9aac8d);const floor=new THREE.Mesh(new THREE.PlaneGeometry(1800,1800),grass);floor.rotation.x=-Math.PI/2;floor.position.y=-.055;floor.receiveShadow=true;this.scene.add(floor);
    const grid=new THREE.GridHelper(1200,120,0x9aaa90,0x9aaa90);(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.19;grid.position.y=-.045;this.scene.add(grid);
    this.scene.add(this.circuit,this.scenery,this.kart.root,...this.kart.wheelMeshes);
    this.skidLine=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x141b18,transparent:true,opacity:.36}));this.scene.add(this.skidLine);
    this.camera.position.set(260,290,340);this.orbit=new OrbitControls(this.camera,this.renderer.domElement);this.orbit.enableDamping=true;this.orbit.dampingFactor=.065;this.orbit.maxPolarAngle=Math.PI/2-.08;this.orbit.minDistance=5;this.orbit.maxDistance=700;this.orbit.target.set(0,0,-8);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
  }
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(w<1||h<1)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();if(this.track&&this.mode==='orbit')this.frameTrack();}
  private clearGroup(group:THREE.Group){group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){if(m.map)m.map.dispose();m.dispose();}}});group.clear();}
  private ribbon(track:TrackData,offset:number,width:number,y:number,color:number,filter?:(i:number)=>boolean){
    const positions:number[]=[],indices:number[]=[],n=track.samples.length;
    for(let i=0;i<n;i++){if(filter&&!filter(i))continue;const a=track.samples[i],b=track.samples[(i+1)%n],base=positions.length/3;
      for(const [s,o] of [[a,offset-width/2],[a,offset+width/2],[b,offset-width/2],[b,offset+width/2]] as const)positions.push(s.x+s.nx*o,y,s.z+s.nz*o);
      indices.push(base,base+1,base+2,base+1,base+3,base+2);
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
    const surfaceMaterial=material(color);surfaceMaterial.polygonOffset=true;surfaceMaterial.polygonOffsetFactor=-y*100;surfaceMaterial.polygonOffsetUnits=-y*100;
    const mesh=new THREE.Mesh(geo,surfaceMaterial);mesh.receiveShadow=true;this.circuit.add(mesh);return mesh;
  }
  private box(group:THREE.Group,x:number,y:number,z:number,w:number,h:number,d:number,color:number){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;}
  private sign(text:string,w:number,h:number,bg='#1c3031',fg='#d1ef70'){
    const c=document.createElement('canvas');c.width=1024;c.height=192;const ctx=c.getContext('2d')!;ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='italic 900 116px Arial';ctx.fillText(text,c.width/2,c.height*.53);const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map}));
  }
  setTrack(track:TrackData,settings:TrackSettings){
    this.track=track;this.clearGroup(this.circuit);this.clearGroup(this.scenery);
    const half=track.width/2;
    this.ribbon(track,0,track.width+2.6,.006,0xb6baab);
    this.ribbon(track,0,track.width,.018,0x414b4b);
    for(const side of [-1,1]){
      this.ribbon(track,side*(half-.24),.13,.026,0xe5e8d7);
      if(settings.curbs){
        // Kerbs only follow a turn: the apex edge and outer exit are selected by signed curvature.
        const curb=(i:number)=>Math.abs(track.samples[i].curvature)>.009;
        this.ribbon(track,side*(half+.46),.92,.045,0xf0eee1,curb);
        this.ribbon(track,side*(half+.46),.92,.049,0xd85f4d,i=>curb(i)&&Math.floor(track.samples[i].distance/2.15)%2===0);
        this.ribbon(track,side*(half+1.15),.45,.020,0x709e81,i=>Math.abs(track.samples[i].curvature)>.024&&Math.sign(track.samples[i].curvature)===side);
      }
      if(settings.barriers){
        const positions:THREE.Vector3[]=[];const offset=half+1.55;
        for(let i=0;i<=track.samples.length;i++){const s=track.samples[i%track.samples.length];positions.push(new THREE.Vector3(s.x+s.nx*offset,.36,s.z+s.nz*offset));}
        const path=new THREE.CatmullRomCurve3(positions,false,'centripetal');
        const rail=new THREE.Mesh(new THREE.TubeGeometry(path,Math.ceil(track.length/3),.24,5,false),material(0x7e8d85));rail.castShadow=true;this.circuit.add(rail);
        const postCount=Math.ceil(track.samples.length/9),posts=new THREE.InstancedMesh(new THREE.BoxGeometry(.20,.4,.20),material(0x687971),postCount),dummy=new THREE.Object3D();
        for(let i=0,j=0;i<track.samples.length;i+=9,j++){const s=track.samples[i];dummy.position.set(s.x+s.nx*offset,.20,s.z+s.nz*offset);dummy.updateMatrix();posts.setMatrixAt(j,dummy.matrix);}posts.castShadow=true;posts.receiveShadow=true;this.circuit.add(posts);
      }
    }
    // Checkered grid and a real start gantry aligned to the first track tangent.
    const start=track.samples[0],yaw=Math.atan2(-start.tx,-start.tz),grid=new THREE.Group();grid.position.set(start.x,.03,start.z);grid.rotation.y=yaw;this.circuit.add(grid);
    for(let row=0;row<3;row++)for(let col=0;col<Math.ceil(track.width/.62);col++)this.box(grid,-half+.31+col*.62,.005,(row-1)*.62,.62,.012,.62,(row+col)%2===0?0xf4f1e1:0x263738);
    for(let k=1;k<=5;k++){this.box(grid,-track.width*.23,.012,k*4.1,.09,.015,1.7,0xc4c9b7);this.box(grid,track.width*.23,.012,k*4.1+2,.09,.015,1.7,0xc4c9b7);}
    for(const side of [-1,1])this.box(grid,(half+1.4)*side,2.8,0,.25,5.6,.25,0x263d3e);
    this.box(grid,0,5.45,0,track.width+3.4,1.25,.45,0x253c3d);
    const sign=this.sign('APEX  /  KART CLUB',track.width+2.9,.83);sign.position.set(0,5.48,.25);grid.add(sign);
    const back=this.sign('APEX  /  KART CLUB',track.width+2.9,.83);back.position.set(0,5.48,-.25);back.rotation.y=Math.PI;grid.add(back);
    for(let i=0;i<5;i++){const lamp=new THREE.Mesh(new THREE.SphereGeometry(.11,8,8),new THREE.MeshStandardMaterial({color:0xc5ef4e,emissive:0x486612,emissiveIntensity:.5}));lamp.position.set((i-2)*.44,4.68,0);grid.add(lamp);}
    this.addScenery();this.skidPositions=[];this.skidLine.geometry.dispose();this.skidLine.geometry=new THREE.BufferGeometry();this.previousSkid=[null,null];this.renderer.shadowMap.needsUpdate=true;this.frameTrack();
  }
  private addScenery(){
    const b=this.track.bounds;
    let seed=713;const random=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};
    // Spatially checked planting never blocks the asphalt.
    const trees:{x:number;z:number;scale:number;stretch:number;variant:number}[]=[];
    for(let i=0;i<145;i++){
      const x=(random()-.5)*(b.maxX-b.minX+150)+(b.maxX+b.minX)/2,z=(random()-.5)*(b.maxZ-b.minZ+120)+(b.maxZ+b.minZ)/2;
      const near=nearestOnTrack(this.track,{x,z});if(near.distance<18||Math.abs(x)<55&&z>b.maxZ-15)continue;
      trees.push({x,z,scale:.6+random()*.8,stretch:1+random()*.5,variant:i%3});
    }
    const dummy=new THREE.Object3D(),trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.35,.5,3.4,7),material(0x6b6c52),trees.length),patches=new THREE.InstancedMesh(new THREE.CircleGeometry(4.8,20),material(0x8fa483),trees.length);
    trees.forEach((t,i)=>{dummy.position.set(t.x,1.7*t.scale,t.z);dummy.scale.setScalar(t.scale);dummy.rotation.set(0,0,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);dummy.position.set(t.x,-.035,t.z);dummy.rotation.x=-Math.PI/2;dummy.updateMatrix();patches.setMatrixAt(i,dummy.matrix);});trunks.castShadow=true;patches.receiveShadow=true;this.scenery.add(trunks,patches);
    for(let variant=0;variant<3;variant++){const subset=trees.filter(t=>t.variant===variant),crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.5,1),material([0x688969,0x779575,0x4f7660][variant]),subset.length);subset.forEach((t,i)=>{dummy.position.set(t.x,4.9*t.scale,t.z);dummy.rotation.set(0,0,0);dummy.scale.set(t.scale,t.scale*t.stretch,t.scale);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);});crowns.castShadow=true;crowns.receiveShadow=true;this.scenery.add(crowns);}
    // Paddock, pit awnings and a viewing stand beyond the outer track boundary.
    const pitZ=b.maxZ+25;
    this.box(this.scenery,-10,-.015,pitZ,110,.04,24,0xb9bcad);
    this.box(this.scenery,-22,2.9,pitZ+5,72,5.8,10,0xdbddce);
    this.box(this.scenery,-22,5.95,pitZ+5,74,.25,12,0x2d4948);
    for(let i=0;i<7;i++){const x=-51+i*9.5;this.box(this.scenery,x,1.8,pitZ-.1,7.3,3.6,.12,0x3c5350);this.box(this.scenery,x,4.5,pitZ-1,8.6,.15,4.5,i%2?0xe9eadc:0xc5de85);}
    const pitSign=this.sign('APEX  MOTORSPORT',24,2.8);pitSign.position.set(-22,4.25,pitZ-.06);pitSign.rotation.y=Math.PI;this.scenery.add(pitSign);
    const viewing=new THREE.Group();viewing.position.set(b.maxX+32,0,(b.minZ+b.maxZ)/2);viewing.rotation.y=Math.PI/2;this.scenery.add(viewing);
    for(let row=0;row<5;row++)this.box(viewing,0,.5+row*.65,row*1.3,28,.6,1.1,row%2?0x708780:0xb5bfa6);
    this.box(viewing,0,5.5,2.5,30,.3,10,0x2f4944);
    for(const x of [-13,13])this.box(viewing,x,2.7,3.5,.22,5.4,.22,0x536d64);
    // Windsocks and sparse APEX flags give scale without visual clutter.
    for(const x of [-58,-45,47]){
      this.box(this.scenery,x,5.4,pitZ-14,.13,10.8,.13,0x71877c);
      const flag=new THREE.Mesh(new THREE.PlaneGeometry(2.7,4.8),new THREE.MeshStandardMaterial({color:0xc3e978,side:THREE.DoubleSide,roughness:.9}));flag.position.set(x+1.4,8,pitZ-14);this.scenery.add(flag);
    }
  }
  frameTrack(){
    if(!this.track)return;const b=this.track.bounds;const center=new THREE.Vector3((b.minX+b.maxX)/2,0,(b.minZ+b.maxZ)/2);
    const size=Math.max(b.maxX-b.minX,(b.maxZ-b.minZ)*1.35);const aspect=Math.max(.4,this.camera.aspect),scale=Math.max(1,1.1/aspect);
    this.orbit.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(size*.57*scale,size*.90*scale,size*.94*scale));this.camera.lookAt(center);this.orbit.update();
    const fog=this.scene.fog as THREE.Fog,range=this.camera.position.distanceTo(center);fog.near=Math.max(450,range*.95);fog.far=Math.max(1000,range*2.5);
  }
  setCamera(mode:CameraMode){this.mode=mode;this.camera.near=mode==='cockpit'?.08:1;this.camera.fov=45;this.camera.updateProjectionMatrix();this.orbit.enabled=mode==='orbit';if(mode==='orbit')this.frameTrack();else{const fog=this.scene.fog as THREE.Fog;fog.near=400;fog.far=950;}}
  setColor(color:string){this.kart.paint.color.set(color);}
  update(dt:number,running:boolean){
    this.time+=dt;
    const body=this.physics.body;this.kart.root.position.copy(body.position as any);this.kart.root.quaternion.copy(body.quaternion as any);
    this.kart.steering.rotation.z=this.physics.telemetry.steering*1.8;
    this.kart.wheelMeshes.forEach((w,i)=>{const t=this.physics.vehicle.wheelInfos[i].worldTransform;w.position.copy(t.position as any);w.quaternion.copy(t.quaternion as any);});
    if(this.mode==='orbit')this.orbit.update();
    else{
      const q=this.kart.root.quaternion,p=this.kart.root.position;
      if(this.mode==='chase'){
        this.desired.set(0,4.2,7.4).applyQuaternion(q).add(p);this.target.set(0,.7,-4.5).applyQuaternion(q).add(p);
        this.camera.position.lerp(this.desired,1-Math.exp(-dt*4.5));this.camera.lookAt(this.target);this.camera.fov=53+Math.min(this.physics.telemetry.speed/12,7);
      }else if(this.mode==='cockpit'){
        this.desired.set(0,1.20,.40).applyQuaternion(q).add(p);this.target.set(0,.9,-16).applyQuaternion(q).add(p);
        this.camera.position.copy(this.desired);this.camera.lookAt(this.target);this.camera.fov=75;
      }else{
        this.desired.copy(p).add(new THREE.Vector3(.01,85,30));this.camera.position.lerp(this.desired,1-Math.exp(-dt*4));this.camera.lookAt(p);this.camera.fov=48;
      }
      this.camera.updateProjectionMatrix();
    }
    if(running&&this.physics.telemetry.speed>12){
      let changed=false;
      for(let j=0;j<2;j++){
        const w=this.physics.vehicle.wheelInfos[j+2],v=new THREE.Vector3(w.raycastResult.hitPointWorld.x,.035,w.raycastResult.hitPointWorld.z);
        if(w.isInContact&&(this.physics.input.handbrake||w.skidInfo<.7)&&!this.physics.telemetry.offroad){const previous=this.previousSkid[j];if(previous&&previous.distanceTo(v)<2){this.skidPositions.push(...previous.toArray(),...v.toArray());changed=true;}this.previousSkid[j]=v;}else this.previousSkid[j]=null;
      }
      if(changed){if(this.skidPositions.length>24000)this.skidPositions.splice(0,600);this.skidLine.geometry.dispose();this.skidLine.geometry=new THREE.BufferGeometry();this.skidLine.geometry.setAttribute('position',new THREE.Float32BufferAttribute(this.skidPositions,3));}
    }
    if(running||this.time<2)this.renderer.shadowMap.needsUpdate=true;
    this.renderer.render(this.scene,this.camera);
  }
}
