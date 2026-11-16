import type {TrackSample} from './track';
export interface CornerFeature {start:number;end:number;side:number;approach:number}
export interface TrackFeatures {threshold:number;scale:number;left:number[];right:number[];runoffWidth:number[];runoffLeft:number[];runoffRight:number[];gravelLeft:number[];gravelRight:number[];outer:number[];corners:CornerFeature[]}
export function trackFeatures(samples:TrackSample[],length:number):TrackFeatures {
  const n=samples.length,step=length/n,scale=Math.max(1,Math.min(5,(length/1300)**.72)),threshold=.009/scale;
  const turn=samples.map(s=>Math.abs(s.curvature)>threshold?Math.sign(s.curvature):0);
  const left=new Array(n).fill(0),right=new Array(n).fill(0),runoffWidth=new Array(n).fill(0),outer=new Array(n).fill(0),corners:CornerFeature[]=[];
  const runoffLeft=new Array(n).fill(0),runoffRight=new Array(n).fill(0);
  // Both envelopes measure outwards from the kerb and share one generator.
  // The more aggressive gravel profile encloses the asphalt profile.
  const gravelLeft=new Array(n).fill(0),gravelRight=new Array(n).fill(0);
  const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
  const wrap=(i:number)=>(i%n+n)%n,kerbTurn=turn.slice();
  // A short shallow patch within the same bend is not an entry or exit.
  // Keep the original corner markers for braking boards and other scenery.
  for(let start=0;start<n;start++)if(!kerbTurn[start]&&kerbTurn[wrap(start-1)]){
    let count=1;while(count<n&&!kerbTurn[wrap(start+count)])count++;
    const sign=kerbTurn[wrap(start-1)];
    if(count*step<=8*scale&&kerbTurn[wrap(start+count)]===sign)for(let k=0;k<count;k++)kerbTurn[wrap(start+k)]=sign;
  }
  // Only the inside has a kerb through the curved part of a corner.
  for(let i=0;i<n;i++)if(kerbTurn[i]){(kerbTurn[i]>0?left:right)[i]=1;outer[i]=-kerbTurn[i];}
  for(let start=0;start<n;start++){
    const sign=turn[start];if(!sign||turn[(start+n-1)%n]===sign)continue;
    let count=1;
    while(count<n&&turn[(start+count)%n]===sign)count++;
    const end=(start+count-1)%n;let approach=0;
    for(let k=1;k<n&&k*step<2000;k++){if(turn[(start-k+n)%n])break;approach+=step;}
    if(count*step>4*scale)corners.push({start,end,side:-sign,approach});
  }
  for(let start=0;start<n;start++){
    const sign=kerbTurn[start];if(!sign||kerbTurn[wrap(start-1)]===sign)continue;
    let count=1;while(count<n&&kerbTurn[wrap(start+count)]===sign)count++;
    const end=wrap(start+count-1),mask=sign>0?right:left;
    // Outside kerbs occupy the approach and departure straights, never the
    // middle of the bend. Join nearby strips before tapering their free ends.
    const extend=(anchor:number,direction:number,requested:number)=>{
      let gap=0;while(gap<n-count&&!kerbTurn[wrap(anchor+direction*(gap+1))])gap++;
      const reach=Math.min(requested,gap*step);
      for(let k=1;k*step<reach;k++)mask[wrap(anchor+direction*k)]=1;
    };
    extend(start,-1,Math.min(120,24*scale));
    extend(end,1,Math.min(160,32*scale));
  }
  for(const mask of [left,right]){
    // Close short gaps along the same edge, including the lap seam, but
    // never bridge across a curved section on the outside of a corner.
    for(let start=0;start<n;start++)if(!mask[start]&&mask[wrap(start-1)]){
      let count=0,straight=true;
      while(count<n&&!mask[wrap(start+count)]){if(kerbTurn[wrap(start+count)])straight=false;count++;}
      if(straight&&count*step<=12*scale)for(let k=0;k<count;k++)mask[wrap(start+k)]=1;
    }
    // Taper only the exposed ends of the combined strip. Inside kerbs keep
    // their full width, and joined strips have no narrow waist at the join.
    for(let start=0;start<n;start++)if(mask[start]&&!mask[wrap(start-1)]){
      let count=1;while(count<n&&mask[wrap(start+count)])count++;
      const taper=Math.min(4*scale,count*step*.25);
      for(let k=0;k<count;k++){
        const i=wrap(start+k);if(kerbTurn[i])continue;
        mask[i]=smooth(Math.min((k+1)*step,(count-k)*step)/taper);
      }
    }
  }
  // Runoff widths are populated from the driving line by applyRunoffProfile.
  return {threshold,scale,left,right,runoffWidth,runoffLeft,runoffRight,gravelLeft,gravelRight,outer,corners};
}
