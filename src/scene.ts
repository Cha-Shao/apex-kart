import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeKart } from './kart';
import { makeRB20 } from './rb20';
import { KartPhysics } from './physics';
import { bridgeHeight, curbGeometry, runoffGeometry, CURB_WIDTH, nearestOnTrack, type TrackData, type TrackSettings } from './track';
import { TerrainField } from './terrain';

export type CameraMode='orbit'|'chase'|'top'|'cockpit';
const material=(color:number,roughness=.9)=>new THREE.MeshStandardMaterial({color,roughness});
export class GameScene {
  renderer:THREE.WebGLRenderer;
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,1,1,1400);
  orbit:OrbitControls;
  kart:ReturnType<typeof makeKart>&{updateDashboard?:(gear:number,rpm:number)=>void};
  circuit=new THREE.Group();
  scenery=new THREE.Group();
  landscape=new THREE.Group();
  terrain=new TerrainField();
  physics:KartPhysics;
  track!:TrackData;
  mode:CameraMode='orbit';
  private target=new THREE.Vector3();
  private desired=new THREE.Vector3();
  private resizeObserver:ResizeObserver;
  private skidPositions=new Float32Array(4096*18);
  private skidCount=0;
  private skidCursor=0;
  private skidMarks:THREE.Mesh;
  private previousSkid:({center:THREE.Vector3;left:THREE.Vector3;right:THREE.Vector3}|null)[]=[null,null];
  private time=0;
  onContextLost=()=>{};
  constructor(public container:HTMLElement,physics:KartPhysics){
    this.physics=physics;
    this.kart=physics.profile.id==='rb20'?makeRB20():makeKart();
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
    const grass=material(0x9aac8d);const floor=new THREE.Mesh(new THREE.PlaneGeometry(200000,200000),grass);floor.rotation.x=-Math.PI/2;floor.position.y=-70.055;floor.receiveShadow=true;this.scene.add(floor);
    this.scene.add(this.landscape,this.circuit,this.scenery,this.kart.root,...this.kart.wheelMeshes);
    const skidGeometry=new THREE.BufferGeometry();skidGeometry.setAttribute('position',new THREE.BufferAttribute(this.skidPositions,3).setUsage(THREE.DynamicDrawUsage));skidGeometry.setDrawRange(0,0);
    this.skidMarks=new THREE.Mesh(skidGeometry,new THREE.MeshBasicMaterial({color:0x101512,transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));this.skidMarks.frustumCulled=false;this.scene.add(this.skidMarks);
    this.camera.position.set(260,290,340);this.orbit=new OrbitControls(this.camera,this.renderer.domElement);this.orbit.enableDamping=true;this.orbit.dampingFactor=.065;this.orbit.maxPolarAngle=Math.PI/2-.08;this.orbit.minDistance=5;this.orbit.maxDistance=100000;this.orbit.target.set(0,0,-8);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
  }
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(w<1||h<1)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();if(this.track&&this.mode==='orbit')this.frameTrack();}
  setVehicle(){
    for(const group of [this.kart.root,...this.kart.wheelMeshes]){this.scene.remove(group);this.clearGroup(group);}
    this.kart=this.physics.profile.id==='rb20'?makeRB20():makeKart();this.scene.add(this.kart.root,...this.kart.wheelMeshes);
    this.skidCount=0;this.skidCursor=0;this.skidMarks.geometry.setDrawRange(0,0);this.previousSkid=[null,null];this.setCamera(this.mode);this.renderer.shadowMap.needsUpdate=true;
  }
  private clearGroup(group:THREE.Group){group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){if(m.map)m.map.dispose();m.dispose();}}});group.clear();}
  private ribbon(track:TrackData,offset:number,width:number,y:number,color:number,filter?:(i:number)=>boolean){
    const positions:number[]=[],indices:number[]=[],n=track.samples.length;
    for(let i=0;i<n;i++){if(filter&&!filter(i))continue;const a=track.samples[i],b=track.samples[(i+1)%n],base=positions.length/3;
      for(const [s,o,index] of [[a,offset-width/2,i],[a,offset+width/2,i],[b,offset-width/2,(i+1)%n],[b,offset+width/2,(i+1)%n]] as const){const x=s.x+s.nx*o,z=s.z+s.nz*o;positions.push(x,this.terrain.sample(x,z)+bridgeHeight(track,index)+y,z);}
      indices.push(base,base+1,base+2,base+1,base+3,base+2);
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
    const surfaceMaterial=material(color);surfaceMaterial.polygonOffset=true;surfaceMaterial.polygonOffsetFactor=-y*100;surfaceMaterial.polygonOffsetUnits=-y*100;
    const mesh=new THREE.Mesh(geo,surfaceMaterial);mesh.receiveShadow=true;this.circuit.add(mesh);return mesh;
  }
  private box(group:THREE.Group,x:number,y:number,z:number,w:number,h:number,d:number,color:number){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));mesh.position.set(x,y+(group===this.scenery?this.terrain.sample(x,z):0),z);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;}
  private makeLandscape(){
    this.clearGroup(this.landscape);const f=this.terrain,n=f.resolution,positions:number[]=[],colors:number[]=[],indices:number[]=[],base=new THREE.Color(0x9aac8d),high=new THREE.Color(0xc2b089),low=new THREE.Color(0x799b98);
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){const h=f.heights[z*n+x],color=base.clone().lerp(h>=0?high:low,Math.min(.7,Math.abs(h)/30));if(x%8===0||z%8===0)color.multiplyScalar(.985);positions.push(f.originX+x*f.cellSize,h-.025,f.originZ+z*f.cellSize);colors.push(color.r,color.g,color.b);if(x<n-1&&z<n-1){const a=z*n+x,b=a+1,c=a+n,d=c+1;indices.push(a,c,d,a,d,b);}}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));mesh.receiveShadow=true;this.landscape.add(mesh);
  }
  private sign(text:string,w:number,h:number,bg='#1c3031',fg='#d1ef70'){
    const c=document.createElement('canvas');c.width=1024;c.height=192;const ctx=c.getContext('2d')!;ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='italic 900 116px Arial';ctx.fillText(text,c.width/2,c.height*.53);const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map}));
  }
  setTrack(track:TrackData,settings:TrackSettings,terrain:TerrainField=new TerrainField()){
    this.track=track;this.terrain=terrain.clone();this.makeLandscape();this.clearGroup(this.circuit);this.clearGroup(this.scenery);
    const half=track.width/2;
    const runoff=runoffGeometry(track,(x,z)=>this.terrain.sample(x,z)),runoffGeo=new THREE.BufferGeometry();runoffGeo.setAttribute('position',new THREE.Float32BufferAttribute(runoff.vertices,3));runoffGeo.setIndex(runoff.indices);runoffGeo.computeVertexNormals();const runoffMat=material(0x59615b);runoffMat.polygonOffset=true;runoffMat.polygonOffsetFactor=-.8;runoffMat.polygonOffsetUnits=-.8;const apron=new THREE.Mesh(runoffGeo,runoffMat);apron.receiveShadow=true;this.circuit.add(apron);
    this.ribbon(track,0,track.width,.018,0x414b4b);
    for(const side of [-1,1]){
      this.ribbon(track,side*(half-.24),.13,.026,0xe5e8d7);
      if(settings.curbs){
        // Kerbs only follow a turn: the apex edge and outer exit are selected by signed curvature.

        
        
        this.ribbon(track,side*(half+CURB_WIDTH+.25),.45,.020,0x709e81,i=>Math.abs(track.samples[i].curvature)>track.features.threshold*2.6&&Math.sign(track.samples[i].curvature)===side);
      }

    }
    if(settings.curbs){const data=curbGeometry(track,(x,z)=>this.terrain.sample(x,z)),geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(data.vertices,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(data.colors,3));geo.setIndex(data.indices);geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,side:THREE.DoubleSide}));mesh.receiveShadow=true;mesh.castShadow=true;this.circuit.add(mesh);}
    // Checkered grid and a real start gantry aligned to the first track tangent.
    const start=track.samples[0],yaw=Math.atan2(-start.tx,-start.tz),grid=new THREE.Group();grid.position.set(start.x,this.terrain.sample(start.x,start.z)+bridgeHeight(track,0)+.03,start.z);grid.rotation.y=yaw;this.circuit.add(grid);
    for(let row=0;row<3;row++)for(let col=0;col<Math.ceil(track.width/.62);col++)this.box(grid,-half+.31+col*.62,.005,(row-1)*.62,.62,.012,.62,(row+col)%2===0?0xf4f1e1:0x263738);
    for(let k=1;k<=5;k++){this.box(grid,-track.width*.23,.012,k*4.1,.09,.015,1.7,0xc4c9b7);this.box(grid,track.width*.23,.012,k*4.1+2,.09,.015,1.7,0xc4c9b7);}
    for(const side of [-1,1])this.box(grid,(half+1.4)*side,2.8,0,.25,5.6,.25,0x263d3e);
    this.box(grid,0,5.45,0,track.width+3.4,1.25,.45,0x253c3d);
    const sign=this.sign('APEX  /  KART CLUB',track.width+2.9,.83);sign.position.set(0,5.48,.25);grid.add(sign);
    const back=this.sign('APEX  /  KART CLUB',track.width+2.9,.83);back.position.set(0,5.48,-.25);back.rotation.y=Math.PI;grid.add(back);
    for(let i=0;i<5;i++){const lamp=new THREE.Mesh(new THREE.SphereGeometry(.11,8,8),new THREE.MeshStandardMaterial({color:0xc5ef4e,emissive:0x486612,emissiveIntensity:.5}));lamp.position.set((i-2)*.44,4.68,0);grid.add(lamp);}
    for(const bridge of track.bridges){const s=track.samples[bridge.index],height=bridge.height;for(const side of [-1,1]){const x=s.x+s.nx*(half+.4)*side,z=s.z+s.nz*(half+.4)*side;this.box(this.circuit,x,this.terrain.sample(x,z)+height/2,z,.35,height,.35,0x73877c);}}
    this.addScenery();this.addBrakeBoards();this.skidCount=0;this.skidCursor=0;this.skidMarks.geometry.setDrawRange(0,0);this.previousSkid=[null,null];this.renderer.shadowMap.needsUpdate=true;this.frameTrack();
  }
  private addBrakeBoards(){
    const track=this.track,n=track.samples.length,step=track.length/n,placed:THREE.Vector3[]=[];
    for(const corner of track.features.corners){
      const distances=track.length>2200?[150,100,50]:[75,50,25];
      for(const metres of distances){
        if(corner.approach<metres+8)continue;
        const index=(corner.start-Math.round(metres/step)+n)%n,s=track.samples[index],offset=track.width/2+CURB_WIDTH+2;
        const x=s.x+s.nx*offset*corner.side,z=s.z+s.nz*offset*corner.side,y=this.terrain.sample(x,z)+bridgeHeight(track,index);
        const p=new THREE.Vector3(x,y,z);if(placed.some(v=>v.distanceTo(p)<12))continue;placed.push(p);
        const board=new THREE.Group();board.position.copy(p);board.rotation.y=Math.atan2(-s.tx,-s.tz);this.scenery.add(board);
        const canvas=document.createElement('canvas');canvas.width=192;canvas.height=256;const c=canvas.getContext('2d')!;
        c.fillStyle='#f5f3e7';c.fillRect(0,0,192,256);c.strokeStyle='#171b19';c.lineWidth=9;c.strokeRect(5,5,182,246);c.fillStyle='#131714';c.font='bold 84px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(String(metres),96,114);c.font='bold 30px Arial';c.fillText('m',96,192);
        const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
        const plate=new THREE.Mesh(new THREE.BoxGeometry(.96,1.28,.055),material(0xe6e6d9));plate.position.y=1.3;plate.castShadow=true;board.add(plate);
        for(const side of [-1,1]){const face=new THREE.Mesh(new THREE.PlaneGeometry(.94,1.26),new THREE.MeshBasicMaterial({map}));face.position.set(0,1.3,side*.03);if(side<0)face.rotation.y=Math.PI;board.add(face);}
        this.box(board,0,.38,0,.055,.76,.055,0x7e8981);
      }
    }
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
    trees.forEach((t,i)=>{const y=this.terrain.sample(t.x,t.z);dummy.position.set(t.x,y+1.7*t.scale,t.z);dummy.scale.setScalar(t.scale);dummy.rotation.set(0,0,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);dummy.position.set(t.x,y-.018,t.z);dummy.rotation.x=-Math.PI/2;dummy.updateMatrix();patches.setMatrixAt(i,dummy.matrix);});trunks.castShadow=true;patches.receiveShadow=true;this.scenery.add(trunks,patches);
    for(let variant=0;variant<3;variant++){const subset=trees.filter(t=>t.variant===variant),crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.5,1),material([0x688969,0x779575,0x4f7660][variant]),subset.length);subset.forEach((t,i)=>{dummy.position.set(t.x,this.terrain.sample(t.x,t.z)+4.9*t.scale,t.z);dummy.rotation.set(0,0,0);dummy.scale.set(t.scale,t.scale*t.stretch,t.scale);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);});crowns.castShadow=true;crowns.receiveShadow=true;this.scenery.add(crowns);}
    // Paddock, pit awnings and a viewing stand beyond the outer track boundary.
    const pitZ=b.maxZ+25;
    this.box(this.scenery,-10,-.015,pitZ,110,.04,24,0xb9bcad);
    this.box(this.scenery,-22,2.9,pitZ+5,72,5.8,10,0xdbddce);
    this.box(this.scenery,-22,5.95,pitZ+5,74,.25,12,0x2d4948);
    for(let i=0;i<7;i++){const x=-51+i*9.5;this.box(this.scenery,x,1.8,pitZ-.1,7.3,3.6,.12,0x3c5350);this.box(this.scenery,x,4.5,pitZ-1,8.6,.15,4.5,i%2?0xe9eadc:0xc5de85);}
    const pitSign=this.sign('APEX  MOTORSPORT',24,2.8);pitSign.position.set(-22,this.terrain.sample(-22,pitZ)+4.25,pitZ-.06);pitSign.rotation.y=Math.PI;this.scenery.add(pitSign);
    const viewing=new THREE.Group();viewing.position.set(b.maxX+32,this.terrain.sample(b.maxX+32,(b.minZ+b.maxZ)/2),(b.minZ+b.maxZ)/2);viewing.rotation.y=Math.PI/2;this.scenery.add(viewing);
    for(let row=0;row<5;row++)this.box(viewing,0,.5+row*.65,row*1.3,28,.6,1.1,row%2?0x708780:0xb5bfa6);
    this.box(viewing,0,5.5,2.5,30,.3,10,0x2f4944);
    for(const x of [-13,13])this.box(viewing,x,2.7,3.5,.22,5.4,.22,0x536d64);
    // Windsocks and sparse APEX flags give scale without visual clutter.
    for(const x of [-58,-45,47]){
      this.box(this.scenery,x,5.4,pitZ-14,.13,10.8,.13,0x71877c);
      const flag=new THREE.Mesh(new THREE.PlaneGeometry(2.7,4.8),new THREE.MeshStandardMaterial({color:0xc3e978,side:THREE.DoubleSide,roughness:.9}));flag.position.set(x+1.4,this.terrain.sample(x,pitZ-14)+8,pitZ-14);this.scenery.add(flag);
    }
  }
  frameTrack(){
    if(!this.track)return;const b=this.track.bounds;const center=new THREE.Vector3((b.minX+b.maxX)/2,(this.terrain.min+this.terrain.max)/2,(b.minZ+b.maxZ)/2);
    const size=Math.max(b.maxX-b.minX,(b.maxZ-b.minZ)*1.35);const aspect=Math.max(.4,this.camera.aspect),scale=Math.max(1,1.1/aspect);
    this.orbit.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(size*.57*scale,size*.90*scale,size*.94*scale));this.camera.lookAt(center);this.orbit.update();
    const fog=this.scene.fog as THREE.Fog,range=this.camera.position.distanceTo(center);fog.near=Math.max(450,range*.95);fog.far=Math.max(1000,range*2.5);this.camera.near=Math.max(1,range/2000);this.camera.far=Math.max(1400,range*4);this.camera.updateProjectionMatrix();
  }
  setCamera(mode:CameraMode){this.mode=mode;this.kart.head.visible=mode!=='cockpit';document.body.classList.toggle('cockpit-view',mode==='cockpit');this.camera.near=mode==='cockpit'?.025:1;this.camera.fov=45;this.camera.updateProjectionMatrix();this.orbit.enabled=mode==='orbit';if(mode==='orbit')this.frameTrack();else{const fog=this.scene.fog as THREE.Fog;fog.near=400;fog.far=950;if(mode==='chase'){const b=this.physics.body,p=new THREE.Vector3(b.position.x,b.position.y+this.physics.visualOffset,b.position.z),q=new THREE.Quaternion(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w);this.camera.position.copy(new THREE.Vector3().fromArray(this.physics.profile.chase).applyQuaternion(q).add(p));this.camera.lookAt(new THREE.Vector3(0,.7,-4.5).applyQuaternion(q).add(p));}}}
  setColor(color:string){this.kart.paint.color.set(color);}
  update(dt:number,running:boolean){
    this.time+=dt;
    const body=this.physics.body;this.kart.root.quaternion.copy(body.quaternion as any);this.target.set(0,this.physics.visualOffset,0).applyQuaternion(this.kart.root.quaternion);this.kart.root.position.copy(body.position as any).add(this.target);
    this.kart.steering.rotation.z=this.physics.telemetry.steering*this.physics.profile.steeringRatio;
    this.kart.updateDashboard?.(this.physics.telemetry.gear??0,this.physics.telemetry.rpm);
    this.kart.wheelMeshes.forEach((w,i)=>{const t=this.physics.vehicle.wheelInfos[i].worldTransform;w.position.copy(t.position as any);w.quaternion.copy(t.quaternion as any);});
    if(this.mode==='orbit')this.orbit.update();
    else{
      const q=this.kart.root.quaternion,p=this.kart.root.position;
      if(this.mode==='chase'){
        this.desired.fromArray(this.physics.profile.chase).applyQuaternion(q).add(p);this.target.set(0,.7,-4.5).applyQuaternion(q).add(p);
        this.camera.position.lerp(this.desired,1-Math.exp(-dt*4.5));this.camera.lookAt(this.target);this.camera.fov=53+Math.min(this.physics.telemetry.speed/12,7);
      }else if(this.mode==='cockpit'){
        // Eye height, downward gaze and a wide lower field keep the real
        // steering wheel, hands and both front tyres visible in the scene.
        const spec=this.physics.profile;
        this.desired.fromArray(spec.cockpitEye).applyQuaternion(q).add(p);this.target.fromArray(spec.cockpitGaze).applyQuaternion(q).add(p);
        this.camera.position.copy(this.desired);this.camera.lookAt(this.target);this.camera.fov=Math.max(spec.cockpitFov,Math.min(108,THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(42))/this.camera.aspect))));
      }else{
        this.desired.copy(p).add(new THREE.Vector3(.01,85,30));this.camera.position.lerp(this.desired,1-Math.exp(-dt*4));this.camera.lookAt(p);this.camera.fov=48;
      }
      this.camera.updateProjectionMatrix();
    }
    if(running&&this.physics.telemetry.speed>12){
      let changed=false;
      for(let j=0;j<2;j++){
        const w=this.physics.vehicle.wheelInfos[j+2];
        if(w.isInContact&&(this.physics.input.handbrake||w.skidInfo<.7)&&!this.physics.telemetry.offroad){
          const hit=w.raycastResult.hitPointWorld,center=new THREE.Vector3(hit.x,hit.y+.035,hit.z),normal=new THREE.Vector3().copy(w.raycastResult.hitNormalWorld as any);
          if(normal.lengthSq()<.5)normal.set(0,1,0);else normal.normalize();
          const q=w.worldTransform.quaternion,side=new THREE.Vector3(1,0,0).applyQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w));
          side.addScaledVector(normal,-side.dot(normal)).normalize().multiplyScalar(this.physics.profile.rearTyreWidth*.675);
          const left=center.clone().add(side),right=center.clone().sub(side),previous=this.previousSkid[j];
          if(previous){const distance=previous.center.distanceTo(center);if(distance<.02)continue;if(distance<Math.max(2,this.physics.telemetry.speed/3.6*dt*1.8)){
            const offset=this.skidCursor*18;this.skidPositions.set([...previous.left.toArray(),...previous.right.toArray(),...left.toArray(),...previous.right.toArray(),...right.toArray(),...left.toArray()],offset);
            (this.skidMarks.geometry.getAttribute('position') as THREE.BufferAttribute).addUpdateRange(offset,18);this.skidCursor=(this.skidCursor+1)%4096;this.skidCount=Math.min(4096,this.skidCount+1);changed=true;
          }}
          this.previousSkid[j]={center,left,right};
        }else this.previousSkid[j]=null;
      }
      if(changed){this.skidMarks.geometry.getAttribute('position').needsUpdate=true;this.skidMarks.geometry.setDrawRange(0,this.skidCount*6);}
    }else this.previousSkid=[null,null];
    if(running||this.time<2)this.renderer.shadowMap.needsUpdate=true;
    this.renderer.render(this.scene,this.camera);
  }
}
