import * as THREE from 'three';
import {curbWidth,isOnAsphalt,isOnGravel,nearestOnTrack,roadFootprint,type TrackData,type TrackSample,type Point} from './track';
import type {TerrainField} from './terrain';
import type {SceneAssets} from './scene-assets';
import {surfaceTrack,terrainNormals} from './surface-track';
import {surfaceUVs} from './scene-assets';
import {drapeTriangles} from './terrain-mesh';
import {addGuardrails} from './guardrails';
import {FootprintIndex,polygonContains} from './track-footprint';

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

function soilEdges(group:THREE.Group,track:TrackData,terrain:TerrainField,assets:SceneAssets,land:LandPlacement){
  const dense=surfaceTrack(track),positions:number[]=[],colors:number[]=[],indices:number[]=[],n=dense.samples.length;
  const paved=new FootprintIndex([...roadFootprint(dense.samples,dense.features,dense.width),...dense.runoffRegions]);
  const retained=(p:Point)=>[...paved.query(p.x,p.x,p.z,p.z)].some(r=>polygonContains(r.points,p));
  for(const side of [-1,1])for(let i=0;i<n;i++){
    const j=(i+1)%n,a=dense.samples[i],b=dense.samples[j],ea=edge(dense,i,side),eb=edge(dense,j,side),width=.32+.24*(.5+.5*Math.sin(a.distance*.19));
    // A clipped-off runoff must not leave its old soil outline on the grass.
    if(!retained(point(a,(ea-.04)*side))||!retained(point(b,(eb-.04)*side)))continue;
    const p=point(a,(ea+.02)*side),q=point(a,(ea+width)*side),r=point(b,(eb+.02)*side),s=point(b,(eb+width)*side);
    if(![p,q,r,s].every(p=>land(p,.4)))continue;
    const data=drapeTriangles([[p,q,r],[q,s,r]],(x,z)=>terrain.sample(x,z)+.007,terrain),base=positions.length/3;
    for(let k=0;k<data.vertices.length;k+=3){
      const x=data.vertices[k],z=data.vertices[k+2],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1))),e=ea+(eb-ea)*t;
      const distance=((x-a.x-dx*t)*a.nx+(z-a.z-dz*t)*a.nz)*side,fade=Math.max(0,Math.min(1,1-(distance-e)/width));
      positions.push(x,data.vertices[k+1],z);colors.push(.72,.64,.48,fade*.38*(.7+.3*Math.sin(a.distance*.13)**2));
    }
    for(const k of data.indices)indices.push(base+k);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));geometry.setIndex(indices);surfaceUVs(geometry,.7);terrainNormals(geometry,terrain);
  // This sits below every paved surface. Never pull it forward with a depth
  // offset: even at equal depth, the road/kerb/runoff depth pass must win.
  const material=new THREE.MeshStandardMaterial({map:assets.concrete.map,normalMap:assets.concrete.normalMap,normalScale:new THREE.Vector2(.2,.2),color:0xb8a784,vertexColors:true,roughness:1,envMapIntensity:.1,transparent:true,depthTest:true,depthWrite:false,depthFunc:THREE.LessDepth});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='feathered-soil-boundary';mesh.receiveShadow=true;mesh.renderOrder=1;group.add(mesh);
}

function grassBlades(){
  const positions:number[]=[],colors:number[]=[],indices:number[]=[],random=seeded(17);
  for(let blade=0;blade<7;blade++){
    const angle=random()*Math.PI*2,offset=random()*.1,height=.09+random()*.13,width=.009+random()*.01,bend=.015+random()*.04,base=positions.length/3,c=Math.cos(angle),s=Math.sin(angle),x=c*offset,z=s*offset;
    for(const [h,w,lean] of [[0,width,0],[height*.6,width*.6,bend*.4],[height,0,bend]])for(const side of [-1,1]){positions.push(x+c*w*side-s*lean,h,z+s*w*side+c*lean);const light=.42+h/height*.58;colors.push(light*.88,light,light*.71);}
    indices.push(base,base+1,base+2,base+1,base+3,base+2,base+2,base+3,base+4,base+3,base+5,base+4);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function understorey(group:THREE.Group,track:TrackData,terrain:TerrainField,assets:SceneAssets,shrubs:VegetationPoint[],layers:DetailLayer[],land:LandPlacement){
  const random=seeded(813),grassCells=new Map<string,Placement[]>(),count=Math.min(380,Math.ceil(track.length/12)),n=track.samples.length;
  for(let i=0;i<count;i++){
    const index=Math.floor(i/count*n),s=track.samples[index];
    for(const side of [-1,1])for(let k=0;k<6;k++){
      const offset=(edge(track,index,side)+.3+random()*2.1)*side,x=s.x+s.nx*offset+s.tx*(random()-.5)*10,z=s.z+s.nz*offset+s.tz*(random()-.5)*10;
      if(!land({x,z},.4)||!grassOnly(track,{x,z},.1))continue;
      const key=`${Math.floor(x/70)},${Math.floor(z/70)}`,cell=grassCells.get(key)??[],scale=.65+random()*.65;
      cell.push({x,y:terrain.sample(x,z)-.015,z,sx:scale,sy:scale,sz:scale,ry:random()*Math.PI*2,color:[0x7e9348,0x6d8544,0x8a9a51][Math.floor(random()*3)]});grassCells.set(key,cell);
    }
  }
  const bladeMaterial=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true,side:THREE.DoubleSide});
  for(const cell of grassCells.values())detail(layers,instances(group,grassBlades(),bladeMaterial,cell,'close-grass-tufts'),95);
  const model=assets.models.get('ash-far');if(!model)return;model.updateMatrixWorld(true);
  model.traverse(source=>{
    if(!(source instanceof THREE.Mesh)||Array.isArray(source.material)||!source.material.name.includes('leaves'))return;
    source.geometry.computeBoundingBox();const minY=source.geometry.boundingBox?.min.y??0;
    const cells=new Map<string,Placement[]>();
    for(const shrub of shrubs){const key=`${Math.floor(shrub.x/140)},${Math.floor(shrub.z/140)}`,cell=cells.get(key)??[],sy=shrub.scale*shrub.stretch;
      cell.push({x:shrub.x,y:terrain.sample(shrub.x,shrub.z)-minY*sy-.06,z:shrub.z,sx:shrub.scale*1.4,sy,sz:shrub.scale*1.4,ry:shrub.x*1.7});cells.set(key,cell);
    }
    for(const cell of cells.values())detail(layers,instances(group,source.geometry,source.material,cell,'ash understorey shrubs'),330);
  });
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
  const layers:DetailLayer[]=[];soilEdges(group,track,terrain,assets,land);understorey(group,track,terrain,assets,shrubs,layers,land);facilities(group,track,terrain,assets,layers,land);return layers;
}
