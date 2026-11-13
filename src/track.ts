import * as THREE from 'three';

export interface Point { x: number; z: number }
export type SegmentKind = 'straight' | 'curve' | 'hairpin';
export interface TrackSample extends Point { tx: number; tz: number; nx: number; nz: number; curvature: number; kind: SegmentKind; distance: number }
export interface TrackData { controls: Point[]; samples: TrackSample[]; length: number; width: number; corners: number; hairpins: number; straightPercent: number; bounds: { minX:number;maxX:number;minZ:number;maxZ:number } }
export interface TrackSettings { width: number; smoothness: number; curbs: boolean; barriers: boolean }
export const DEFAULT_SETTINGS: TrackSettings = { width:10, smoothness:60, curbs:true, barriers:true };
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
export function buildTrack(raw:Point[],settings:TrackSettings):TrackData {
  if(!Number.isFinite(settings.width)||settings.width<6||settings.width>18)throw new Error('赛道宽度应在 6–18 米之间。');
  const controls=prepareStroke(raw);
  const curve=new THREE.CatmullRomCurve3(smoothClosed(controls,settings.smoothness).map(p=>new THREE.Vector3(p.x,0,p.z)),true,'centripetal');
  curve.arcLengthDivisions=4096;
  const length=curve.getLength();
  if(length<130)throw new Error('赛道太短，请画一个更大的闭合环线。');
  const n=Math.max(128,Math.ceil(length/1.6));
  const positions=curve.getSpacedPoints(n).slice(0,-1);
  // Reject intersecting centre lines: an overpass would require a different collision mesh.
  for(let i=0;i<n;i++)for(let j=i+3;j<n;j++){if(i===0&&j===n-1)continue;if(segmentsCross(positions[i],positions[(i+1)%n],positions[j],positions[(j+1)%n]))throw new Error('赛道发生交叉了，请画一条不交叉的闭合环线。');}
  const step=length/n;
  const samples:TrackSample[]=positions.map((p,i)=>{
    const prev=positions[(i-3+n)%n],next=positions[(i+3)%n];const dx=next.x-prev.x,dz=next.z-prev.z,l=Math.hypot(dx,dz);
    const ax=p.x-prev.x,az=p.z-prev.z,bx=next.x-p.x,bz=next.z-p.z;
    const curvature=Math.atan2(ax*bz-az*bx,ax*bx+az*bz)/(3*step);
    return {x:p.x,z:p.z,tx:dx/l,tz:dz/l,nx:-dz/l,nz:dx/l,curvature,kind:'straight',distance:i*step};
  });
  for(let k=0;k<2;k++){const c=samples.map((_,i)=>{let v=0;for(let j=-2;j<=2;j++)v+=samples[(i+j+n)%n].curvature;return v/5;});samples.forEach((s,i)=>s.curvature=c[i]);}
  samples.forEach(s=>s.kind=Math.abs(s.curvature)>.034?'hairpin':Math.abs(s.curvature)>.009?'curve':'straight');
  // A near-miss between distant sections must have space for both road edges.
  const neighborSkip=Math.ceil((settings.width*2.2)/step);
  for(let i=0;i<n;i+=3)for(let j=i+neighborSkip;j<n;j+=3){if(n-j+i<neighborSkip)continue;if(distance(samples[i],samples[j])<settings.width+1.5)throw new Error('两段赛道靠得太近，请拉开距离或减小路宽。');}
  let corners=0,hairpins=0,inCorner=false,hasHairpin=false,sign=0;
  const offset=samples.findIndex(s=>s.kind==='straight');
  for(let k=0;k<=n;k++){const s=samples[(k+Math.max(0,offset))%n];const turn=Math.sign(s.curvature);if(s.kind!=='straight'){if(!inCorner||turn!==sign){if(inCorner&&hasHairpin)hairpins++;corners++;hasHairpin=false;}inCorner=true;sign=turn;hasHairpin ||= s.kind==='hairpin';}else{if(inCorner&&hasHairpin)hairpins++;inCorner=false;hasHairpin=false;}}
  const xs=samples.map(s=>s.x),zs=samples.map(s=>s.z);
  return {controls,samples,length,width:settings.width,corners,hairpins,straightPercent:Math.round(samples.filter(s=>s.kind==='straight').length/n*100),bounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)}};
}

export function nearestOnTrack(track:TrackData,p:Point):{index:number;distance:number;signedDistance:number;sample:TrackSample} {
  let best=Infinity,index=0,signedDistance=0;
  for(let i=0;i<track.samples.length;i++){const a=track.samples[i],b=track.samples[(i+1)%track.samples.length];const dx=b.x-a.x,dz=b.z-a.z;const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));const px=p.x-a.x-dx*t,pz=p.z-a.z-dz*t,d=px*px+pz*pz;if(d<best){best=d;index=i;signedDistance=px*a.nx+pz*a.nz;}}
  return {index,distance:Math.sqrt(best),signedDistance,sample:track.samples[index]};
}

export interface TrackFile { version:1; name:string; points:Point[]; settings:TrackSettings }
export function parseTrackFile(text:string):TrackFile {
  const v=JSON.parse(text);
  if(v.version!==1||!Array.isArray(v.points)||v.points.length<5||v.points.length>4000)throw new Error('不支持的赛道文件。请导入 APEX 导出的 JSON。');
  if(v.points.some((p:any)=>!Number.isFinite(p.x)||!Number.isFinite(p.z)||Math.abs(p.x)>230||Math.abs(p.z)>170))throw new Error('赛道坐标超出了画布范围。');
  const settings={...DEFAULT_SETTINGS,...v.settings};
  const width=Number(settings.width),smoothness=Number(settings.smoothness);
  settings.width=Math.max(6,Math.min(18,Number.isFinite(width)?width:10));settings.smoothness=Math.max(0,Math.min(100,Number.isFinite(smoothness)?smoothness:60));settings.curbs=!!settings.curbs;settings.barriers=!!settings.barriers;
  buildTrack(v.points,settings);
  return {version:1,name:String(v.name||'我的赛道').slice(0,40),points:v.points,settings};
}
