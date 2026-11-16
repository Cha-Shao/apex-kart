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
    let count=1;
    while(count<n&&turn[(start+count)%n]===sign)count++;
    const end=(start+count-1)%n;let approach=0;
    for(let k=1;k<n&&k*step<2000;k++){if(turn[(start-k+n)%n])break;approach+=step;}
    if(count*step>4*scale)corners.push({start,end,side:-sign,approach});
    // Only the outside kerb continues beyond corner exit, tapering to zero.
    const tail=Math.min(70,14*scale),mask=sign>0?right:left;
    for(let k=1;k*step<tail&&k<n;k++){const i=(end+k)%n;if(turn[i])break;mask[i]=Math.max(mask[i],smooth(1-k*step/tail));}
  }
  // Runoff widths are populated from the driving line by applyRunoffProfile.
  return {threshold,scale,left,right,runoffWidth,runoffLeft,runoffRight,outer,corners};
}
