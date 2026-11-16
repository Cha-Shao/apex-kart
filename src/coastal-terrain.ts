import {TerrainField} from './terrain';
import {pavementPerimeter} from './guardrail-layout';
import {polygonContains} from './track-footprint';
import type {Point,TrackData} from './track';

export interface QuayEdge {innerA:Point;innerB:Point;outerA:Point;outerB:Point;innerTopA:number;innerTopB:number;topA:number;topB:number;bottom:number}
export interface CoastalTerrain {field:TerrainField;quays:QuayEdge[]}
const cache=new WeakMap<TerrainField,WeakMap<TrackData,{revision:number;result:CoastalTerrain}>>();
const smooth=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};

/** Two sweeps propagate nearest seed coordinates. All distances remain in grid
 * cells; work is linear in the heightfield size, never in the track length. */
function distances(mask:Uint8Array,n:number,seed:number){
  const nearest=new Int32Array(mask.length).fill(-1),squared=new Float64Array(mask.length).fill(Infinity);
  for(let i=0;i<mask.length;i++)if(mask[i]===seed){nearest[i]=i;squared[i]=0;}
  for(const reverse of [false,true]){
    const step=reverse?-1:1,from=reverse?n-1:0,to=reverse?-1:n;
    for(let z=from;z!==to;z+=step)for(let x=from;x!==to;x+=step){
      const i=z*n+x;
      for(const [dx,dz] of [[-step,0],[-step,-step],[0,-step],[step,-step]]){
        const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=n||nz>=n)continue;
        const candidate=nearest[nz*n+nx];if(candidate<0)continue;
        const d=(x-candidate%n)**2+(z-Math.floor(candidate/n))**2;
        if(d<squared[i]){squared[i]=d;nearest[i]=candidate;}
      }
    }
  }
  return {nearest,squared};
}

/** The same derived field feeds rendering and collision on every map. Saved
 * samples and the height brush remain the editable source, not a feedback loop. */
export function coastalTerrain(track:TrackData,source:TerrainField):CoastalTerrain{
  let tracks=cache.get(source);const cached=tracks?.get(track);if(cached?.revision===source.revision)return cached.result;
  const original=source.refined(),level=source.seaLevel;
  let result:CoastalTerrain={field:original,quays:[]};
  if(level!==null&&original.heights.some(h=>h<level)){
    const field=original.clone(),n=field.resolution,cell=field.cellSize,total=n*n;
    const wet=Uint8Array.from(field.heights,h=>h<level?1:0),water=distances(wet,n,1);
    // A raster-scale dry spur between two wet areas should not split a bay.
    // Closing changes only narrow dry necks; pavement is protected separately.
    const radius=5,dilated=Uint8Array.from(water.squared,d=>d<=radius*radius?1:0),dry=distances(dilated,n,0);
    const perimeter=pavementPerimeter(track),margin=3.8+cell*Math.SQRT2;
    const reach=Math.max(track.width*5,cell*8),taper=Math.max(2,cell*1.5),depth=Math.max(.5,Math.min(2,cell*.5));
    const nearestPavement=(p:Point)=>{
      let distance=Infinity,point:Point=p;
      for(const polygon of perimeter.index.query(p.x-reach,p.x+reach,p.z-reach,p.z+reach)){
        if(polygonContains(polygon.points,p))return {distance:-1,point:p};
        const points=polygon.points;
        for(let j=0;j<points.length;j++){
          const a=points[j],b=points[(j+1)%points.length],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));
          const q={x:a.x+dx*t,z:a.z+dz*t},d=Math.hypot(q.x-p.x,q.z-p.z);
          if(d<distance){distance=d;point=q;}
        }
      }
      return {distance,point};
    };
    for(let i=0;i<total;i++){
      if(wet[i])continue;
      const closing=dilated[i]&&dry.squared[i]>=radius*radius,distanceWater=Math.sqrt(water.squared[i])*cell;
      if(!closing&&distanceWater>reach)continue;
      const x=i%n,z=Math.floor(i/n),p={x:field.originX+x*cell,z:field.originZ+z*cell},paved=nearestPavement(p);
      if(paved.distance<=margin)continue;
      if(closing){field.heights[i]=level-depth;continue;}
      if(paved.distance>reach||distanceWater+paved.distance-margin>reach)continue;
      const seed=water.nearest[i];if(seed<0)continue;
      const wx=field.originX+(seed%n)*cell,wz=field.originZ+Math.floor(seed/n)*cell;
      // Water must be outward from the pavement, not across the road from an
      // infield point. This keeps an adjacent bay from eating through a track.
      if((p.x-paved.point.x)*(wx-p.x)+(p.z-paved.point.z)*(wz-p.z)<=0)continue;
      const blend=smooth((paved.distance-margin)/taper);
      field.heights[i]+=(Math.min(field.heights[i],level-depth)-field.heights[i])*blend;
    }
    const quays:QuayEdge[]=[],offset=margin-3;
    for(const contour of perimeter.field.contours){
      const points=contour.points,count=points.length;
      const segments:(QuayEdge|null)[]=new Array(count).fill(null);
      const outer=points.map((p,i)=>{
        const a=points[(i+count-1)%count],b=points[(i+1)%count],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz)||1;
        return {x:p.x+dz/length*offset,z:p.z-dx/length*offset};
      });
      for(let i=0;i<count;i++){
        const j=(i+1)%count,a=outer[i],b=outer[j],mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
        const x=Math.round((mx-field.originX)/cell),z=Math.round((mz-field.originZ)/cell);
        if(x<0||z<0||x>=n||z>=n)continue;
        const index=z*n+x,seed=water.nearest[index];if(seed<0||water.squared[index]*cell*cell>reach*reach)continue;
        const wx=field.originX+(seed%n)*cell,wz=field.originZ+Math.floor(seed/n)*cell,dx=b.x-a.x,dz=b.z-a.z;
        if(dz*(wx-mx)-dx*(wz-mz)<=0)continue;
        const length=Math.hypot(dx,dz)||1,probe=taper+cell;
        if(field.sample(mx+dz/length*probe,mz-dx/length*probe)>=level)continue;
        const topA=original.sample(a.x,a.z),topB=original.sample(b.x,b.z);
        if(Math.min(topA,topB)<level+.35)continue;
        segments[i]={innerA:points[i],innerB:points[j],outerA:a,outerB:b,innerTopA:original.sample(points[i].x,points[i].z),innerTopB:original.sample(points[j].x,points[j].z),topA,topB,bottom:level-depth-1};
      }
      // Keep continuous waterfront runs; discard isolated concrete slivers.
      const gap=segments.findIndex(q=>q===null);let run:QuayEdge[]=[];
      const flush=()=>{if(run.reduce((sum,q)=>sum+Math.hypot(q.outerB.x-q.outerA.x,q.outerB.z-q.outerA.z),0)>=Math.max(6,cell))quays.push(...run);run=[];};
      for(let k=0;k<count;k++){const q=segments[(gap+1+k)%count];if(q)run.push(q);else flush();}flush();
    }
    result={field,quays};
  }
  if(!tracks){tracks=new WeakMap();cache.set(source,tracks);}tracks.set(track,{revision:source.revision,result});return result;
}
