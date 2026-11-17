import * as THREE from 'three';
import type {TrackData,Point} from './track';
import type {TerrainField} from './terrain';
import {FootprintIndex,polygonDistance} from './track-footprint';
import type {PlantModel} from './grass';
import {meadowSeeds,vegetationColonyWeight} from './vegetation-distribution';
import {vegetationEdgeWeight,VEGETATION_ROOT_OFFSET} from './vegetation-edge';
import {VEGETATION_RENDER_ORDER} from './vegetation-render-order';

const CELL=24,LOAD_RADIUS=84,KEEP_RADIUS=112;
type LandPlacement=(p:Point,margin?:number)=>boolean;
type MaterialFactory=(source:THREE.Material|THREE.Material[],model:PlantModel,level:number,birth:number)=>THREE.Material;
interface Placement extends Point {y:number;scale:number;spread:number;stretch:number;rotation:number;tint:THREE.Color}
interface Batch {meshes:THREE.InstancedMesh[];center:THREE.Vector3;radius:number;model:PlantModel}
interface Tile {x:number;z:number;batches:Batch[]}
const seeded=(initial:number)=>{let seed=initial;return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};

/** Deterministic grass families on eligible land, kept in a bounded
 * camera neighbourhood instead of allocating millions of off-screen plants. */
export class MeadowField extends THREE.Group {
  private readonly tiles=new Map<string,Tile>();
  private pending:{x:number;z:number;distance:number}[]=[];
  private viewCell='';
  private cold=true;
  constructor(private track:TrackData,private terrain:TerrainField,private land:LandPlacement,private paved:FootprintIndex,private models:PlantModel[],private material:MaterialFactory){
    super();this.name='irregular-tall-and-short-grass-clumps';
  }

  private build(x:number,z:number,time:number):Tile{
    const random=seeded((Math.imul(x,73856093)^Math.imul(z,19349663)^0x45d9f3b)>>>0),lists=this.models.map(()=>[] as Placement[]),f=this.terrain,b=this.track.bounds;
    const short=this.models.flatMap((model,i)=>model.kind.startsWith('grass-short')?[i]:[]),tall=this.models.flatMap((model,i)=>model.kind.startsWith('grass-tall')?[i]:[]);
    const put=(px:number,pz:number,high:boolean)=>{
      const pool=high&&tall.length?tall:short;if(!pool.length)return false;
      const index=pool[Math.floor(random()*pool.length)],model=this.models[index],scale=.94+random()*.12,spread=.96+random()*.08,y=f.sample(px,pz),clearance=(model.radius+.065)*scale*Math.max(1,spread);
      if(f.seaLevel!==null&&y<f.seaLevel)return false;
      if(!this.land({x:px,z:pz},clearance))return false;
      // Preserve the same paddock and viewing-stand footprints as the shared
      // scenery generator, independent of circuit identity.
      if(px+clearance>-77&&px-clearance<53&&pz+clearance>b.maxZ+10&&pz-clearance<b.maxZ+45)return false;
      const standZ=(b.minZ+b.maxZ)*.5;
      if(px+clearance>b.maxX+19&&px-clearance<b.maxX+41&&pz+clearance>standZ-17&&pz-clearance<standZ+17)return false;
      let edgeDistance=1.8;
      for(const region of this.paved.query(px-1.8,px+1.8,pz-1.8,pz+1.8)){
        const distance=polygonDistance(region.points,{x:px,z:pz});if(distance<clearance)return false;edgeDistance=Math.min(edgeDistance,distance);
      }
      const growth=vegetationEdgeWeight(edgeDistance,px,pz);
      if(high&&growth<.18||random()>.82+.18*growth)return false;
      const dx=(f.sample(px+.3,pz)-f.sample(px-.3,pz))/.6,dz=(f.sample(px,pz+.3)-f.sample(px,pz-.3))/.6;
      if(Math.hypot(dx,dz)>1.05)return false;
      const tone=.94+random()*.06;
      lists[index].push({x:px,y:y+VEGETATION_ROOT_OFFSET,z:pz,scale,spread,stretch:scale*(.95+random()*.1),rotation:random()*Math.PI*2,tint:new THREE.Color().setScalar(tone)});
      return true;
    };
    for(const {x:px,z:pz} of meadowSeeds(x*CELL,z*CELL,(x+1)*CELL,(z+1)*CELL)){
      const growth=vegetationColonyWeight(px,pz);if(growth<.2)continue;
      // Multiple overlapping high tufts make one irregular core. Fit each
      // actual tuft separately, so a partial colony survives narrow verges.
      const phase=random()*Math.PI*2,ax=Math.cos(phase),az=Math.sin(phase),cores=growth>.6?3:2,spacing=.23+random()*.05;
      for(let i=0;i<cores;i++){
        const along=(i-(cores-1)*.5)*spacing,across=(random()-.5)*.1;
        put(px+ax*along-az*across,pz+az*along+ax*across,true);
      }
      // The low skirt touches the core and nearby colonies on a partial arc;
      // it does not become a disconnected necklace of tiny circular dots.
      const skirtPhase=phase+(random()<.5?1:-1)*Math.PI*.5,arc=1.7+random()*.6,companions=3+Math.floor(growth*2.99);
      for(let i=0;i<companions;i++){
        const angle=skirtPhase+(i/(companions-1)-.5)*arc,radius=.28+random()*.1,along=(random()-.5)*.28;
        put(px+Math.cos(angle)*radius+ax*along,pz+Math.sin(angle)*radius+az*along,false);
      }
    }
    const batches:Batch[]=[],dummy=new THREE.Object3D();
    for(const [index,placements] of lists.entries()){
      if(!placements.length)continue;
      const model=this.models[index],center=new THREE.Vector3(placements.reduce((sum,p)=>sum+p.x,0)/placements.length,placements.reduce((sum,p)=>sum+p.y,0)/placements.length,placements.reduce((sum,p)=>sum+p.z,0)/placements.length);
      // A triangular heightfield cannot exceed the extrema of the vertices
      // in the cells a patch touches. Include those extrema in both LOD
      // visibility and frustum bounds after GPU draping.
      let drape=0;
      for(const p of placements){
        const radius=model.radius*p.scale*Math.max(1,p.spread),startX=Math.max(0,Math.floor((p.x-radius-f.originX)/f.cellSize)),endX=Math.min(f.resolution-1,Math.ceil((p.x+radius-f.originX)/f.cellSize));
        const startZ=Math.max(0,Math.floor((p.z-radius-f.originZ)/f.cellSize)),endZ=Math.min(f.resolution-1,Math.ceil((p.z+radius-f.originZ)/f.cellSize));
        for(let iz=startZ;iz<=endZ;iz++)for(let ix=startX;ix<=endX;ix++)drape=Math.max(drape,Math.abs(f.heights[iz*f.resolution+ix]-p.y));
      }
      const meshes=[model.near,model.far].map((source,level)=>{
        const mesh=new THREE.InstancedMesh(source.geometry,this.material(source.material,model,level,time),placements.length);
        mesh.name=`meadow-tile-${x}-${z}-${index}-${level}`;mesh.position.copy(center);
        placements.forEach((p,i)=>{
          // Short families shrink in height as well as footprint. Both grass
          // sizes retain the same proportions at roads, fences and shores.
          dummy.position.set(p.x-center.x,p.y-center.y,p.z-center.z);dummy.rotation.set(0,p.rotation,0);dummy.scale.set(p.scale,p.stretch,p.scale*p.spread);dummy.updateMatrix();
          mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,p.tint);
        });
        mesh.receiveShadow=true;mesh.renderOrder=VEGETATION_RENDER_ORDER;mesh.computeBoundingSphere();
        mesh.boundingSphere!.radius+=drape+.08;this.add(mesh);return mesh;
      });
      const radius=drape+Math.max(...placements.map(p=>Math.hypot(p.x-center.x,p.y-center.y,p.z-center.z)+model.radius*p.scale*Math.max(1,p.spread)+model.height*Math.max(p.scale,p.stretch)));
      batches.push({meshes,center,radius,model});
    }
    return {x,z,batches};
  }

  private releaseTile(tile:Tile){
    for(const batch of tile.batches)for(const mesh of batch.meshes){
      mesh.removeFromParent();mesh.dispose();
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose();
      // The source geometry and photographic textures belong to SceneAssets.
    }
  }

  update(time:number,view:THREE.Vector3){
    const f=this.terrain;
    if(Math.abs(view.y-f.sample(view.x,view.z))>80){
      for(const tile of this.tiles.values())for(const batch of tile.batches)for(const mesh of batch.meshes)mesh.visible=false;
      return;
    }
    const x=Math.floor(view.x/CELL),z=Math.floor(view.z/CELL),key=`${x},${z}`;
    if(key!==this.viewCell){
      this.viewCell=key;this.pending=[];
      for(const [key,tile] of this.tiles){if(Math.hypot((tile.x+.5)*CELL-view.x,(tile.z+.5)*CELL-view.z)>KEEP_RADIUS){this.releaseTile(tile);this.tiles.delete(key);}}
      const reach=Math.ceil(LOAD_RADIUS/CELL);
      for(let dz=-reach;dz<=reach;dz++)for(let dx=-reach;dx<=reach;dx++){
        const cx=x+dx,cz=z+dz,distance=Math.hypot((cx+.5)*CELL-view.x,(cz+.5)*CELL-view.z);
        if(distance>LOAD_RADIUS||this.tiles.has(`${cx},${cz}`))continue;
        if((cx+1)*CELL<=f.originX||cx*CELL>=f.originX+f.size||(cz+1)*CELL<=f.originZ||cz*CELL>=f.originZ+f.size)continue;
        this.pending.push({x:cx,z:cz,distance});
      }
      this.pending.sort((a,b)=>a.distance-b.distance);
    }
    const budget=this.cold?12:6;this.cold=false;
    for(let i=0;i<budget&&this.pending.length;i++){
      const next=this.pending.shift()!,key=`${next.x},${next.z}`;
      this.tiles.set(key,this.build(next.x,next.z,time));
    }
    for(const tile of this.tiles.values())for(const {meshes,center,radius,model} of tile.batches){
      const distance=center.distanceTo(view),near=Math.max(0,distance-radius),far=distance+radius;
      meshes[0].visible=near<model.lodEnd;meshes[1].visible=far>model.lodStart&&near<model.fadeEnd;
    }
  }

  dispose(){for(const tile of this.tiles.values())this.releaseTile(tile);this.tiles.clear();this.pending=[];}
}
