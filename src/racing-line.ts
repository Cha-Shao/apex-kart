import type {TrackData} from './track';

export type RacingLineTrack=Pick<TrackData,'samples'|'length'|'width'|'features'>;
const cache=new WeakMap<RacingLineTrack,number[]>();
const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const ease=(value:number)=>{const t=clamp01(value);return t*t*t*(10+t*(-15+6*t));};

/** Shape-preserving interpolation keeps the line smooth without overshooting
 * the road edge. Render samples reuse the same line as kerb/runoff planning. */
export function resampleRacingLine(source:RacingLineTrack,target:RacingLineTrack){
  const values=racingLineOffsets(source),n=values.length;
  cache.set(target,target.samples.map(s=>{
    const f=s.distance/source.length*n,i=Math.floor(f)%n,t=f-Math.floor(f);
    const a=values[(i+n-1)%n],b=values[i],c=values[(i+1)%n],d=values[(i+2)%n];
    const slope=(x:number,y:number)=>x*y<=0?0:2*x*y/(x+y),t2=t*t,t3=t2*t;
    return (2*t3-3*t2+1)*b+(t3-2*t2+t)*slope(b-a,c-b)+(-2*t3+3*t2)*c+(t3-t2)*slope(c-b,d-c);
  }));
}

/** An outside/apex/outside line, in metres along the centreline normal.
 * Shared by asphalt rubber, kerb wear and runoff planning; it does not steer the car. */
export function racingLineOffsets(track:RacingLineTrack):number[]{
  const cached=cache.get(track);if(cached)return cached;
  const {samples,length,width}=track,n=samples.length,step=length/n,limit=Math.max(.4,width/2-.28);
  const turns=samples.map(s=>Math.abs(s.curvature)>track.features.threshold*.75?Math.sign(s.curvature):0);
  // A short flat spot in a compound bend is not another turn-in/apex/exit.
  for(let i=0;i<n;i++)if(!turns[i]&&turns[(i+n-1)%n]){
    let count=1;while(count<n&&!turns[(i+count)%n])count++;
    const side=turns[(i+n-1)%n];
    if(count*step<=width*1.1&&turns[(i+count)%n]===side)for(let k=0;k<count;k++)turns[(i+k)%n]=side;
  }
  const offsets=new Array<number>(n).fill(0);
  const remember=()=>{cache.set(track,offsets);return offsets;};
  const boundary=turns.findIndex((turn,i)=>turn!==turns[(i+n-1)%n]);
  // A continuously turning oval has no distinct entry or exit.
  if(boundary<0){offsets.fill(turns[0]*limit*.9);return remember();}
  const corners:{start:number;span:number;apex:number;side:number}[]=[];
  for(let walked=0;walked<n;){
    const start=(boundary+walked)%n,side=turns[start];let count=1;
    while(walked+count<n&&turns[(start+count)%n]===side)count++;
    if(side&&count*step>=Math.max(2,step*1.25)){
      let heading=0;
      for(let k=0;k<count;k++)heading+=Math.abs(samples[(start+k)%n].curvature)*step;
      const span=count*step;
      // Locate the apex by accumulated heading, so a sharp curvature spike
      // does not pull the whole hairpin toward an early, pinched apex.
      let accumulated=0,apex=span*.52;
      for(let k=0;k<count;k++){
        const angle=Math.abs(samples[(start+k)%n].curvature)*step;
        if(accumulated+angle>=heading*.52){apex=(k+clamp01((heading*.52-accumulated)/Math.max(1e-8,angle)))*step;break;}
        accumulated+=angle;
      }
      apex=Math.max(span*.25,Math.min(span*.78,apex));
      if(heading>.12)corners.push({start:samples[start].distance,span,apex,side});
    }
    walked+=count;
  }
  if(!corners.length)return remember();
  corners.sort((a,b)=>a.start-b.start);
  const anchors:{distance:number;offset:number;priority:number}[]=[];
  const wrap=(distance:number)=>(distance%length+length)%length;
  const add=(distance:number,offset:number,priority:number)=>anchors.push({distance:wrap(distance),offset,priority});
  for(let i=0;i<corners.length;i++){
    const corner=corners[i],previous=corners[(i+corners.length-1)%corners.length],next=corners[(i+1)%corners.length];
    const before=Math.max(0,(corners.length===1?length:wrap(corner.start-previous.start))-previous.span);
    const after=Math.max(0,(corners.length===1?length:wrap(next.start-corner.start))-corner.span);
    // Linked bends connect apex to apex instead of demanding an abrupt trip
    // to the opposite edge between two closely spaced corners.
    if(before>width*1.2)add(corner.start-Math.min(width*.4,before*.2),-corner.side*limit*.96,1);
    add(corner.start+corner.apex,corner.side*limit,2);
    if(after>width*1.2)add(corner.start+corner.span+Math.min(width*.55,after*.2),-corner.side*limit*.96,1);
  }
  anchors.sort((a,b)=>a.distance-b.distance||b.priority-a.priority);
  // Keep coincident entry/exit anchors from creating a zero-length span.
  const knots:typeof anchors=[];
  for(const anchor of anchors){
    const last=knots[knots.length-1];
    if(last&&anchor.distance-last.distance<.01){if(anchor.priority>last.priority)knots[knots.length-1]=anchor;}
    else knots.push(anchor);
  }
  if(knots.length===1){offsets.fill(knots[0].offset);return remember();}
  const pose=(distance:number,offset:number)=>{
    const f=wrap(distance)/step,i=Math.floor(f)%n,j=(i+1)%n,t=f-Math.floor(f),a=samples[i],b=samples[j];
    let tx=a.tx+(b.tx-a.tx)*t,tz=a.tz+(b.tz-a.tz)*t;
    const magnitude=Math.hypot(tx,tz)||1;tx/=magnitude;tz/=magnitude;
    return {x:a.x+(b.x-a.x)*t-tz*offset,z:a.z+(b.z-a.z)*t+tx*offset,tx,tz};
  };
  // Fit actual world-space arcs with road-aligned tangents. Interpolating only
  // the normal offset makes a hairpin inherit the centreline's tight S-shape.
  const arcs=knots.map((a,i)=>{
    const b=knots[(i+1)%knots.length],p=pose(a.distance,a.offset),q=pose(b.distance,b.offset);
    const dx=q.x-p.x,dz=q.z-p.z,chord=Math.hypot(dx,dz),cross=p.tx*q.tz-p.tz*q.tx;
    let first=chord/3,last=chord/3;
    if(Math.abs(cross)>1e-4){
      const alongFirst=(dx*q.tz-dz*q.tx)/cross,alongLast=(p.tx*dz-p.tz*dx)/cross;
      if(alongFirst>0&&alongLast>0){
        const cosine=Math.sqrt(Math.max(0,(1+p.tx*q.tx+p.tz*q.tz)/2));
        const handle=4/3*cosine/(1+cosine);
        first=Math.min(chord*.9,alongFirst*handle);last=Math.min(chord*.9,alongLast*handle);
      }
    }
    const c={x:p.x+p.tx*first,z:p.z+p.tz*first},d={x:q.x-q.tx*last,z:q.z-q.tz*last};
    return {x:p.x,z:p.z,ax:-p.x+3*c.x-3*d.x+q.x,az:-p.z+3*c.z-3*d.z+q.z,
      bx:3*p.x-6*c.x+3*d.x,bz:3*p.z-6*c.z+3*d.z,cx:3*(c.x-p.x),cz:3*(c.z-p.z)};
  });
  let next=0;
  for(let i=0;i<n;i++){
    const d=samples[i].distance;
    while(next<knots.length&&knots[next].distance<=d)next++;
    const a=knots[(next+knots.length-1)%knots.length],b=knots[next%knots.length];
    const start=a.distance-(next===0?length:0),end=b.distance+(next===knots.length?length:0);
    const u=clamp01((d-start)/Math.max(.001,end-start)),s=samples[i],arc=arcs[(next+knots.length-1)%knots.length];
    // Intersect this route station's normal with the cubic, rather than using
    // the cubic parameter as route distance (they advance at different rates).
    const pa=arc.ax*s.tx+arc.az*s.tz,pb=arc.bx*s.tx+arc.bz*s.tz,pc=arc.cx*s.tx+arc.cz*s.tz,pd=(arc.x-s.x)*s.tx+(arc.z-s.z)*s.tz;
    const project=(t:number)=>((pa*t+pb)*t+pc)*t+pd,qa=3*pa,qb=2*pb,qc=pc;
    const cuts=[0,1],addCut=(t:number)=>{if(t>0&&t<1)cuts.push(t);};
    if(Math.abs(qa)<1e-8){if(Math.abs(qb)>1e-8)addCut(-qc/qb);}
    else{
      const discriminant=qb*qb-4*qa*qc;
      if(discriminant>=0){const root=Math.sqrt(discriminant);addCut((-qb-root)/(2*qa));addCut((-qb+root)/(2*qa));}
    }
    cuts.sort((a,b)=>a-b);
    let parameter=-1,best=Infinity;
    for(let k=1;k<cuts.length;k++){
      let low=cuts[k-1],high=cuts[k],left=project(low);
      if(left*project(high)>0)continue;
      for(let pass=0;pass<18;pass++){
        const middle=(low+high)/2,value=project(middle);
        if(left*value<=0)high=middle;else{low=middle;left=value;}
      }
      const t=(low+high)/2,error=Math.abs(t-u);
      if(error<best){best=error;parameter=t;}
    }
    const t=parameter,x=((arc.ax*t+arc.bx)*t+arc.cx)*t+arc.x,z=((arc.az*t+arc.bz)*t+arc.cz)*t+arc.z;
    const offset=t>=0?(x-s.x)*s.nx+(z-s.z)*s.nz:a.offset+(b.offset-a.offset)*ease(u);
    offsets[i]=Math.max(-limit,Math.min(limit,offset));
  }
  return remember();
}
