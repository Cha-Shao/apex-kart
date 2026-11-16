import type {RacingLineTrack} from './racing-line';

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));

/** Fixed world-metre kernels preserve the mean width and treat the lap seam
 * exactly like the rest of the boundary, regardless of sample density. */
function boundaryFilter(count:number,step:number,reach:number){
  const radius=Math.min(Math.floor((count-1)/2),Math.ceil(reach/step));
  const weights=Array.from({length:radius*2+1},(_,i)=>Math.max(0,1-((i-radius)*step/reach)**2)**3);
  const total=weights.reduce((sum,w)=>sum+w,0);
  return (values:number[])=>values.map((_,i)=>{
    let sum=0;
    for(let k=-radius;k<=radius;k++)sum+=values[(i+k+count)%count]*weights[k+radius];
    return sum/total;
  });
}

/** Both materials use the same recovery envelope and contour fairing. A value
 * of 1 keeps the baseline extent; higher aggression adds a bounded outer band.
 * Smoothing the actual outline also removes waves caused by normal changes. */
export function runoffBoundary(track:RacingLineTrack,source:number[],side:number,kerbWidth:number,aggressiveness:number,minimum?:number[]){
  const {samples,width,length,features}=track,n=samples.length,step=length/n;
  const requested=source.map(value=>value+width*(aggressiveness-1)*Math.tanh(value/width));
  const floor=minimum??new Array<number>(n).fill(0),peak=Math.max(...requested);
  if(peak<.001)return floor.slice();
  // Broader runoffs need proportionally longer transitions. Filtering the
  // whole envelope also bridges small dents between adjacent recovery lobes.
  const widthReach=Math.min(length*.06,Math.max(step*3,width*5,peak*2));
  const smoothWidth=boundaryFilter(n,step,widthReach);
  let outer=smoothWidth(smoothWidth(requested)).map((value,i)=>Math.max(floor[i],value));
  const mask=side>0?features.left:features.right;
  const base=samples.map((s,i)=>{
    const edge=width*.5+kerbWidth*mask[i];
    return {x:s.x+s.nx*side*edge,z:s.z+s.nz*side*edge};
  });
  const active=outer.map((value,i)=>{
    const t=clamp01((value-floor[i])/(width*.5));return t*t*(3-2*t);
  });
  const shapeReach=Math.min(length*.025,Math.max(step*3,width*2.5,peak));
  const smoothShape=boundaryFilter(n,step,shapeReach);
  const relax=(strength:number)=>{
    const x=outer.map((value,i)=>base[i].x+samples[i].nx*side*value);
    const z=outer.map((value,i)=>base[i].z+samples[i].nz*side*value);
    const sx=smoothShape(x),sz=smoothShape(z);
    outer=outer.map((value,i)=>{
      const s=samples[i],normalMove=((sx[i]-x[i])*s.nx+(sz[i]-z[i])*s.nz)*side;
      return Math.max(floor[i],value+normalMove*strength*active[i]);
    });
  };
  // Paired smoothing/inflation suppresses short boundary waves without the
  // steady shrinkage of repeated averaging. Respect the inner material edge.
  for(let pass=0;pass<6;pass++){relax(.5);relax(-.5);}
  return outer;
}
