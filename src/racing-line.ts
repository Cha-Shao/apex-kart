import type {TrackData} from './track';

const cache=new WeakMap<TrackData,number[]>();
const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const ease=(value:number)=>{const t=clamp01(value);return t*t*t*(10+t*(-15+6*t));};

/** A visual outside/apex/outside line, in metres along the centreline normal.
 * Shared by asphalt rubber and kerb wear; it does not steer the car. */
export function racingLineOffsets(track:TrackData):number[]{
  const cached=cache.get(track);if(cached)return cached;
  const {samples,length,width}=track,n=samples.length,step=length/n,limit=Math.max(.4,width/2-.28);
  const turns=samples.map(s=>Math.abs(s.curvature)>track.features.threshold*.75?Math.sign(s.curvature):0);
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
      let weight=0,position=0,heading=0;
      for(let k=0;k<count;k++){
        const curvature=Math.abs(samples[(start+k)%n].curvature),w=curvature*curvature;
        weight+=w;position+=(k+.5)*step*w;
        heading+=curvature*step;
      }
      const span=count*step;
      // Curvature locates the apex; a small late bias gives space to unwind.
      const apex=Math.max(span*.3,Math.min(span*.72,position/(weight||1)*.8+span*.12));
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
  let next=0;
  for(let i=0;i<n;i++){
    const d=samples[i].distance;
    while(next<knots.length&&knots[next].distance<=d)next++;
    const a=knots[(next+knots.length-1)%knots.length],b=knots[next%knots.length];
    const start=a.distance-(next===0?length:0),end=b.distance+(next===knots.length?length:0);
    offsets[i]=a.offset+(b.offset-a.offset)*ease((d-start)/Math.max(.001,end-start));
  }
  return remember();
}
