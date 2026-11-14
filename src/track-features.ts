import type {TrackSample} from './track';
export interface CornerFeature {start:number;end:number;side:number;approach:number}
export interface TrackFeatures {threshold:number;scale:number;left:number[];right:number[];runoffWidth:number[];runoffLeft:number[];runoffRight:number[];outer:number[];corners:CornerFeature[]}
export function trackFeatures(samples:TrackSample[],length:number):TrackFeatures {
  const n=samples.length,step=length/n,scale=Math.max(1,Math.min(5,(length/1300)**.72)),threshold=.009/scale;
  const turn=samples.map(s=>Math.abs(s.curvature)>threshold?Math.sign(s.curvature):0);
  const left=new Array(n).fill(0),right=new Array(n).fill(0),runoffWidth=new Array(n).fill(0),outer=new Array(n).fill(0),corners:CornerFeature[]=[];
  const runoffLeft=new Array(n).fill(0),runoffRight=new Array(n).fill(0);
  const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
  for(let i=0;i<n;i++)if(turn[i]){left[i]=right[i]=1;outer[i]=-turn[i];}
  for(let start=0;start<n;start++){
    const sign=turn[start];if(!sign||turn[(start+n-1)%n]===sign)continue;
    let count=1,peak=Math.abs(samples[start].curvature);
    while(count<n&&turn[(start+count)%n]===sign){peak=Math.max(peak,Math.abs(samples[(start+count)%n].curvature));count++;}
    const end=(start+count-1)%n;let approach=0;
    for(let k=1;k<n&&k*step<2000;k++){if(turn[(start-k+n)%n])break;approach+=step;}
    if(count*step>4*scale)corners.push({start,end,side:-sign,approach});
    const width=Math.min(24*scale,4*scale+Math.min(12*scale,peak*scale*240)+Math.sqrt(approach)*.85*Math.sqrt(scale));
    // Full width through the corner, with long C2 entry/exit transitions.
    // A quintic envelope has zero first and second derivatives at both ends.
    const taper=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*t*(10+t*(-15+6*t));};
    const envelope=sign>0?runoffRight:runoffLeft;
    const spread=(i:number,value:number)=>{if(!turn[i]||turn[i]===sign){envelope[i]=Math.max(envelope[i],value);if(value>runoffWidth[i]){runoffWidth[i]=value;outer[i]=-sign;}}};
    for(let k=0;k<count;k++)spread((start+k)%n,width);
    const available=(direction:number,from:number,limit:number)=>{for(let k=1;k*step<limit&&k<n;k++){const i=(from+direction*k+n)%n;if(turn[i]&&turn[i]!==sign)return Math.max(step,(k-1)*step);}return limit;};
    const lead=available(-1,start,Math.min(length*.12,Math.max(18*scale,width*2.5))),exit=available(1,end,Math.min(length*.16,Math.max(24*scale,width*3.5)));
    for(let k=1;k*step<=lead+step&&k<n;k++){const i=(start-k+n)%n;if(turn[i]&&turn[i]!==sign)break;spread(i,width*taper(1-k*step/lead));}
    for(let k=1;k*step<=exit+step&&k<n;k++){const i=(end+k)%n;if(turn[i]&&turn[i]!==sign)break;spread(i,width*taper(1-k*step/exit));}
    // Only the outside kerb continues beyond corner exit, tapering to zero.
    const tail=Math.min(70,14*scale),mask=sign>0?right:left;
    for(let k=1;k*step<tail&&k<n;k++){const i=(end+k)%n;if(turn[i])break;mask[i]=Math.max(mask[i],smooth(1-k*step/tail));}
  }
  // A continuously turning oval has no straight-to-turn boundary.
  for(let i=0;i<n;i++)if(turn[i]&&!runoffWidth[i]){runoffWidth[i]=4*scale;(turn[i]>0?runoffRight:runoffLeft)[i]=4*scale;}
  return {threshold,scale,left,right,runoffWidth,runoffLeft,runoffRight,outer,corners};
}
