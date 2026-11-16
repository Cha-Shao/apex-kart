import * as THREE from 'three';
import { parseTerrain, type TerrainData } from './terrain';
import {trackFeatures,type TrackFeatures} from './track-features';
import {drapeTriangles,type TerrainGrid} from './terrain-mesh';
import {racingLineOffsets} from './racing-line';
import {applyRunoffProfile} from './runoff-profile';
import {FootprintIndex,clipHalfPlane,cross2,footprintPolygon,polygonContains,type FootprintPolygon} from './track-footprint';

export interface Point { x: number; z: number }
export type SegmentKind = 'straight' | 'curve' | 'hairpin';
export interface TrackSample extends Point { tx: number; tz: number; nx: number; nz: number; curvature: number; kind: SegmentKind; distance: number }
export interface RunoffSample extends Point {nx:number;nz:number;radius:number}
export type RunoffSurface='asphalt'|'gravel';
export interface RunoffRegion extends FootprintPolygon {side:number;surface:RunoffSurface}
export const CURB_WIDTH=1.88;
// Scale narrow circuits by road width, including compact presets and drawings.
export const curbWidth=(roadWidth:number)=>CURB_WIDTH*Math.min(1,roadWidth/12);
// All visual track layers share a plane. Rendering resolves their priority;
// millimetre height differences must not decide which surface covers another.
export const TRACK_SURFACE_HEIGHT=.018;
export interface TrackData { controls: Point[]; samples: TrackSample[]; features:TrackFeatures;runoff:RunoffSample[]; runoffRegions:RunoffRegion[]; length: number; width: number; corners: number; hairpins: number; straightPercent: number; bridges:Bridge[]; bounds: { minX:number;maxX:number;minZ:number;maxZ:number };visualCurve?:THREE.CatmullRomCurve3 }
export interface Bridge { index:number;otherIndex:number;distance:number;height:number;halfLength:number }
export interface BuildOptions { preserveLayout?:boolean;allowCrossings?:boolean }
export interface RouteMetadata {circuitId:string;scale:'native'|'compact';terrainVersion?:number;terrainEdited?:boolean}
export interface TrackSettings { width: number; smoothness: number; barriers: boolean }
export const DEFAULT_SETTINGS: TrackSettings = { width:10, smoothness:60, barriers:false };
export const PRESETS: { id:string; name:string; subtitle:string; points:Point[] }[] = [
  {id:'club',name:'海岸俱乐部',subtitle:'CLUB CIRCUIT',points:[{x:-117,z:80},{x:-45,z:80},{x:45,z:80},{x:119,z:77},{x:145,z:58},{x:144,z:25},{x:125,z:7},{x:79,z:4},{x:65,z:-14},{x:77,z:-34},{x:126,z:-37},{x:143,z:-58},{x:135,z:-86},{x:107,z:-99},{x:20,z:-101},{x:-62,z:-101},{x:-108,z:-92},{x:-130,z:-67},{x:-124,z:-41},{x:-91,z:-24},{x:-52,z:-27},{x:-30,z:-11},{x:-29,z:12},{x:-52,z:29},{x:-110,z:29},{x:-134,z:47},{x:-136,z:65}]},
  {id:'flow',name:'流线公园',subtitle:'FLOW PARK',points:[{x:-128,z:60},{x:-55,z:81},{x:30,z:79},{x:111,z:62},{x:143,z:29},{x:128,z:-7},{x:63,z:-23},{x:47,z:-63},{x:10,z:-92},{x:-55,z:-87},{x:-85,z:-51},{x:-65,z:-12},{x:-103,z:8},{x:-139,z:30}]},
  {id:'technical',name:'发夹挑战',subtitle:'TECHNICAL RING',points:[{x:-133,z:82},{x:-50,z:82},{x:42,z:82},{x:130,z:80},{x:150,z:53},{x:130,z:29},{x:48,z:28},{x:30,z:10},{x:48,z:-7},{x:127,z:-8},{x:147,z:-34},{x:125,z:-61},{x:49,z:-63},{x:29,z:-82},{x:-39,z:-97},{x:-117,z:-83},{x:-143,z:-55},{x:-119,z:-29},{x:-59,z:-27},{x:-42,z:-6},{x:-60,z:13},{x:-120,z:16},{x:-145,z:45}]},
];
export const distance = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.z-b.z);
const mix = (a:Point,b:Point,t:number):Point => ({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});

function simplifyOpen(points:Point[], tolerance:number):Point[] {
  if(points.length<3) return points;
  const a=points[0],b=points.at(-1)!; const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz;
  let max=0,index=0;
  for(let i=1;i<points.length-1;i++) { const p=points[i]; const t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l)):0; const d=distance(p,{x:a.x+t*dx,z:a.z+t*dz}); if(d>max){max=d;index=i;} }
  if(max<=tolerance)return [a,b];
  return [...simplifyOpen(points.slice(0,index+1),tolerance).slice(0,-1),...simplifyOpen(points.slice(index),tolerance)];
}
export function prepareStroke(raw:Point[]):Point[] {
  const points:Point[]=[];
  for(const p of raw) { if(!Number.isFinite(p.x)||!Number.isFinite(p.z))throw new Error('赛道包含无效坐标'); if(!points.length||distance(p,points.at(-1)!)>1.2)points.push({...p}); }
  if(points.length>2&&distance(points[0],points.at(-1)!)<4)points.pop();
  if(points.length<5)throw new Error('再多画一点：赛道至少需要 5 个不同的点。');
  let far=1;for(let i=2;i<points.length;i++)if(distance(points[0],points[i])>distance(points[0],points[far]))far=i;
  const result=[...simplifyOpen(points.slice(0,far+1),1.15).slice(0,-1),...simplifyOpen([...points.slice(far),points[0]],1.15).slice(0,-1)];
  return result.length>=5?result:points;
}
function smoothClosed(points:Point[],amount:number):Point[] {
  let p=points.map(v=>({...v}));
  const passes=amount<15?0:amount<70?1:2, t=.08+amount/100*.18;
  for(let k=0;k<passes;k++){const q:Point[]=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];q.push(mix(a,b,t),mix(a,b,1-t));}p=q;}
  return p;
}
function segmentsCross(a:Point,b:Point,c:Point,d:Point) {
  const cross=(p:Point,q:Point,r:Point)=>(q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x);
  return cross(a,b,c)*cross(a,b,d)<-1e-5&&cross(c,d,a)*cross(c,d,b)<-1e-5;
}
export function buildTrack(raw:Point[],settings:TrackSettings,options:BuildOptions={}):TrackData {
  if(!Number.isFinite(settings.width)||settings.width<6||settings.width>18)throw new Error('赛道宽度应在 6–18 米之间。');
  const kerbWidth=curbWidth(settings.width);
  const controls=options.preserveLayout?raw.map(p=>({...p})):prepareStroke(raw);
  const curve=new THREE.CatmullRomCurve3((options.preserveLayout?controls:smoothClosed(controls,settings.smoothness)).map(p=>new THREE.Vector3(p.x,0,p.z)),true,'centripetal');
  curve.arcLengthDivisions=Math.max(4096,controls.length*4);
  const length=curve.getLength();
  if(length<130)throw new Error('赛道太短，请画一个更大的闭合环线。');
  // Sampling budget follows control-point detail, not the circuit scale.
  // Uniform arc distance preserves timing, bridge and sector indexing.
  const n=Math.min(1600,Math.max(160,controls.length*3));
  const positions=curve.getSpacedPoints(n).slice(0,-1);
  const crossings:{i:number;j:number}[]=[];
  for(let i=0;i<n;i++)for(let j=i+3;j<n;j++){if(i===0&&j===n-1)continue;if(segmentsCross(positions[i],positions[(i+1)%n],positions[j],positions[(j+1)%n])){if(!options.allowCrossings)throw new Error('赛道发生交叉了，请画一条不交叉的闭合环线。');if(!crossings.some(c=>Math.abs(c.i-i)<5&&Math.abs(c.j-j)<5))crossings.push({i,j});}}
  const step=length/n;
  const samples:TrackSample[]=positions.map((p,i)=>{
    const prev=positions[(i-1+n)%n],next=positions[(i+1)%n];const dx=next.x-prev.x,dz=next.z-prev.z,l=Math.hypot(dx,dz);
    const ax=p.x-prev.x,az=p.z-prev.z,bx=next.x-p.x,bz=next.z-p.z;
    const curvature=Math.atan2(ax*bz-az*bx,ax*bx+az*bz)/step;
    return {x:p.x,z:p.z,tx:dx/l,tz:dz/l,nx:-dz/l,nz:dx/l,curvature,kind:'straight',distance:i*step};
  });
  for(let k=0;k<2;k++){const c=samples.map((_,i)=>{let v=0;for(let j=-2;j<=2;j++)v+=samples[(i+j+n)%n].curvature;return v/5;});samples.forEach((s,i)=>s.curvature=c[i]);}
  const features=trackFeatures(samples,length);
  applyRunoffProfile({samples,features,length,width:settings.width},kerbWidth);
  samples.forEach(s=>s.kind=Math.abs(s.curvature)>features.threshold*(.034/.009)?'hairpin':Math.abs(s.curvature)>features.threshold?'curve':'straight');
  // A near-miss between distant sections must have space for both road edges.
  const neighborSkip=Math.ceil((settings.width*2.2)/step);
  if(!options.preserveLayout)for(let i=0;i<n;i+=3)for(let j=i+neighborSkip;j<n;j+=3){if(n-j+i<neighborSkip)continue;if(distance(samples[i],samples[j])<settings.width+1.5)throw new Error('两段赛道靠得太近，请拉开距离或减小路宽。');}
  let corners=0,hairpins=0,inCorner=false,hasHairpin=false,sign=0;
  const offset=samples.findIndex(s=>s.kind==='straight');
  for(let k=0;k<=n;k++){const s=samples[(k+Math.max(0,offset))%n];const turn=Math.sign(s.curvature);if(s.kind!=='straight'){if(!inCorner||turn!==sign){if(inCorner&&hasHairpin)hairpins++;corners++;hasHairpin=false;}inCorner=true;sign=turn;hasHairpin ||= s.kind==='hairpin';}else{if(inCorner&&hasHairpin)hairpins++;inCorner=false;hasHairpin=false;}}
  const xs=samples.map(s=>s.x),zs=samples.map(s=>s.z);
  const bridges:Bridge[]=crossings.slice(0,8).map(c=>({index:c.j,otherIndex:c.i,distance:c.j*step,height:5.2,halfLength:Math.min(length*.06,Math.max(42,settings.width*6))}));
  const runoff:RunoffSample[]=samples.map((s,i)=>({x:s.x,z:s.z,nx:s.nx,nz:s.nz,radius:settings.width/2+kerbWidth+features.runoffWidth[i]}));
  const runoffRegions=makeRunoffRegions(samples,features,settings.width,runoff,bridges);
  return {controls,samples,features,runoff,runoffRegions,length,width:settings.width,corners,hairpins,bridges,straightPercent:Math.round(samples.filter(s=>s.kind==='straight').length/n*100),bounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)},visualCurve:curve};
}

export function roadFootprint(samples:TrackSample[],features:TrackFeatures,roadWidth:number){
  const kerbWidth=curbWidth(roadWidth);
  const offset=(i:number,side:number)=>{const s=samples[i],w=roadWidth/2+kerbWidth*(side>0?features.left:features.right)[i];return{x:s.x+s.nx*w*side,z:s.z+s.nz*w*side};};
  return samples.map((_,i)=>{const j=(i+1)%samples.length;return footprintPolygon([offset(i,1),offset(i,-1),offset(j,-1),offset(j,1)],i);});
}

export function makeRunoffRegions(samples:TrackSample[],features:TrackFeatures,roadWidth:number,runoff:RunoffSample[],bridges:Bridge[]=[]){
  const n=samples.length,runoffRegions:RunoffRegion[]=[],road=new FootprintIndex(roadFootprint(samples,features,roadWidth)),step=samples[1].distance-samples[0].distance,length=step*n,kerbWidth=curbWidth(roadWidth);
  const deck=samples.map((_,i)=>bridgeHeight({samples,bridges,length,width:roadWidth},i));
  const area=(p:Point[])=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a.x*b.z-b.x*a.z;},0));
  for(const side of [-1,1]){
    const roadEdge=(k:number)=>{const s=samples[k],offset=roadWidth/2+kerbWidth*(side>0?features.left:features.right)[k];return{x:s.x+s.nx*offset*side,z:s.z+s.nz*offset*side};};
    const clipWidths=(requested:number[])=>{
      // Limit each complete outward span before triangulating it. Clipping only
      // triangles can leave far-side lobes and diagonal ends behind another road.
      let widths=requested.map((width,i)=>{
        if(width<.001)return 0;
        const a=roadEdge(i),s=samples[i],dx=s.nx*side,dz=s.nz*side,b={x:a.x+dx*width,z:a.z+dz*width};let limit=width;
        for(const blocker of road.query(Math.min(a.x,b.x),Math.max(a.x,b.x),Math.min(a.z,b.z),Math.max(a.z,b.z))){
          const delta=Math.abs(blocker.index-i),separation=Math.min(delta,n-delta);
          if(separation<=2||separation*step<=roadWidth*1.1||Math.abs(deck[i]-deck[blocker.index])>=1)continue;
          if(polygonContains(blocker.points,a))return 0;
          for(let k=0;k<blocker.points.length;k++){
            const p=blocker.points[k],q=blocker.points[(k+1)%blocker.points.length],ex=q.x-p.x,ez=q.z-p.z,denominator=dx*ez-dz*ex;
            if(Math.abs(denominator)<1e-8)continue;
            const px=p.x-a.x,pz=p.z-a.z,t=(px*ez-pz*ex)/denominator,u=(px*dz-pz*dx)/denominator;
            if(t>=0&&t<=limit&&u>=0&&u<=1)limit=Math.max(0,t-.35);
          }
        }
        return limit;
      });
      // Round a clipped end inward, so smoothing cannot leak across a straight.
      const radius=Math.max(1,Math.ceil(Math.min(4,roadWidth*.35)/step));
      for(let pass=0;pass<3;pass++){
        const previous=widths;widths=previous.map((width,i)=>{
          let sum=0,weight=0;for(let k=-radius;k<=radius;k++){const w=radius+1-Math.abs(k);sum+=previous[(i+k+n)%n]*w;weight+=w;}
          return Math.min(width,(width+sum/weight)*.5);
        });
      }
      const taperLength=Math.min(18,Math.max(6,roadWidth*.9)),taperSamples=Math.min(n-1,Math.ceil(taperLength/step)),clipped=widths;
      widths=clipped.map((width,i)=>{
        if(width<.001)return 0;
        let distance=taperLength;
        for(let k=1;k<=taperSamples;k++)if(clipped[(i+k)%n]<.001||clipped[(i-k+n)%n]<.001){distance=Math.min(distance,k*step);break;}
        const t=Math.min(1,distance/taperLength),fade=t*t*t*(10+t*(-15+6*t));return width*fade;
      });
      return widths;
    };
    const apron=side>0?features.runoffLeft:features.runoffRight,gravel=side>0?features.gravelLeft:features.gravelRight;
    const asphalt=clipWidths(apron),outer=clipWidths(gravel.map((v,i)=>Math.max(v,apron[i])));
    // Identical clipping preserves the nested envelopes. Join both materials
    // at the very same vertices, including rounded ends and narrow hairpins.
    for(let i=0;i<n;i++)outer[i]=Math.max(asphalt[i],outer[i]);
    for(const surface of ['gravel','asphalt'] as const){
      const inner=surface==='gravel'?asphalt:new Array<number>(n).fill(0),widths=surface==='gravel'?outer:asphalt;
      for(let i=0;i<n;i++){const j=(i+1)%n;if(widths[i]-inner[i]<.001&&widths[j]-inner[j]<.001)continue;
        const edge=(k:number):[Point,Point]=>{
          const r=runoff[k],a=roadEdge(k);
          return [{x:a.x+r.nx*side*inner[k],z:a.z+r.nz*side*inner[k]},{x:a.x+r.nx*side*widths[k],z:a.z+r.nz*side*widths[k]}];
        };
        const [a,b]=edge(i),[c,d]=edge(j),edgeA=roadEdge(i),edgeB=roadEdge(j),source={x:(edgeA.x+edgeB.x)/2,z:(edgeA.z+edgeB.z)/2},bounds=footprintPolygon([a,b,c,d],i);
        const blockers=[...road.query(bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ)].filter(r=>{
          const delta=Math.abs(r.index-i),separation=Math.min(delta,n-delta);return separation>2&&separation*step>roadWidth*1.1&&Math.abs(deck[i]-deck[r.index])<1;
        }).sort((a,b)=>Math.hypot(samples[a.index].x-source.x,samples[a.index].z-source.z)-Math.hypot(samples[b.index].x-source.x,samples[b.index].z-source.z));
        // Stop at the first neighbouring road. Subtracting only its asphalt would
        // leave a disconnected runoff lobe on the far side of the straight.
        for(const triangle of [[a,b,c],[b,d,c]]){
          let points:Point[]=triangle;
          for(const blocker of blockers){
            const polygon=blocker.points,orientation=Math.sign(polygon.reduce((sum,p,k)=>{const q=polygon[(k+1)%polygon.length];return sum+p.x*q.z-q.x*p.z;},0))||1;
            let overlap=points,cutA:Point|undefined,cutB:Point|undefined,cutDistance=0,lateralA:Point|undefined,lateralB:Point|undefined,lateralDistance=0;
            for(let k=0;k<polygon.length;k++){
              const p=polygon[k],q=polygon[(k+1)%polygon.length],signed=cross2(p,q,source)*orientation/(Math.hypot(q.x-p.x,q.z-p.z)||1);
              overlap=clipHalfPlane(overlap,p,q,orientation);
              if(signed<cutDistance){cutDistance=signed;cutA=p;cutB=q;}
              // Prefer the road's long edge to individual segment end caps. This
              // keeps a continuous clipping line along a neighbouring straight.
              if((k===1||k===3)&&signed<lateralDistance){lateralDistance=signed;lateralA=p;lateralB=q;}
            }
            if(overlap.length<3||area(overlap)<1e-6)continue;
            if(lateralA&&lateralB){cutA=lateralA;cutB=lateralB;}
            if(!cutA||!cutB){points=[];break;}
            points=clipHalfPlane(points,cutA,cutB,-orientation);if(points.length<3)break;
          }
          if(points.length>=3&&area(points)>1e-6)runoffRegions.push({...footprintPolygon(points,i),side,surface});
        }
      }
    }
  }
  return runoffRegions;
}

const runoffIndexCache=new WeakMap<TrackData,FootprintIndex>();
function runoffSurfaceAt(track:TrackData,p:Point):RunoffSurface|undefined{
  let index=runoffIndexCache.get(track);if(!index){index=new FootprintIndex(track.runoffRegions);runoffIndexCache.set(track,index);}
  let surface:RunoffSurface|undefined;
  for(const polygon of index.query(p.x,p.x,p.z,p.z)){
    const region=polygon as RunoffRegion;if(!polygonContains(region.points,p))continue;
    if(region.surface==='asphalt')return 'asphalt';surface='gravel';
  }
  return surface;
}
export function isOnAsphalt(track:TrackData,p:Point,roadDistance?:number,knownNear?:ReturnType<typeof nearestOnTrack>){
  const near=knownNear??nearestOnTrack(track,p),d=roadDistance??near.distance;if(d<=track.width/2)return true;const kerb=(near.signedDistance>=0?track.features.left:track.features.right)[near.index];if(kerb>0&&d<=track.width/2+curbWidth(track.width)*kerb)return true;
  return runoffSurfaceAt(track,p)==='asphalt';
}
/** Asphalt wins where aprons from neighbouring bends overlap gravel. */
export function isOnGravel(track:TrackData,p:Point,roadDistance?:number,knownNear?:ReturnType<typeof nearestOnTrack>){
  if(isOnAsphalt(track,p,roadDistance,knownNear))return false;
  return runoffSurfaceAt(track,p)==='gravel';
}
export function runoffGeometry(track:TrackData,surface:(x:number,z:number)=>number,grid:TerrainGrid,surfaceType:RunoffSurface='asphalt'){
  const vertices:number[]=[],indices:number[]=[];
  for(const r of track.runoffRegions){
    if(r.surface!==surfaceType)continue;
    const start=track.samples[r.index],end=track.samples[(r.index+1)%track.samples.length],dx=end.x-start.x,dz=end.z-start.z,length2=dx*dx+dz*dz;
    const h0=bridgeHeight(track,r.index),h1=bridgeHeight(track,(r.index+1)%track.samples.length);
    const triangles=r.points.slice(1,-1).map((p,k)=>[r.points[0],p,r.points[k+2]]);
    const data=drapeTriangles(triangles,(x,z)=>{const t=Math.max(0,Math.min(1,((x-start.x)*dx+(z-start.z)*dz)/(length2||1)));return surface(x,z)+h0+(h1-h0)*t+TRACK_SURFACE_HEIGHT;},grid),base=vertices.length/3;
    for(const v of data.vertices)vertices.push(v);for(const i of data.indices)indices.push(base+i);
  }
  return {vertices,indices};
}

export function bridgeHeight(track:Pick<TrackData,'samples'|'bridges'|'length'|'width'>,index:number){let height=0;const distance=track.samples[index%track.samples.length].distance;for(const b of track.bridges){const delta=Math.abs(distance-b.distance),d=Math.min(delta,track.length-delta),plateau=track.width*1.5;if(d>b.halfLength)continue;const t=Math.max(0,Math.min(1,(b.halfLength-d)/(b.halfLength-plateau)));height=Math.max(height,b.height*t*t*(3-2*t));}return height;}

export function curbGeometry(track:TrackData,surface:(x:number,z:number)=>number,grid?:TerrainGrid){
  const vertices:number[]=[],indices:number[]=[],colors:number[]=[],kerbUvs:number[]=[],kerbTraffic:number[]=[],n=track.samples.length,line=racingLineOffsets(track),kerbWidth=curbWidth(track.width);
  // Submit both edges in route order: later segments cover earlier kerbs.
  for(let i=0;i<n;i++)for(const side of [-1,1]){
    const mask=side>0?track.features.left:track.features.right;if(!mask[i]&&!mask[(i+1)%n])continue;
    const j=(i+1)%n,a=track.samples[i],b=track.samples[j],start=a.distance,end=j===0?track.length:b.distance,cuts=[start];
    for(let d=(Math.floor(start/2.15)+1)*2.15;d<end-1e-6;d+=2.15)cuts.push(d);cuts.push(end);
    const h0=bridgeHeight(track,i),h1=bridgeHeight(track,j);
    for(let k=0;k<cuts.length-1;k++){
      const points:Point[]=[],t0=(cuts[k]-start)/(end-start),t1=(cuts[k+1]-start)/(end-start);
      for(const t of [t0,t1])for(const u of [0,1]){
        const offset=side*(track.width/2+u*kerbWidth*(mask[i]+(mask[j]-mask[i])*t));
        points.push({x:a.x+(b.x-a.x)*t+(a.nx+(b.nx-a.nx)*t)*offset,z:a.z+(b.z-a.z)*t+(a.nz+(b.nz-a.nz)*t)*offset});
      }
      const [p,q,r,s]=points,spanX=b.x-a.x,spanZ=b.z-a.z,length2=spanX*spanX+spanZ*spanZ;
      const height=(x:number,z:number)=>{const t=Math.max(0,Math.min(1,((x-a.x)*spanX+(z-a.z)*spanZ)/(length2||1)));return surface(x,z)+h0+(h1-h0)*t+TRACK_SURFACE_HEIGHT;};
      const data=grid?drapeTriangles([[p,q,r],[q,s,r]],height,grid):{vertices:points.flatMap(p=>[p.x,height(p.x,p.z),p.z]),indices:side===1?[0,1,2,1,3,2]:[0,2,1,1,2,3]};
      const base=vertices.length/3,red=Math.floor((cuts[k]+cuts[k+1])*.5/2.15)%2===0;
      for(const value of data.vertices)vertices.push(value);
      for(let f=0;f<data.indices.length;f+=3){
        const [a,b,c]=data.indices.slice(f,f+3),v=data.vertices,area=(v[b*3+2]-v[a*3+2])*(v[c*3]-v[a*3])-(v[b*3]-v[a*3])*(v[c*3+2]-v[a*3+2]);
        if(Math.abs(area)<1e-9)continue;if(area>0)indices.push(base+a,base+b,base+c);else indices.push(base+a,base+c,base+b);
      }
      for(let v=0;v<data.vertices.length;v+=3)colors.push(...(red?[.48,.012,.018]:[.78,.80,.77]));
      for(let v=0;v<data.vertices.length;v+=3){
        const x=data.vertices[v],z=data.vertices[v+2],t=Math.max(0,Math.min(1,((x-a.x)*spanX+(z-a.z)*spanZ)/(length2||1))),nx=a.nx+(b.nx-a.nx)*t,nz=a.nz+(b.nz-a.nz)*t;
        const lateral=((x-a.x-spanX*t)*nx+(z-a.z-spanZ*t)*nz)*side,localWidth=kerbWidth*(mask[i]+(mask[j]-mask[i])*t);
        kerbUvs.push(start+(end-start)*t,Math.max(0,Math.min(1,(lateral-track.width/2)/Math.max(.001,localWidth))));
        // The outer tyre and a spread of slightly different laps approach
        // this edge most often at the apex, turn-in and corner exit.
        const wheelGap=Math.max(0,track.width/2-(line[i]+(line[j]-line[i])*t)*side-.64);
        kerbTraffic.push(Math.exp(-((wheelGap/.9)**2)));
      }
    }
  }
  return {vertices,indices,colors,kerbUvs,kerbTraffic};
}

export function nearestOnTrack(track:TrackData,p:Point):{index:number;distance:number;signedDistance:number;sample:TrackSample} {
  let best=Infinity,index=0,signedDistance=0;
  for(let i=0;i<track.samples.length;i++){const a=track.samples[i],b=track.samples[(i+1)%track.samples.length];const dx=b.x-a.x,dz=b.z-a.z;const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));const px=p.x-a.x-dx*t,pz=p.z-a.z-dz*t,d=px*px+pz*pz;if(d<best){best=d;index=i;signedDistance=px*a.nx+pz*a.nz;}}
  return {index,distance:Math.sqrt(best),signedDistance,sample:track.samples[index]};
}

export interface TrackFile { version:1|2; name:string; points:Point[]; settings:TrackSettings;terrain?:TerrainData;route?:RouteMetadata }
export function parseTrackFile(text:string):TrackFile {
  const v=JSON.parse(text);
  if(![1,2].includes(v.version)||!Array.isArray(v.points)||v.points.length<5||v.points.length>10000)throw new Error('不支持的赛道文件。请导入 APEX 导出的 JSON。');
  if(v.points.some((p:any)=>!Number.isFinite(p.x)||!Number.isFinite(p.z)||Math.abs(p.x)>20000||Math.abs(p.z)>20000))throw new Error('赛道坐标超出了画布范围。');
  const savedSettings={...DEFAULT_SETTINGS,...v.settings};
  const width=Number(savedSettings.width),smoothness=Number(savedSettings.smoothness);
  const settings:TrackSettings={width:Math.max(6,Math.min(18,Number.isFinite(width)?width:10)),smoothness:Math.max(0,Math.min(100,Number.isFinite(smoothness)?smoothness:60)),barriers:false};
  const route=v.route&&typeof v.route.circuitId==='string'&&['native','compact'].includes(v.route.scale)?{circuitId:v.route.circuitId.slice(0,80),scale:v.route.scale} as RouteMetadata:undefined;
  if(route){
    if(Number.isSafeInteger(v.route.terrainVersion)&&v.route.terrainVersion>0)route.terrainVersion=v.route.terrainVersion;
    if(v.route.terrainEdited===true)route.terrainEdited=true;
  }
  buildTrack(v.points,settings,route?{preserveLayout:true,allowCrossings:true}:{});
  const terrain=v.terrain?parseTerrain(v.terrain).toJSON():undefined;
  return {version:2,name:String(v.name||'我的赛道').slice(0,40),points:v.points,settings,terrain,route};
}

