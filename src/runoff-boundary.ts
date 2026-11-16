import type {RacingLineTrack} from './racing-line';
import type {Point} from './track';

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const ease=(value:number)=>{const t=clamp01(value);return t*t*t*(10+t*(-15+6*t));};
const wrap=(value:number,count:number)=>(value%count+count)%count;
// Scale the completed envelopes so asphalt and the gravel band both halve.
// Cached curves stay unscaled; every sampling pass applies this exactly once.
const RUNOFF_WIDTH_SCALE=.5;

interface ContourPoint extends Point {t:number}
interface RunoffContour {
  pieces:ContourPoint[][];
  requested:number[];
  length:number;
  side:number;
  peak:number;
}
// Features survive the temporary planning object used by buildTrack. Keep
// the world-space curves so render sampling cannot turn them back into lobes.
const contours=new WeakMap<RacingLineTrack['features'],Map<string,RunoffContour|null>>();
const key=(side:number,outer:boolean)=>`${side}:${outer?1:0}`;

/** Shape-preserving sampling is used for support and kerb masks only. The
 * actual outline is sampled from a world-space curve, never a width spline. */
function profileAt(values:number[],position:number){
  const n=values.length,i=Math.floor(position),t=position-i;
  const a=values[wrap(i-1,n)],b=values[wrap(i,n)],c=values[wrap(i+1,n)],d=values[wrap(i+2,n)];
  const slope=(x:number,y:number)=>x*y<=0?0:2*x*y/(x+y),t2=t*t,t3=t2*t;
  return Math.max(0,(2*t3-3*t2+1)*b+(t3-2*t2+t)*slope(b-a,c-b)+(-2*t3+3*t2)*c+(t3-t2)*slope(c-b,d-c));
}

/** A larger material envelope needs a longer entry/exit as well as more
 * width. Compact C2 support lets gravel open earlier without coating straights. */
function materialProfile(track:RacingLineTrack,source:number[],aggressiveness:number){
  const {width,length}=track,n=source.length,step=length/n;
  const requested=source.map(value=>value+width*(aggressiveness-1)*Math.tanh(value/width));
  const lead=Math.min(length*.06,width*(aggressiveness-1)*.95);
  const tail=Math.min(length*.04,width*(aggressiveness-1)*.5);
  if(lead<=0&&tail<=0)return requested;
  return requested.map((value,i)=>{
    let result=value;
    for(let k=-Math.ceil(tail/step);k<=Math.ceil(lead/step);k++){
      if(!k)continue;
      const reach=k>0?lead:tail,distance=Math.abs(k)*step;
      if(distance>=reach)continue;
      result=Math.max(result,requested[wrap(i+k,n)]*(1-ease(distance/reach)));
    }
    return result;
  });
}

/** Cubic B-splines round the complete outside path in world metres. Their
 * convex combinations remove pointed control vertices instead of preserving
 * each raw normal offset as a mandatory lower bound. */
function makeContour(track:RacingLineTrack,requested:number[],side:number,kerbWidth:number):RunoffContour|null{
  const {samples,width,length,features}=track,n=samples.length,step=length/n,peak=Math.max(...requested);
  if(peak<.001)return null;
  const count=Math.max(8,Math.ceil(length/Math.max(2,width*.8))),mask=side>0?features.left:features.right;
  const control:Point[]=Array.from({length:count},(_,k)=>{
    const position=k/count*n,i=Math.floor(position),t=position-i,t2=t*t,t3=t2*t;
    const a=samples[i],b=samples[(i+1)%n];
    const x=(2*t3-3*t2+1)*a.x+(t3-2*t2+t)*step*a.tx+(-2*t3+3*t2)*b.x+(t3-t2)*step*b.tx;
    const z=(2*t3-3*t2+1)*a.z+(t3-2*t2+t)*step*a.tz+(-2*t3+3*t2)*b.z+(t3-t2)*step*b.tz;
    const dx=(6*t2-6*t)*a.x+(3*t2-4*t+1)*step*a.tx+(-6*t2+6*t)*b.x+(3*t2-2*t)*step*b.tx;
    const dz=(6*t2-6*t)*a.z+(3*t2-4*t+1)*step*a.tz+(-6*t2+6*t)*b.z+(3*t2-2*t)*step*b.tz;
    const magnitude=Math.hypot(dx,dz)||1,offset=width*.5+kerbWidth*profileAt(mask,position)+profileAt(requested,position);
    return {x:x-dz/magnitude*side*offset,z:z+dx/magnitude*side*offset};
  });
  const pieces=control.map((b,i)=>{
    const a=control[wrap(i-1,count)],c=control[(i+1)%count],d=control[(i+2)%count];
    const segments=Math.max(6,Math.ceil((Math.hypot(b.x-a.x,b.z-a.z)+Math.hypot(c.x-b.x,c.z-b.z)+Math.hypot(d.x-c.x,d.z-c.z))/3));
    return Array.from({length:segments+1},(_,j)=>{
      const t=j/segments,t2=t*t,t3=t2*t;
      const wa=(1-3*t+3*t2-t3)/6,wb=(4-6*t2+3*t3)/6,wc=(1+3*t+3*t2-3*t3)/6,wd=t3/6;
      return {x:a.x*wa+b.x*wb+c.x*wc+d.x*wd,z:a.z*wa+b.z*wb+c.z*wc+d.z*wd,t};
    });
  });
  return {pieces,requested,length,side,peak};
}

/** Re-intersect the rounded contour with this route's normal rays. Keeping
 * route parameters selects the same leg through hairpins and overpasses. */
function contourWidths(track:RacingLineTrack,contour:RunoffContour|null,kerbWidth:number,minimum?:number[]){
  const {samples,width,features}=track,n=samples.length;
  if(!contour)return minimum?.slice()??new Array<number>(n).fill(0);
  const {pieces,requested,length,side,peak}=contour,count=pieces.length,knotStep=length/count;
  const mask=side>0?features.left:features.right;
  const search=Math.min(Math.floor(count/2),Math.max(2,Math.ceil((width*2+peak)/knotStep)));
  return samples.map((s,i)=>{
    const floor=minimum?.[i]??0,distance=s.distance,support=profileAt(requested,distance/length*requested.length);
    if(support<.001)return floor;
    const nx=s.nx*side,nz=s.nz*side,edge=width*.5+kerbWidth*mask[i],centre=Math.floor(distance/knotStep);
    let best=Infinity,reach=0,fallbackError=Infinity,fallback=0;
    for(let k=centre-search;k<=centre+search;k++){
      const points=pieces[wrap(k,count)];
      for(let j=1;j<points.length;j++){
        const a=points[j-1],b=points[j];
        const u=(a.x-s.x)*s.tx+(a.z-s.z)*s.tz,v=(b.x-s.x)*s.tx+(b.z-s.z)*s.tz;
        const error=Math.abs(u)+Math.abs((k+a.t)*knotStep-distance)*.01;
        if(error<fallbackError){fallbackError=error;fallback=(a.x-s.x)*nx+(a.z-s.z)*nz-edge;}
        if(u*v>0||Math.abs(v-u)<1e-8)continue;
        const t=clamp01(-u/(v-u)),route=(k+a.t+(b.t-a.t)*t)*knotStep,delta=Math.abs(route-distance);
        if(delta<best){
          best=delta;reach=(a.x+(b.x-a.x)*t-s.x)*nx+(a.z+(b.z-a.z)*t-s.z)*nz-edge;
        }
      }
    }
    const extent=Number.isFinite(best)?reach:fallback;
    return Math.max(floor,Math.max(0,extent)*ease(support/(width*.15))*RUNOFF_WIDTH_SCALE);
  });
}

/** Both materials share the same path fitting; aggression adds width and
 * transition length. Store the fitted outline for every later sampling pass. */
export function runoffBoundary(track:RacingLineTrack,source:number[],side:number,kerbWidth:number,aggressiveness:number,minimum?:number[]){
  const contour=makeContour(track,materialProfile(track,source,aggressiveness),side,kerbWidth);
  let paths=contours.get(track.features);
  if(!paths){paths=new Map();contours.set(track.features,paths);}
  paths.set(key(side,!!minimum),contour);
  return contourWidths(track,contour,kerbWidth,minimum);
}

/** Dense rendering, terrain margins and fences must follow the fitted paths
 * themselves; interpolating coarse widths reintroduces corners and bulges. */
export function resampleRunoffBoundaries(source:RacingLineTrack,target:RacingLineTrack,kerbWidth:number){
  const paths=contours.get(source.features);if(!paths)return;
  for(const side of [-1,1]){
    const asphalt=contourWidths(target,paths.get(key(side,false))??null,kerbWidth);
    const gravel=contourWidths(target,paths.get(key(side,true))??null,kerbWidth,asphalt);
    if(side>0){target.features.runoffLeft=asphalt;target.features.gravelLeft=gravel;}
    else{target.features.runoffRight=asphalt;target.features.gravelRight=gravel;}
  }
  contours.set(target.features,paths);
}
