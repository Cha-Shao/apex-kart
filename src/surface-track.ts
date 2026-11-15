import * as THREE from 'three';
import {makeRunoffRegions,type TrackData,type TrackSample,type RunoffSample} from './track';
import type {TerrainField} from './terrain';
const surfaceCache=new WeakMap<TrackData,Map<number,TrackData>>();

/** Dense, smooth render sampling; timing and nearest-segment budgets stay fixed. */
export function surfaceTrack(track:TrackData,maxStep=1.2):TrackData{
  const cached=surfaceCache.get(track)?.get(maxStep);if(cached)return cached;
  const original=track.samples.length,n=Math.min(18000,Math.max(original,Math.ceil(track.length/maxStep)));
  const curve=track.visualCurve??new THREE.CatmullRomCurve3(track.samples.map(p=>new THREE.Vector3(p.x,0,p.z)),true,'centripetal');
  const interpolate=(values:number[],u:number,smooth=false)=>{const f=u*original,j=Math.floor(f)%original,t=f-Math.floor(f),blend=smooth?t*t*(3-2*t):t;return values[j]+(values[(j+1)%original]-values[j])*blend;};
  const samples:TrackSample[]=Array.from({length:n},(_,i)=>{
    const u=i/n,p=curve.getPointAt(u),t=curve.getTangentAt(u),source=track.samples[Math.floor(u*original)];
    return {...source,x:p.x,z:p.z,tx:t.x,tz:t.z,nx:-t.z,nz:t.x,distance:u*track.length};
  });
  const features={...track.features};
  for(const key of ['left','right','runoffWidth','runoffLeft','runoffRight','outer'] as const)features[key]=Array.from({length:n},(_,i)=>interpolate(track.features[key],i/n,key==='left'||key==='right'));
  const runoffCurve=new THREE.CatmullRomCurve3(track.runoff.map(p=>new THREE.Vector3(p.x,0,p.z)),true,'centripetal');
  // Runoff control points correspond to centreline arc indices, not their own arc distance.
  const radii=track.runoff.map(r=>r.radius);
  const runoff:RunoffSample[]=Array.from({length:n},(_,i)=>{const u=i/n,p=runoffCurve.getPoint(u),t=runoffCurve.getTangent(u);return{x:p.x,z:p.z,nx:-t.z,nz:t.x,radius:interpolate(radii,u)};});
  const bridges=track.bridges.map(b=>({...b,index:Math.round(b.index/original*n)%n,otherIndex:Math.round(b.otherIndex/original*n)%n}));
  const result={...track,samples,features,runoff,bridges,runoffRegions:makeRunoffRegions(samples,features,track.width,runoff,bridges)};
  const cache=surfaceCache.get(track)??new Map<number,TrackData>();cache.set(maxStep,result);surfaceCache.set(track,cache);return result;
}

/** Smooth shading follows the refined collision heightfield, even on clipped
 * faces whose vertices are duplicated at a stripe or terrain triangle boundary. */
export function terrainNormals(geometry:THREE.BufferGeometry,field:TerrainField){
  const positions=geometry.getAttribute('position'),normals=new Float32Array(positions.count*3),delta=field.cellSize;
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),z=positions.getZ(i),dx=(field.sample(x+delta,z)-field.sample(x-delta,z))/(2*delta),dz=(field.sample(x,z+delta)-field.sample(x,z-delta))/(2*delta),length=Math.hypot(dx,1,dz);
    normals[i*3]=-dx/length;normals[i*3+1]=1/length;normals[i*3+2]=-dz/length;
  }
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));return geometry;
}
