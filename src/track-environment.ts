import * as THREE from 'three';
import {TRACK_SURFACE_HEIGHT,bridgeHeight,curbWidth,isOnAsphalt,isOnGravel,nearestOnTrack,roadFootprint,type TrackData,type TrackSample,type Point} from './track';
import type {TerrainField} from './terrain';
import type {SceneAssets} from './scene-assets';
import {surfaceTrack,terrainNormals} from './surface-track';
import {surfaceUVs,terrainGrassColor} from './scene-assets';
import {drapeTriangles} from './terrain-mesh';
import {addGuardrails} from './guardrails';
import {FootprintIndex,cross2,polygonContains} from './track-footprint';
import {ASPHALT_TEXTURE_METRES,GRAVEL_TEXTURE_METRES} from './surface-materials';

export interface VegetationPoint extends Point {scale:number;stretch:number;variant:number}
export interface DetailLayer {object:THREE.Object3D;center:THREE.Vector3;distance:number}
type LandPlacement=(p:Point,margin?:number)=>boolean;
type Placement={x:number;y:number;z:number;sx:number;sy:number;sz:number;ry?:number;color?:number};
const seeded=(initial:number)=>{let seed=initial;return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};
const edge=(track:TrackData,index:number,side:number)=>track.width*.5+curbWidth(track.width)*(side>0?track.features.left:track.features.right)[index]+(side>0?track.features.gravelLeft:track.features.gravelRight)[index];
const grassOnly=(track:TrackData,p:Point,margin:number)=>{if(Math.abs(p.x+12)<65&&p.z>track.bounds.maxZ+10&&p.z<track.bounds.maxZ+45)return false;const near=nearestOnTrack(track,p);return near.distance>track.width*.5+margin&&!isOnAsphalt(track,p,near.distance,near)&&!isOnGravel(track,p,near.distance,near);};

/** Patches with clearings and understorey, rather than a uniform random field. */
export function vegetationLayout(track:TrackData,land:LandPlacement=()=>true){
  const random=seeded(7319),trees:VegetationPoint[]=[],shrubs:VegetationPoint[]=[],count=Math.max(24,Math.min(96,Math.ceil(track.length/65))),n=track.samples.length;
  const cells=new Map<string,VegetationPoint[]>(),cellSize=10;
  const plantTree=(x:number,z:number)=>{
    if(trees.length>=1200||!land({x,z},6)||!grassOnly(track,{x,z},8))return;
    const cx=Math.floor(x/cellSize),cz=Math.floor(z/cellSize),spacing=6+random()*2;
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(cells.get(`${cx+dx},${cz+dz}`)?.some(t=>(t.x-x)**2+(t.z-z)**2<spacing*spacing))return;
    const species=random(),tree={x,z,scale:.78+random()*.44,stretch:.9+random()*.24,variant:species<.65?0:species<.93?1:2},key=`${cx},${cz}`,cell=cells.get(key)??[];
    trees.push(tree);cell.push(tree);cells.set(key,cell);
  };
  for(let cluster=0;cluster<count;cluster++){
    const i=Math.floor((cluster+.25+random()*.5)/count*n)%n,s=track.samples[i],side=cluster%2?1:-1,offset=edge(track,i,side)+(cluster%3===0?43:20)+random()*24,cx=s.x+s.nx*offset*side,cz=s.z+s.nz*offset*side,radius=16+random()*18;
    const population=16+Math.floor(random()*10);
    for(let k=0;k<population;k++){
      const angle=random()*Math.PI*2,r=Math.sqrt(random())*radius,x=cx+Math.cos(angle)*r,z=cz+Math.sin(angle)*r;
      plantTree(x,z);
    }
    for(let k=0;k<9;k++){
      const angle=random()*Math.PI*2,r=random()*radius*1.15,x=cx+Math.cos(angle)*r,z=cz+Math.sin(angle)*r;
      if(land({x,z},2)&&grassOnly(track,{x,z},4))shrubs.push({x,z,scale:.32+random()*.22,stretch:.65+random()*.3,variant:0});
    }
  }
  // Patchy woodland beyond the circuit fills the horizon without filling the
  // infield with a uniform grid. The same land/runoff exclusions apply here.
  const b=track.bounds,cx=(b.minX+b.maxX)*.5,cz=(b.minZ+b.maxZ)*.5,rx=(b.maxX-b.minX)*.5+48,rz=(b.maxZ-b.minZ)*.5+48;
  const perimeterClusters=Math.min(48,Math.max(16,Math.ceil((rx+rz)/24)));
  for(let cluster=0;cluster<perimeterClusters;cluster++){
    const angle=(cluster+.2+random()*.6)/perimeterClusters*Math.PI*2,x=cx+Math.cos(angle)*rx,z=cz+Math.sin(angle)*rz;
    for(let k=0;k<15;k++){const a=random()*Math.PI*2,r=Math.sqrt(random())*24;plantTree(x+Math.cos(a)*r,z+Math.sin(a)*r);}
  }
  return {trees,shrubs};
}

function instances(group:THREE.Group,geometry:THREE.BufferGeometry,material:THREE.Material,placements:Placement[],name:string,castShadow=false){
  if(!placements.length){geometry.dispose();return null;}
  const mesh=new THREE.InstancedMesh(geometry,material,placements.length),dummy=new THREE.Object3D();mesh.name=name;
  placements.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.ry??0,0);dummy.scale.set(p.sx,p.sy,p.sz);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(p.color!==undefined)mesh.setColorAt(i,new THREE.Color(p.color));});
  mesh.castShadow=castShadow;mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);return mesh;
}
function detail(layers:DetailLayer[],mesh:THREE.InstancedMesh|null,distance:number){if(mesh?.boundingSphere)layers.push({object:mesh,center:mesh.boundingSphere.center.clone(),distance});}
function point(s:TrackSample,offset:number){return{x:s.x+s.nx*offset,z:s.z+s.nz*offset};}

function roadsideEdges(group:THREE.Group,track:TrackData,terrain:TerrainField,assets:SceneAssets,land:LandPlacement){
  const dense=surfaceTrack(track),positions:number[]=[],colors:number[]=[],verges:number[]=[],grassMasks:number[]=[],roadUvs:number[]=[],indices:number[]=[],n=dense.samples.length,width=.56,inner=-.12,tint=new THREE.Color();
  const paved=new FootprintIndex([...roadFootprint(dense.samples,dense.features,dense.width),...dense.runoffRegions]);
  const retained=(p:Point)=>[...paved.query(p.x,p.x,p.z,p.z)].some(r=>polygonContains(r.points,p));
  const exposedAsphalt=(index:number,side:number)=>{
    const f=dense.features,kerb=curbWidth(dense.width)*(side>0?f.left:f.right)[index],outer=(side>0?f.gravelLeft:f.gravelRight)[index],apron=(side>0?f.runoffLeft:f.runoffRight)[index];
    if(outer-apron>.02)return 0;
    if(apron>.02)return -1;
    return Math.max(0,1-kerb/.04);
  };
  const grassOverhang=(index:number,side:number)=>{
    const f=dense.features,outer=(side>0?f.gravelLeft:f.gravelRight)[index],apron=(side>0?f.runoffLeft:f.runoffRight)[index];
    // Gravel spills over grass instead. Crossing or neighbouring pavement
    // also prevents a turf strip being drawn across the other road section.
    if(outer-apron>.02||retained(point(dense.samples[index],(edge(dense,index,side)+.12)*side)))return 0;
    return 1;
  };
  for(const side of [-1,1])for(let i=0;i<n;i++){
    const j=(i+1)%n,a=dense.samples[i],b=dense.samples[j],ea=edge(dense,i,side),eb=edge(dense,j,side),kindA=exposedAsphalt(i,side),kindB=exposedAsphalt(j,side);
    // Elevated decks do not have a grass verge on the ground beneath them.
    if(bridgeHeight(dense,i)>.02||bridgeHeight(dense,j)>.02)continue;
    // A clipped-off runoff must not leave its old soil outline on the grass.
    if(!retained(point(a,(ea-.04)*side))||!retained(point(b,(eb-.04)*side)))continue;
    // Overlap slightly underneath the physical paved depth pass, avoiding a
    // bare seam while letting the fringe break up only the outside edge.
    const grassA=grassOverhang(i,side),grassB=grassOverhang(j,side);
    const p=point(a,(ea+inner)*side),q=point(a,(ea+width)*side),r=point(b,(eb+inner)*side),s=point(b,(eb+width)*side);
    if(![p,q,r,s].every(p=>land(p,.4)))continue;
    const areaA=cross2(p,q,r),areaB=cross2(q,s,r);if(Math.abs(areaA)<1e-9||Math.abs(areaB)<1e-9)continue;
    const data=drapeTriangles([[p,q,r],[q,s,r]],(x,z)=>terrain.sample(x,z)+.007,terrain),base=positions.length/3;
    for(let k=0;k<data.vertices.length;k+=3){
      const x=data.vertices[k],z=data.vertices[k+2],v={x,z},uA=cross2(p,v,r)/areaA,vA=cross2(p,q,v)/areaA;
      let t:number,outside:number;
      // Carry exact triangle coordinates through terrain clipping: projecting
      // onto the centreline would make the narrow fringe wobble on tight bends.
      if(uA>=-1e-6&&vA>=-1e-6&&uA+vA<=1+1e-6){t=vA;outside=inner+(width-inner)*uA;}
      else{const uB=cross2(q,v,r)/areaB,vB=cross2(q,s,v)/areaB;t=uB+vB;outside=width-(width-inner)*vB;}
      t=Math.max(0,Math.min(1,t));const lateral=(ea+(eb-ea)*t+outside)*side;
      terrainGrassColor(x,z,terrain.sample(x,z),tint);
      positions.push(x,data.vertices[k+1],z);colors.push(tint.r,tint.g,tint.b);verges.push(outside,kindA+(kindB-kindA)*t);grassMasks.push(grassA+(grassB-grassA)*t);
      roadUvs.push(a.distance+(j===0?dense.length-a.distance:b.distance-a.distance)*t,lateral);
    }
    for(const k of data.indices)indices.push(base+k);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('verge',new THREE.Float32BufferAttribute(verges,2));geometry.setAttribute('vergeGrass',new THREE.Float32BufferAttribute(grassMasks,1));geometry.setAttribute('roadUv',new THREE.Float32BufferAttribute(roadUvs,2));geometry.setIndex(indices);surfaceUVs(geometry,ASPHALT_TEXTURE_METRES);terrainNormals(geometry,terrain);
  const grassGeometry=geometry.clone();surfaceUVs(grassGeometry,2);
  // Only the cutout grass lip sits above the road plane, allowing visible
  // overlap on the outer kerb. Soil and asphalt fringes remain beneath it.
  const fringeGeometry=grassGeometry.clone(),fringePositions=fringeGeometry.getAttribute('position');
  for(let i=0;i<fringePositions.count;i++)fringePositions.setY(i,fringePositions.getY(i)+TRACK_SURFACE_HEIGHT+.006-.007);
  // Every decoration retains depth tests and precedes shadows/marks/smoke.
  for(const [geo,material,name,order] of [[grassGeometry,assets.grassVerge,'feathered-grass-and-soil-boundary',0],[geometry,assets.asphaltVerge,'broken-asphalt-grass-edge',1],[geometry,assets.runoffVerge,'broken-runoff-grass-edge',1],[fringeGeometry,assets.grassFringe,'grass-overhanging-kerbs',1]] as const){
    const mesh=new THREE.Mesh(geo,material);mesh.name=name;mesh.receiveShadow=true;mesh.renderOrder=order;group.add(mesh);
  }
}

/** Loose grains cross both sides of the actual gravel union, including its
 * asphalt-facing edge. Internal triangulation edges must not emit spill. */
function gravelSpill(group:THREE.Group,track:TrackData,terrain:TerrainField,assets:SceneAssets,land:LandPlacement){
  const dense=surfaceTrack(track),regions=dense.runoffRegions.filter(r=>r.surface==='gravel'),index=new FootprintIndex(regions),positions:number[]=[],verges:number[]=[],indices:number[]=[];
  const contains=(p:Point)=>[...index.query(p.x,p.x,p.z,p.z)].some(r=>polygonContains(r.points,p));
  for(const region of regions){
    if(bridgeHeight(dense,region.index)>.02||bridgeHeight(dense,(region.index+1)%dense.samples.length)>.02)continue;
    const points=region.points,orientation=Math.sign(points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.z-b.x*a.z;},0));
    if(!orientation)continue;
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(length<.025)continue;
      const nx=dz/length*orientation,nz=-dx/length*orientation,cuts=Math.max(1,Math.ceil(length/1.2));
      for(let k=0;k<cuts;k++){
        const from={x:a.x+dx*k/cuts,z:a.z+dz*k/cuts},to={x:a.x+dx*(k+1)/cuts,z:a.z+dz*(k+1)/cuts},mid={x:(from.x+to.x)*.5+nx*.06,z:(from.z+to.z)*.5+nz*.06};
        if(contains(mid))continue;
        // Carry the same gravel PBR grains 0.92m beyond the material edge.
        // The shader fades to ZERO by 0.82m, so the strip's geometry edge
        // cannot reintroduce a visible straight cut through the dust.
        const p={x:from.x-nx*.18,z:from.z-nz*.18},q={x:from.x+nx*.92,z:from.z+nz*.92},r={x:to.x-nx*.18,z:to.z-nz*.18},s={x:to.x+nx*.92,z:to.z+nz*.92};
        if(![p,q,r,s].every(v=>land(v,.1)))continue;
        // A few millimetres over the road plane, retaining normal depth tests
        // for vehicles and overpasses. This is a visual deposit, not a collider.
        const data=drapeTriangles([[p,q,r],[q,s,r]],(x,z)=>terrain.sample(x,z)+TRACK_SURFACE_HEIGHT+.008,terrain),base=positions.length/3;
        for(let v=0;v<data.vertices.length;v+=3){const x=data.vertices[v],z=data.vertices[v+2];positions.push(x,data.vertices[v+1],z);verges.push((x-from.x)*nx+(z-from.z)*nz,0);}
        for(const v of data.indices)indices.push(base+v);
      }
    }
  }
  if(!indices.length)return;
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('verge',new THREE.Float32BufferAttribute(verges,2));geometry.setIndex(indices);surfaceUVs(geometry,GRAVEL_TEXTURE_METRES);terrainNormals(geometry,terrain);
  const mesh=new THREE.Mesh(geometry,assets.gravelSpill);mesh.name='loose-gravel-over-road-and-grass';mesh.receiveShadow=true;
  // The source gravel/asphalt priority surfaces are already drawn; this
  // depth-tested transparent deposit goes above them without z-fighting.
  mesh.renderOrder=75;group.add(mesh);
}

function facilities(group:THREE.Group,track:TrackData,terrain:TerrainField,assets:SceneAssets,layers:DetailLayer[],land:LandPlacement){
  const n=track.samples.length,safe=(p:Point)=>land(p,4)&&nearestOnTrack(track,p).distance>track.width*.5+2;
  addGuardrails(group,track,terrain,layers);
  // A few tyre stacks beyond corner runoff: no collider or invisible wall.
  const walls=track.features.corners.filter(c=>c.approach>30).slice(0,6);
  for(const corner of walls){const i=corner.end,s=track.samples[i],offset=(edge(track,i,corner.side)+2)*corner.side,p=point(s,offset),stack:Placement[]=[];if(!safe(p))continue;
    for(let col=0;col<10;col++)for(let row=0;row<3;row++){const x=p.x+s.tx*(col-4.5)*.61,z=p.z+s.tz*(col-4.5)*.61;stack.push({x,y:terrain.sample(x,z)+.11+row*.22,z,sx:1,sy:1.45,sz:1,ry:0});}
    const geometry=new THREE.TorusGeometry(.235,.076,6,16);geometry.rotateX(Math.PI/2);detail(layers,instances(group,geometry,assets.tyre,stack,'visual tyre wall',true),480);
  }
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=160;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#161a19';ctx.fillRect(0,0,1024,160);ctx.fillStyle='#d8c96e';ctx.fillRect(0,0,17,160);ctx.font='italic 900 75px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('APEX  MOTORSPORT',520,84);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;const boardMaterial=new THREE.MeshStandardMaterial({map,roughness:.94,side:THREE.DoubleSide,envMapIntensity:.15}),boards:Placement[]=[],boardPosts:Placement[]=[],boardCount=track.length>2000?14:7;
  for(let k=0;k<boardCount;k++){const i=Math.floor((k+.2)/boardCount*n),s=track.samples[i],side=k%2?1:-1,p=point(s,(edge(track,i,side)+4)*side);if(!safe(p))continue;const y=terrain.sample(p.x,p.z),ry=Math.atan2(-s.nx*side,-s.nz*side);boards.push({x:p.x,y:y+1.1,z:p.z,sx:8,sy:1.25,sz:1,ry});for(const sign of [-1,1])boardPosts.push({x:p.x+s.tx*sign*3,y:y+.65,z:p.z+s.tz*sign*3,sx:.07,sy:1.3,sz:.07});}
  instances(group,new THREE.PlaneGeometry(1,1),boardMaterial,boards,'trackside sponsor boards',true);instances(group,new THREE.BoxGeometry(1,1,1),assets.alloy,boardPosts,'sponsor board posts',true);
}

export function addTrackEnvironment(group:THREE.Group,track:TrackData,terrain:TerrainField,assets:SceneAssets,shrubs:VegetationPoint[],land:LandPlacement=()=>true){
  const layers:DetailLayer[]=[];roadsideEdges(group,track,terrain,assets,land);gravelSpill(group,track,terrain,assets,land);facilities(group,track,terrain,assets,layers,land);return layers;
}
