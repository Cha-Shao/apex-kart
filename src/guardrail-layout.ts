import {bridgeHeight,roadFootprint,type Point,type TrackData} from './track';
import {FootprintIndex,paddedFootprint,polygonDistance,type FootprintContour} from './track-footprint';
import {surfaceTrack} from './surface-track';
import type {TerrainField} from './terrain';

export const GUARDRAIL_POST_SPACING=3.6;
export const GUARDRAIL_PROFILE={base:.2,tierStep:.28,tierHeight:.25,tiers:3,front:-.065,back:.035,fenceOffset:.23,fenceBottom:1,fenceTop:2.3} as const;
const PADDING=3,CHUNK_LENGTH=90;
export interface GuardrailPoint extends Point {deck:number;nx:number;nz:number;d:number}
interface RailLoop {points:GuardrailPoint[];length:number;area:number}
export interface GuardrailLayout {paths:GuardrailPoint[][];posts:GuardrailPoint[]}
const layoutCache=new WeakMap<TrackData,GuardrailLayout>();
const perimeterCache=new WeakMap<TrackData,ReturnType<typeof makePerimeter>>();
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const wrap=(d:number,length:number)=>(d%length+length)%length;
const along=(a:number,b:number,length:number)=>{const d=Math.abs(a-b);return Math.min(d,length-d);};

function makePerimeter(track:TrackData){
  const dense=surfaceTrack(track),polygons=[...roadFootprint(dense.samples,dense.features,dense.width),...dense.runoffRegions];
  return {dense,field:paddedFootprint(polygons,PADDING,track.length>3500?1.5:1.25),index:new FootprintIndex(polygons)};
}
/** Shared pavement union: guardrails and shoreline foundations use one edge. */
export function pavementPerimeter(track:TrackData){
  let cached=perimeterCache.get(track);if(!cached){cached=makePerimeter(track);perimeterCache.set(track,cached);}return cached;
}
function railLoop(contour:FootprintContour,data:ReturnType<typeof pavementPerimeter>):RailLoop{
  const {dense,field,index}=data,smooth:Point[]=[];
  // Smooth the contour, then project it outside the padded pavement again.
  for(let i=0;i<contour.points.length;i++){
    const a=contour.points[i],b=contour.points[(i+1)%contour.points.length];
    for(const t of [.25,.75]){
      const p={x:mix(a.x,b.x,t),z:mix(a.z,b.z,t)};
      for(let k=0;k<3;k++){
        const d=field.sample(p);if(d>=.04)break;
        const gx=field.sample({x:p.x+.3,z:p.z})-field.sample({x:p.x-.3,z:p.z}),gz=field.sample({x:p.x,z:p.z+.3})-field.sample({x:p.x,z:p.z-.3}),l=Math.hypot(gx,gz)||1;
        p.x+=gx/l*(.04-d);p.z+=gz/l*(.04-d);
      }
      smooth.push(p);
    }
  }
  const distances=[0];for(let i=0;i<smooth.length;i++){const a=smooth[i],b=smooth[(i+1)%smooth.length];distances.push(distances[i]+Math.hypot(b.x-a.x,b.z-a.z));}
  const length=distances.at(-1)!,count=Math.max(16,Math.ceil(length/1.6)),points:GuardrailPoint[]=[];let cursor=0;
  for(let k=0;k<count;k++){
    const d=k/count*length;while(cursor<smooth.length-1&&distances[cursor+1]<d)cursor++;
    const a=smooth[cursor],b=smooth[(cursor+1)%smooth.length],t=(d-distances[cursor])/(distances[cursor+1]-distances[cursor]||1),p={x:mix(a.x,b.x,t),z:mix(a.z,b.z,t)};
    let best=Infinity,owner=0;
    for(const polygon of index.query(p.x-PADDING-3,p.x+PADDING+3,p.z-PADDING-3,p.z+PADDING+3)){
      const distance=polygonDistance(polygon.points,p);if(distance<best){best=distance;owner=polygon.index;}
    }
    const s=dense.samples[owner],j=(owner+1)%dense.samples.length,q=dense.samples[j],dx=q.x-s.x,dz=q.z-s.z,u=Math.max(0,Math.min(1,((p.x-s.x)*dx+(p.z-s.z)*dz)/(dx*dx+dz*dz||1))),deck=mix(bridgeHeight(dense,owner),bridgeHeight(dense,j),u);
    points.push({...p,deck,nx:0,nz:0,d});
  }
  for(let i=0;i<count;i++){const a=points[(i+count-1)%count],b=points[(i+1)%count],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz)||1;points[i].nx=dz/l;points[i].nz=-dx/l;}
  return {points,length,area:contour.area};
}
function pointAt(loop:RailLoop,d:number):GuardrailPoint{
  const distance=wrap(d,loop.length),f=distance/loop.length*loop.points.length,i=Math.floor(f),a=loop.points[i],b=loop.points[(i+1)%loop.points.length],t=f-i,nx=mix(a.nx,b.nx,t),nz=mix(a.nz,b.nz,t),l=Math.hypot(nx,nz)||1;
  return {x:mix(a.x,b.x,t),z:mix(a.z,b.z,t),deck:mix(a.deck,b.deck,t),nx:nx/l,nz:nz/l,d};
}

export const guardrailHeight=(p:GuardrailPoint,terrain:TerrainField)=>terrain.sample(p.x,p.z)+p.deck;

/** One plan for both rendering and collision, including every marshal opening
 * and overlapping return. Heights are sampled from each consumer's terrain. */
export function guardrailLayout(track:TrackData):GuardrailLayout{
  const cached=layoutCache.get(track);if(cached)return cached;
  const data=pavementPerimeter(track),loops=data.field.contours.map(c=>railLoop(c,data)).sort((a,b)=>b.area-a.area),paths:GuardrailPoint[][]=[],posts:GuardrailPoint[]=[];
  let passageBudget=Math.max(1,Math.min(4,Math.ceil(track.length/2200)));
  for(const loop of loops){
    const openings:number[]=[],count=loop.area>0?Math.min(passageBudget,Math.max(1,Math.floor(loop.length/300))):0;
    for(let k=0;k<count;k++){
      const target=(k+.37)/count*loop.length;let chosen:number|undefined,best=Infinity;
      for(let shift=-28;shift<=28;shift+=2){
        const d=wrap(target+shift,loop.length),p=pointAt(loop,d),a=pointAt(loop,d-6),b=pointAt(loop,d+6),span=Math.hypot(b.x-a.x,b.z-a.z),outside={x:p.x+p.nx*1.6,z:p.z+p.nz*1.6};
        if(data.field.sample(outside)<1||span<10.8||Math.abs(a.deck-b.deck)>.4)continue;
        const score=Math.abs(shift)*.05+12-span;if(score<best){best=score;chosen=d;}
      }
      if(chosen!==undefined)openings.push(chosen);
    }
    passageBudget-=openings.length;
    const cuts=[0,loop.length,...loop.points.map(p=>p.d)];
    for(const d of openings)for(const sign of [-1,1])cuts.push(wrap(d+sign*1.4,loop.length));
    cuts.sort((a,b)=>a-b);const unique=cuts.filter((d,i)=>!i||d-cuts[i-1]>1e-6);let chunk:GuardrailPoint[]=[];
    const flush=()=>{if(chunk.length>1)paths.push(chunk);chunk=[];};
    for(let i=0;i<unique.length-1;i++){
      const from=unique[i],to=unique[i+1],a=pointAt(loop,from),b=pointAt(loop,to);
      if(openings.some(d=>along(wrap((from+to)/2,loop.length),d,loop.length)<1.4)||Math.abs(a.deck-b.deck)>.75){flush();continue;}
      if(!chunk.length)chunk.push(a);chunk.push(b);
      if(to-chunk[0].d>=CHUNK_LENGTH){flush();chunk.push(b);}
    }
    flush();
    for(let d=0;d<loop.length;d+=GUARDRAIL_POST_SPACING)if(!openings.some(g=>along(d,g,loop.length)<1.7))posts.push(pointAt(loop,d));
    for(const d of openings){
      for(const sign of [-1,1])posts.push(pointAt(loop,d+sign*1.45));
      const overlap:GuardrailPoint[]=[];
      for(let t=-5.5;t<=5.5;t+=.5){
        const p=pointAt(loop,d+t),offset=1.65+Math.max(0,Math.abs(t)-4)*.16;p.x+=p.nx*offset;p.z+=p.nz*offset;overlap.push(p);
        if(t===-5.5||t===-2||t===1.5||t===5.5)posts.push(p);
      }
      paths.push(overlap);
    }
  }
  const layout={paths,posts};layoutCache.set(track,layout);return layout;
}
