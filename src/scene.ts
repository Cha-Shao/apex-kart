import * as THREE from 'three';
import {Vec3} from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeKart } from './kart';
import { makeRB20 } from './rb20';
import { KartPhysics } from './physics';
import { bridgeHeight, curbGeometry, runoffGeometry, CURB_WIDTH, TRACK_SURFACE_HEIGHT, nearestOnTrack, type TrackData, type TrackSettings } from './track';
import { TerrainField } from './terrain';
import { TyreSmoke } from './tyre-smoke';
import { SceneAssets, surfaceUVs, disposeSceneGroup } from './scene-assets';
import {surfaceTrack,terrainNormals} from './surface-track';
import {drapeTriangles} from './terrain-mesh';
import {tyreGeometry} from './surface-materials';
import {ContactShadow} from './contact-shadow';
import {vegetationLayout,addTrackEnvironment,type DetailLayer} from './track-environment';
import {START_LIGHT_COUNT} from './start-signal';
import {startGridSlots} from './start-grid';

export type CameraMode='orbit'|'chase'|'top'|'cockpit';
const material=(color:number,roughness=.9)=>new THREE.MeshStandardMaterial({color,roughness});
const SURFACE_ORDER={depth:10,runoff:20,kerb:30,white:40,asphalt:50,start:60} as const;
const ENVIRONMENT_FOG_DENSITY=.00076;
export class GameScene {
  renderer:THREE.WebGLRenderer;
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,1,1,1400);
  orbit:OrbitControls;
  kart:Omit<ReturnType<typeof makeKart>,'body'>&{body?:THREE.Group;updateDashboard?:(gear:number,rpm:number)=>void};
  assets:SceneAssets;
  circuit=new THREE.Group();
  scenery=new THREE.Group();
  landscape=new THREE.Group();
  terrain=new TerrainField();
  physics:KartPhysics;
  track!:TrackData;
  mode:CameraMode='orbit';
  tyreSquealLeft=0;
  tyreSquealRight=0;
  private slipDuration=[0,0];
  private slipAxle=new Vec3();
  private slipVelocity=new Vec3();
  private slipGroundVelocity=new Vec3();
  private target=new THREE.Vector3();
  private desired=new THREE.Vector3();
  private resizeObserver:ResizeObserver;
  private skidPositions=new Float32Array(4096*18);
  private skidCount=0;
  private skidCursor=0;
  private skidMarks:THREE.Mesh;
  private tyreSmoke=new TyreSmoke();
  private previousSkid:({center:THREE.Vector3;left:THREE.Vector3;right:THREE.Vector3}|null)[]=[null,null];
  private time=0;
  private floor:THREE.Mesh;
  private sun=new THREE.DirectionalLight(0xfff3df,3.4);
  private sunCenter=new THREE.Vector3();
  private shadowCenter=new THREE.Vector3(Infinity,Infinity,Infinity);
  private shadowExtent=0;
  private treeLODs:THREE.LOD[]=[];
  private detailLayers:DetailLayer[]=[];
  private contactShadow=new ContactShadow();
  private surfaceDepthMaterial=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,depthTest:true});
  private startLightMaterials:THREE.MeshStandardMaterial[]=[];
  onContextLost=()=>{};
  constructor(public container:HTMLElement,physics:KartPhysics){
    this.physics=physics;
    this.kart=physics.profile.id==='rb20'?makeRB20():makeKart();
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate=false;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.92;
    container.append(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','3D 卡丁车赛道。拖动旋转视角，滚轮缩放。');
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.onContextLost();});
    this.scene.background=new THREE.Color(0xb9d7ed);this.scene.fog=new THREE.FogExp2(0xbfcfd5,ENVIRONMENT_FOG_DENSITY);
    // Open-sky diffuse light and ground bounce must remain visible on faces
    // opposite the sun. A small neutral fill keeps deep shade from crushing.
    const hemi=new THREE.HemisphereLight(0xd9e8ff,0x8d927c,.85);hemi.name='daylight-sky-and-ground-bounce';
    const ambient=new THREE.AmbientLight(0xe1e8ee,.12);ambient.name='daylight-ambient-fill';this.scene.add(hemi,ambient);
    const sun=this.sun;sun.name='HDR-aligned-direct-sun';sun.position.set(-500,780,350);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-225,right:225,top:225,bottom:-225,near:1,far:1800});sun.shadow.normalBias=.018;sun.shadow.bias=-.00006;sun.shadow.radius=2;this.scene.add(sun,sun.target);
    this.assets=new SceneAssets(this.renderer,this.scene,()=>{this.renderer.shadowMap.needsUpdate=true;});
    this.surfaceDepthMaterial.userData.sharedCC0=true;
    const floorGeometry=new THREE.PlaneGeometry(200000,200000);floorGeometry.setAttribute('color',new THREE.Float32BufferAttribute(new Array(12).fill(1),3));const uv=floorGeometry.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*100000,uv.getY(i)*100000);
    const floor=new THREE.Mesh(floorGeometry,this.assets.grass);floor.rotation.x=-Math.PI/2;floor.position.y=-70.055;floor.receiveShadow=true;this.scene.add(floor);this.floor=floor;
    this.scene.add(this.landscape,this.circuit,this.scenery,this.kart.root,...this.kart.wheelMeshes);
    const skidGeometry=new THREE.BufferGeometry();skidGeometry.setAttribute('position',new THREE.BufferAttribute(this.skidPositions,3).setUsage(THREE.DynamicDrawUsage));skidGeometry.setDrawRange(0,0);
    this.skidMarks=new THREE.Mesh(skidGeometry,new THREE.MeshBasicMaterial({color:0x101512,transparent:true,opacity:.65,side:THREE.DoubleSide,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));this.skidMarks.name='ground-tyre-marks';this.skidMarks.renderOrder=3;this.skidMarks.frustumCulled=false;this.scene.add(this.skidMarks);
    this.scene.add(this.tyreSmoke.mesh);
    this.scene.add(this.contactShadow.mesh);
    this.camera.position.set(260,290,340);this.orbit=new OrbitControls(this.camera,this.renderer.domElement);this.orbit.enableDamping=true;this.orbit.dampingFactor=.065;this.orbit.maxPolarAngle=Math.PI/2-.08;this.orbit.minDistance=5;this.orbit.maxDistance=100000;this.orbit.target.set(0,0,-8);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
    this.applyVehicleMaterials();
    void this.assets.ready.then(()=>{this.replaceKartModel();if(this.track){this.clearGroup(this.scenery);this.addScenery();this.addBrakeBoards();}this.shadowCenter.set(Infinity,Infinity,Infinity);this.renderer.shadowMap.needsUpdate=true;});
  }
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(w<1||h<1)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();if(this.track&&this.mode==='orbit')this.frameTrack();}
  setVehicle(){
    this.tyreSmoke.clear();this.slipDuration=[0,0];
    for(const group of [this.kart.root,...this.kart.wheelMeshes]){this.scene.remove(group);this.clearGroup(group);}
    this.kart=this.physics.profile.id==='rb20'?makeRB20():makeKart();this.scene.add(this.kart.root,...this.kart.wheelMeshes);
    this.applyVehicleMaterials();this.replaceKartModel();
    this.skidCount=0;this.skidCursor=0;this.skidMarks.geometry.setDrawRange(0,0);this.previousSkid=[null,null];this.setCamera(this.mode);this.renderer.shadowMap.needsUpdate=true;
  }
  private clearGroup(group:THREE.Group){disposeSceneGroup(group);}
  private applyVehicleMaterials(){
    const replacements:Record<string,THREE.MeshStandardMaterial>={'vehicle-carbon':this.assets.carbon,'vehicle-rubber':this.assets.rubber,'vehicle-tyre':this.assets.tyre,'vehicle-alloy':this.assets.alloy,'vehicle-fabric':this.assets.fabric,'kart-paint':this.assets.paint,'kart-rubber':this.assets.tyre,'kart-alloy':this.assets.alloy,'kart-trim':this.assets.carbon};
    const old=new Set<THREE.Material>();
    for(const group of [this.kart.root,...this.kart.wheelMeshes])group.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const replace=(material:THREE.Material)=>{const replacement=replacements[material.name];if(replacement&&replacement!==material){old.add(material);return replacement;}return material;};
      object.material=Array.isArray(object.material)?object.material.map(replace):replace(object.material);
    });
    old.forEach(material=>{if(!material.userData.sharedCC0)material.dispose();});
  }
  private replaceKartModel(){
    if(this.physics.profile.id!=='kart'||!this.kart.body||this.kart.body.userData.cc0)return;
    const source=this.assets.models.get('kart-oopi');if(!source)return;
    const imported=source.getObjectByName('kart-oopi')?.clone(true);if(!imported)return;
    const remove:THREE.Object3D[]=[];imported.traverse(o=>{if(o.name.startsWith('wheel')||o.name==='character')remove.push(o);});remove.forEach(o=>o.removeFromParent());
    const spec=this.physics.profile;
    imported.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      object.geometry=object.geometry.clone();object.geometry.userData.sharedCC0=false;
      const p=object.geometry.getAttribute('position');
      // Fit axle locations independently of the donor's cartoon overhangs.
      // The physics, wheelbase and cockpit stay in the game's metre specification.
      for(let i=0;i<p.count;i++){
        const z=p.getZ(i),front=.323733032,rear=-.3606073;
        const fitted=z>front?spec.frontZ-(z-front)*.42:z<rear?spec.rearZ+(rear-z)*.5:spec.rearZ+(z-rear)/(front-rear)*(spec.frontZ-spec.rearZ);
        p.setXYZ(i,-p.getX(i)*1.3,p.getY(i)*.7-.137,fitted);
      }
      p.needsUpdate=true;object.geometry.computeVertexNormals();object.geometry.computeBoundingBox();object.geometry.computeBoundingSphere();
    });
    this.clearGroup(this.kart.body);this.kart.body.add(imported);this.kart.body.scale.set(1/this.kart.root.scale.x,1/this.kart.root.scale.y,1/this.kart.root.scale.z);this.kart.body.userData.cc0=true;
    this.assets.paint.color.copy(this.kart.paint.color);this.kart.paint=this.assets.paint;
    const names=['wheel-front-left','wheel-front-right','wheel-back-left','wheel-back-right'];
    for(let i=0;i<4;i++){
      const wheel=source.getObjectByName(names[i])?.clone(true);if(!wheel)continue;
      wheel.position.set(0,0,0);wheel.rotation.set(0,Math.PI,0);
      wheel.scale.set((i<2?spec.frontTyreWidth:spec.rearTyreWidth)/.20977735,spec.wheelRadius/.20977734,spec.wheelRadius/.20977734);
      wheel.traverse(object=>{if(object instanceof THREE.Mesh){const tyre=!Array.isArray(object.material)&&object.material.name==='kart-rubber';object.geometry=tyre?tyreGeometry(.20977734,.20977735):object.geometry.clone();object.geometry.userData.sharedCC0=false;if(!tyre)object.geometry.translate(i%2===0?-.10488868:.10488868,0,0);}});
      this.clearGroup(this.kart.wheelMeshes[i]);this.kart.wheelMeshes[i].scale.setScalar(1);this.kart.wheelMeshes[i].add(wheel);
    }
    this.applyVehicleMaterials();this.renderer.shadowMap.needsUpdate=true;
  }
  private updateSun(){
    const center=this.mode==='orbit'?this.orbit.target:this.kart.root.position;
    const b=this.track?.bounds,extent=this.mode==='orbit'&&b?Math.min(900,Math.max(90,(b.maxX-b.minX)*.57,(b.maxZ-b.minZ)*.57),Math.max(28,this.camera.position.distanceTo(this.orbit.target)*.85)):48;
    // Stabilize the shadow texels while following the car.
    const texel=extent*2/2048;this.sunCenter.set(Math.round(center.x/texel)*texel,Math.round(center.y/texel)*texel,Math.round(center.z/texel)*texel);
    if(this.shadowCenter.distanceToSquared(this.sunCenter)<texel*texel&&this.shadowExtent===extent)return;
    this.shadowCenter.copy(this.sunCenter);this.shadowExtent=extent;
    this.sun.target.position.copy(this.sunCenter);this.sun.position.copy(this.sunCenter).addScaledVector(this.assets.sunDirection,900);
    const camera=this.sun.shadow.camera;Object.assign(camera,{left:-extent,right:extent,top:extent,bottom:-extent});camera.updateProjectionMatrix();this.renderer.shadowMap.needsUpdate=true;
  }
  private addSurface(mesh:THREE.Mesh,order:number,name:string){
    // A physical depth pass keeps cars, terrain and overpasses occluding the
    // surface normally. Colour passes can then resolve coplanar overlap in
    // explicit priority order without fighting each other's depth writes.
    const depth=new THREE.Mesh(mesh.geometry,this.surfaceDepthMaterial);depth.name=`${name}-depth`;depth.renderOrder=SURFACE_ORDER.depth;
    depth.position.copy(mesh.position);depth.quaternion.copy(mesh.quaternion);depth.scale.copy(mesh.scale);
    for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){m.depthWrite=false;m.depthTest=true;m.polygonOffset=true;m.polygonOffsetFactor=-1;m.polygonOffsetUnits=-2;}
    mesh.name=name;mesh.renderOrder=order;mesh.receiveShadow=true;this.circuit.add(depth,mesh);return mesh;
  }
  private ribbon(track:TrackData,offset:number,width:number,color:number,road=false){
    const positions:number[]=[],indices:number[]=[],roadUvs:number[]=[],n=track.samples.length;
    for(let i=0;i<n;i++){const j=(i+1)%n,a=track.samples[i],b=track.samples[j],points=[];
      for(const [s,o] of [[a,offset-width/2],[a,offset+width/2],[b,offset-width/2],[b,offset+width/2]] as const)points.push({x:s.x+s.nx*o,z:s.z+s.nz*o});
      const [p,q,r,s]=points,dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz,h0=bridgeHeight(track,i),h1=bridgeHeight(track,j);
      const data=drapeTriangles([[p,q,r],[q,s,r]],(x,z)=>{const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(length2||1)));return this.terrain.sample(x,z)+h0+(h1-h0)*t+TRACK_SURFACE_HEIGHT;},this.terrain),base=positions.length/3;
      for(const v of data.vertices)positions.push(v);for(const index of data.indices)indices.push(base+index);
      if(road)for(let k=0;k<data.vertices.length;k+=3){const x=data.vertices[k],z=data.vertices[k+2],t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(length2||1))),nx=a.nx+(b.nx-a.nx)*t,nz=a.nz+(b.nz-a.nz)*t,lateral=(x-a.x-dx*t)*nx+(z-a.z-dz*t)*nz;roadUvs.push(a.distance+(j===0?track.length-a.distance:b.distance-a.distance)*t,lateral);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();if(!track.bridges.length)terrainNormals(geo,this.terrain);
    const surfaceMaterial=road?this.assets.asphalt:material(color);if(road){surfaceUVs(geo,2.1);geo.setAttribute('roadUv',new THREE.Float32BufferAttribute(roadUvs,2));}
    return this.addSurface(new THREE.Mesh(geo,surfaceMaterial),road?SURFACE_ORDER.asphalt:SURFACE_ORDER.white,road?'track-asphalt':'track-white-line');
  }
  private box(group:THREE.Group,x:number,y:number,z:number,w:number,h:number,d:number,color:number){
    const geometry=new THREE.BoxGeometry(w,h,d),p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
    const surface=w>30&&h>1?this.assets.concrete:w>25&&h<.4?d>15?this.assets.concrete:this.assets.roof:material(color);
    if(surface===this.assets.concrete||surface===this.assets.roof)for(let i=0;i<p.count;i++)uv.setXY(i,(Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))/2,(Math.abs(n.getY(i))>.5?p.getZ(i):p.getY(i))/2);
    const mesh=new THREE.Mesh(geometry,surface);mesh.position.set(x,y+(group===this.scenery?this.terrain.sample(x,z):0),z);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
  }
  private addStartMarkings(track:TrackData){
    const positions:number[]=[],indices:number[]=[],n=track.samples.length,step=track.length/n;
    // Paint follows the road's own segments and terrain triangles, including
    // the branch behind the start line when a circuit crosses itself.
    const stripe=(from:number,to:number,left:number,right:number)=>{
      for(let segment=Math.floor(from/step);segment<Math.ceil(to/step);segment++){
        const i=(segment%n+n)%n,j=(i+1)%n,a=track.samples[i],b=track.samples[j],dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;
        const t0=(Math.max(from,segment*step)-segment*step)/step,t1=(Math.min(to,(segment+1)*step)-segment*step)/step;
        if(t1-t0<1e-8)continue;
        const point=(t:number,offset:number)=>({x:a.x+dx*t+(a.nx+(b.nx-a.nx)*t)*offset,z:a.z+dz*t+(a.nz+(b.nz-a.nz)*t)*offset});
        const p=point(t0,left),q=point(t0,right),r=point(t1,left),s=point(t1,right),h0=bridgeHeight(track,i),h1=bridgeHeight(track,j);
        const data=drapeTriangles([[p,q,r],[q,s,r]],(x,z)=>{const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(length2||1)));return this.terrain.sample(x,z)+h0+(h1-h0)*t+TRACK_SURFACE_HEIGHT;},this.terrain),base=positions.length/3;
        for(const v of data.vertices)positions.push(v);for(const index of data.indices)indices.push(base+index);
      }
    };
    stripe(-.14,.14,-track.width/2+.42,track.width/2-.42);
    const line=.11;
    for(const {front,back,left,right} of startGridSlots(track.width)){
      stripe(front-line,front,left,right);
      stripe(back,front-line,left,left+line);stripe(back,front-line,right-line,right);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();if(!track.bridges.length)terrainNormals(geometry,this.terrain);
    // A colour overlay on the asphalt, with normal depth occlusion and no
    // raised geometry, collision bodies or shadows from painted markings.
    this.addSurface(new THREE.Mesh(geometry,material(0xf2f1e6)),SURFACE_ORDER.start,'start-grid-paint');
  }
  setStartLights(litCount:number){
    this.startLightMaterials.forEach((lamp,i)=>{const lit=i<litCount;lamp.color.setHex(lit?0xff493d:0x321b19);lamp.emissive.setHex(lit?0xff1c0c:0x000000);lamp.emissiveIntensity=lit?2.4:0;});
  }
  private makeLandscape(){
    this.clearGroup(this.landscape);const f=this.terrain,n=f.resolution,positions:number[]=[],colors:number[]=[],indices:number[]=[],base=new THREE.Color(0xffffff),high=new THREE.Color(0xe6dfc9),low=new THREE.Color(0xdce7cc);
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){const h=f.heights[z*n+x],wx=f.originX+x*f.cellSize,wz=f.originZ+z*f.cellSize,color=base.clone().lerp(h>=0?high:low,Math.min(.55,Math.abs(h)/70));color.multiplyScalar(.9+.1*Math.sin(wx*.025)*Math.cos(wz*.019));positions.push(wx,h-.025,wz);colors.push(color.r,color.g,color.b);if(x<n-1&&z<n-1){const a=z*n+x,b=a+1,c=a+n,d=c+1;indices.push(a,c,d,a,d,b);}}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();surfaceUVs(geo,2);const mesh=new THREE.Mesh(geo,this.assets.grass);mesh.receiveShadow=true;this.landscape.add(mesh);
  }
  private sign(text:string,w:number,h:number,bg='#1c3031',fg='#d1ef70'){
    const c=document.createElement('canvas');c.width=1024;c.height=192;const ctx=c.getContext('2d')!;ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='italic 900 116px Arial';ctx.fillText(text,c.width/2,c.height*.53);const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map}));
  }
  setTrack(track:TrackData,_settings:TrackSettings,terrain:TerrainField=new TerrainField(),reframe=true){
    this.tyreSmoke.clear();this.slipDuration=[0,0];
    this.track=track;this.terrain=terrain.refined().clone();this.makeLandscape();this.clearGroup(this.circuit);this.clearGroup(this.scenery);this.startLightMaterials=[];const rendered=surfaceTrack(track);
    this.assets.setRoadWear(track);
    this.floor.position.y=this.terrain.min-50.055;
    const half=track.width/2;
    const runoff=runoffGeometry(rendered,(x,z)=>this.terrain.sample(x,z),this.terrain),runoffGeo=new THREE.BufferGeometry();runoffGeo.setAttribute('position',new THREE.Float32BufferAttribute(runoff.vertices,3));runoffGeo.setIndex(runoff.indices);runoffGeo.computeVertexNormals();if(!track.bridges.length)terrainNormals(runoffGeo,this.terrain);surfaceUVs(runoffGeo,2.1);this.addSurface(new THREE.Mesh(runoffGeo,this.assets.runoff),SURFACE_ORDER.runoff,'track-runoff');
    // Asphalt has top priority, with exact slots for its own white lines. A
    // different road section can therefore cover a conflicting line or kerb.
    const lineWidth=.13,lineOffset=half-.24,lineInner=lineOffset-lineWidth*.5,lineOuter=lineOffset+lineWidth*.5,edgeWidth=half-lineOuter;
    this.ribbon(rendered,0,lineInner*2,0x414b4b,true);
    for(const side of [-1,1]){
      this.ribbon(rendered,side*(lineOuter+edgeWidth*.5),edgeWidth,0x414b4b,true);
      this.ribbon(rendered,side*lineOffset,lineWidth,0xe5e8d7);
    }
    const data=curbGeometry(rendered,(x,z)=>this.terrain.sample(x,z),this.terrain),geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(data.vertices,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(data.colors,3));geo.setAttribute('kerbUv',new THREE.Float32BufferAttribute(data.kerbUvs,2));geo.setAttribute('kerbTraffic',new THREE.Float32BufferAttribute(data.kerbTraffic,1));geo.setIndex(data.indices);geo.computeVertexNormals();if(!track.bridges.length)terrainNormals(geo,this.terrain);surfaceUVs(geo,1.2);this.addSurface(new THREE.Mesh(geo,this.assets.kerb),SURFACE_ORDER.kerb,'textured-kerbs');
    // White surface paint and an APEX gantry aligned to the start tangent.
    this.addStartMarkings(rendered);
    const start=track.samples[0],yaw=Math.atan2(-start.tx,-start.tz),grid=new THREE.Group();grid.position.set(start.x,this.terrain.sample(start.x,start.z)+bridgeHeight(track,0)+.03,start.z);grid.rotation.y=yaw;this.circuit.add(grid);
    for(const side of [-1,1])this.box(grid,(half+1.4)*side,2.8,0,.25,5.6,.25,0x263d3e);
    this.box(grid,0,5.45,0,track.width+3.4,1.25,.45,0x253c3d);
    const sign=this.sign('APEX  /  KART CLUB',track.width+2.9,.83);sign.position.set(0,5.48,.25);grid.add(sign);
    const back=this.sign('APEX  /  KART CLUB',track.width+2.9,.83);back.position.set(0,5.48,-.25);back.rotation.y=Math.PI;grid.add(back);
    // Four round lamps in one rail, shared with the HUD signal.
    this.box(grid,0,4.58,0,3.48,.6,.38,0x152326);
    for(let i=0;i<START_LIGHT_COUNT;i++){
      const lens=new THREE.MeshStandardMaterial({color:0x321b19,roughness:.38,emissiveIntensity:0});
      const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.4,24),lens);lamp.rotation.x=Math.PI/2;lamp.position.set((i-(START_LIGHT_COUNT-1)/2)*.78,4.58,0);grid.add(lamp);this.startLightMaterials.push(lens);
    }
    for(const bridge of track.bridges){const s=track.samples[bridge.index],height=bridge.height;for(const side of [-1,1]){const x=s.x+s.nx*(half+.4)*side,z=s.z+s.nz*(half+.4)*side;this.box(this.circuit,x,this.terrain.sample(x,z)+height/2,z,.35,height,.35,0x73877c);}}
    this.addScenery();this.addBrakeBoards();this.skidCount=0;this.skidCursor=0;this.skidMarks.geometry.setDrawRange(0,0);this.previousSkid=[null,null];this.renderer.shadowMap.needsUpdate=true;if(reframe)this.frameTrack();
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
    this.treeLODs=[];this.detailLayers=[];
    const b=this.track.bounds;
    const {trees,shrubs}=vegetationLayout(this.track);
    const dummy=new THREE.Object3D();
    const treeModels=['tree_small_02','pine_sapling_small'];
    if(treeModels.every(name=>this.assets.models.has(name)&&this.assets.models.has(`${name}-far`))){
      for(let variant=0;variant<2;variant++){
        const subset=trees.filter(t=>t.variant%2===variant),cells=new Map<string,typeof trees>();
        for(const tree of subset){const key=`${Math.floor(tree.x/90)},${Math.floor(tree.z/90)}`;const cell=cells.get(key)??[];cell.push(tree);cells.set(key,cell);}
        for(const cell of cells.values()){
        const lod=new THREE.LOD(),cx=cell.reduce((sum,t)=>sum+t.x,0)/cell.length,cz=cell.reduce((sum,t)=>sum+t.z,0)/cell.length;lod.position.set(cx,this.terrain.sample(cx,cz),cz);lod.autoUpdate=false;this.treeLODs.push(lod);this.scenery.add(lod);
        for(const [level,suffix] of ['','-far'].entries()){
        const model=this.assets.models.get(`${treeModels[variant]}${suffix}`)!,batch=new THREE.Group();model.updateMatrixWorld(true);
        model.traverse(source=>{
          if(!(source instanceof THREE.Mesh))return;
          const instances=new THREE.InstancedMesh(source.geometry,source.material,cell.length);instances.name=`CC0 ${treeModels[variant]}${suffix}`;
          cell.forEach((t,i)=>{const scale=t.scale*(variant===0?1.8:2.4);dummy.position.set(t.x-cx,this.terrain.sample(t.x,t.z)-lod.position.y-.04,t.z-cz);dummy.rotation.set(0,t.x*13.7,0);dummy.scale.set(scale,scale*t.stretch,scale);dummy.updateMatrix();instances.setMatrixAt(i,new THREE.Matrix4().multiplyMatrices(dummy.matrix,source.matrixWorld));});
          instances.castShadow=level===0;instances.receiveShadow=true;instances.computeBoundingSphere();batch.add(instances);
        });
        lod.addLevel(batch,level===0?0:115,.15);
        }
        }
      }
    }else{
    const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.35,.5,3.4,7),material(0x6b6c52),trees.length),patches=new THREE.InstancedMesh(new THREE.CircleGeometry(4.8,20),material(0x8fa483),trees.length);
    trees.forEach((t,i)=>{const y=this.terrain.sample(t.x,t.z);dummy.position.set(t.x,y+1.7*t.scale,t.z);dummy.scale.setScalar(t.scale);dummy.rotation.set(0,0,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);dummy.position.set(t.x,y-.018,t.z);dummy.rotation.x=-Math.PI/2;dummy.updateMatrix();patches.setMatrixAt(i,dummy.matrix);});trunks.castShadow=true;patches.receiveShadow=true;this.scenery.add(trunks,patches);
    for(let variant=0;variant<3;variant++){const subset=trees.filter(t=>t.variant===variant),crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.5,1),material([0x688969,0x779575,0x4f7660][variant]),subset.length);subset.forEach((t,i)=>{dummy.position.set(t.x,this.terrain.sample(t.x,t.z)+4.9*t.scale,t.z);dummy.rotation.set(0,0,0);dummy.scale.set(t.scale,t.scale*t.stretch,t.scale);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);});crowns.castShadow=true;crowns.receiveShadow=true;this.scenery.add(crowns);}
    }
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
    // CC0 service vehicles and cones stay in the paddock, outside the racing surface.
    for(const [name,x,z,scale] of [['sedan-sports',-42,pitZ+17,1.8],['sedan-sports',-30,pitZ+17,1.8],['truck',12,pitZ+16,2.1],['cone',-55,pitZ-5,1.2],['cone',-43,pitZ-5,1.2],['cone',-31,pitZ-5,1.2],['cone',-19,pitZ-5,1.2]] as const){
      if(nearestOnTrack(this.track,{x,z}).distance<this.track.width/2+5)continue;
      const prop=this.assets.clone(name);if(!prop)continue;prop.name=`CC0 ${name}`;prop.position.set(x,this.terrain.sample(x,z)+.035,z);prop.scale.setScalar(scale);prop.rotation.y=name==='truck'?Math.PI/2:Math.PI;this.scenery.add(prop);
    }
    this.detailLayers=addTrackEnvironment(this.scenery,this.track,this.terrain,this.assets,shrubs);
  }
  frameTrack(){
    if(!this.track)return;const b=this.track.bounds;const center=new THREE.Vector3((b.minX+b.maxX)/2,(this.terrain.min+this.terrain.max)/2,(b.minZ+b.maxZ)/2);
    const size=Math.max(b.maxX-b.minX,(b.maxZ-b.minZ)*1.35);const aspect=Math.max(.4,this.camera.aspect),scale=Math.max(1,1.1/aspect);
    this.orbit.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(size*.57*scale,size*.90*scale,size*.94*scale));this.camera.lookAt(center);this.orbit.update();
    const fog=this.scene.fog as THREE.FogExp2,range=this.camera.position.distanceTo(center);fog.density=Math.min(ENVIRONMENT_FOG_DENSITY,1/Math.max(1,range));this.camera.near=Math.max(1,range/2000);this.camera.far=Math.max(1400,range*4);this.camera.updateProjectionMatrix();
  }
  setCamera(mode:CameraMode){this.mode=mode;this.kart.head.visible=mode!=='cockpit';document.body.classList.toggle('cockpit-view',mode==='cockpit');this.camera.near=mode==='cockpit'?.025:1;this.camera.fov=45;this.camera.updateProjectionMatrix();this.orbit.enabled=mode==='orbit';if(mode==='orbit')this.frameTrack();else{const fog=this.scene.fog as THREE.FogExp2;fog.density=ENVIRONMENT_FOG_DENSITY;if(mode==='chase'){const b=this.physics.body,p=new THREE.Vector3(b.position.x,b.position.y+this.physics.visualOffset,b.position.z),q=new THREE.Quaternion(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w);this.camera.position.copy(new THREE.Vector3().fromArray(this.physics.profile.chase).applyQuaternion(q).add(p));this.camera.lookAt(new THREE.Vector3(0,.7,-4.5).applyQuaternion(q).add(p));}}}
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
    this.tyreSquealLeft=0;this.tyreSquealRight=0;
    if(running&&this.physics.telemetry.speed>12){
      let changed=false;
      for(let j=0;j<2;j++){
        const w=this.physics.vehicle.wheelInfos[j+2];
        const handbrake=this.physics.profile.id==='kart'&&this.physics.input.handbrake;
        let lateralSlip=0,rollingSpeed=0;
        if(w.isInContact){
          const point=w.raycastResult.hitPointWorld,normal=w.raycastResult.hitNormalWorld;
          w.worldTransform.quaternion.vmult(Vec3.UNIT_X,this.slipAxle);
          const projection=this.slipAxle.dot(normal);
          this.slipAxle.x-=normal.x*projection;this.slipAxle.y-=normal.y*projection;this.slipAxle.z-=normal.z*projection;this.slipAxle.normalize();
          this.physics.body.getVelocityAtWorldPoint(point,this.slipVelocity);
          this.slipGroundVelocity.setZero();w.raycastResult.body?.getVelocityAtWorldPoint(point,this.slipGroundVelocity);
          this.slipVelocity.vsub(this.slipGroundVelocity,this.slipVelocity);
          lateralSlip=Math.abs(this.slipVelocity.dot(this.slipAxle));
          rollingSpeed=Math.sqrt(Math.max(0,this.slipVelocity.lengthSquared()-lateralSlip*lateralSlip));
        }
        // skidInfo reports friction saturation, not measured wheel slip. Require
        // actual lateral sliding too, with hysteresis and a brief onset delay.
        const continuing=this.slipDuration[j]>=.07;
        const sliding=w.skidInfo<(continuing?.75:.6)&&lateralSlip>Math.max(continuing?.45:.85,rollingSpeed*(continuing?.035:.055));
        const valid=w.isInContact&&!this.physics.telemetry.offroad;
        this.slipDuration[j]=valid&&sliding?Math.min(.2,this.slipDuration[j]+dt):0;
        if(valid&&(handbrake||this.slipDuration[j]>=.07)){
          const intensity=handbrake?.85:Math.min(1,Math.max(0,(lateralSlip-.4)/3.5));
          if(j===0)this.tyreSquealLeft=intensity;else this.tyreSquealRight=intensity;
          const hit=w.raycastResult.hitPointWorld,center=new THREE.Vector3(hit.x,hit.y+.035,hit.z),normal=new THREE.Vector3().copy(w.raycastResult.hitNormalWorld as any);
          if(normal.lengthSq()<.5)normal.set(0,1,0);else normal.normalize();
          this.tyreSmoke.emit(j,center,normal,this.slipVelocity,intensity,this.physics.profile.rearTyreWidth,dt);
          const q=w.worldTransform.quaternion,side=new THREE.Vector3(1,0,0).applyQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w));
          side.addScaledVector(normal,-side.dot(normal)).normalize().multiplyScalar(this.physics.profile.rearTyreWidth*.675);
          const left=center.clone().add(side),right=center.clone().sub(side),previous=this.previousSkid[j];
          if(previous){const distance=previous.center.distanceTo(center);if(distance<.02)continue;if(distance<Math.max(2,this.physics.telemetry.speed/3.6*dt*1.8)){
            const offset=this.skidCursor*18;this.skidPositions.set([...previous.left.toArray(),...previous.right.toArray(),...left.toArray(),...previous.right.toArray(),...right.toArray(),...left.toArray()],offset);
            (this.skidMarks.geometry.getAttribute('position') as THREE.BufferAttribute).addUpdateRange(offset,18);this.skidCursor=(this.skidCursor+1)%4096;this.skidCount=Math.min(4096,this.skidCount+1);changed=true;
          }}
          this.previousSkid[j]={center,left,right};
        }else{this.previousSkid[j]=null;this.tyreSmoke.stop(j);}
      }
      if(changed){this.skidMarks.geometry.getAttribute('position').needsUpdate=true;this.skidMarks.geometry.setDrawRange(0,this.skidCount*6);}
    }else{this.previousSkid=[null,null];this.slipDuration=[0,0];this.tyreSmoke.stop(0);this.tyreSmoke.stop(1);}
    this.tyreSmoke.update(dt);
    this.scene.updateMatrixWorld();for(const lod of this.treeLODs){lod.update(this.camera);const distance=lod.position.distanceTo(this.camera.position);lod.visible=this.mode==='orbit'||distance<1000;}
    for(const layer of this.detailLayers)layer.object.visible=layer.center.distanceToSquared(this.camera.position)<layer.distance*layer.distance;
    this.contactShadow.update(this.physics);
    this.updateSun();
    if(running||this.time<2)this.renderer.shadowMap.needsUpdate=true;
    this.renderer.render(this.scene,this.camera);
  }
}
