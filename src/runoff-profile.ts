import type {RacingLineTrack} from './racing-line';
import {runoffBoundary} from './runoff-boundary';

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const ease=(value:number)=>{const t=clamp(value,0,1);return t*t*t*(10+t*(-15+6*t));};
// One generator for both materials: 1 is the baseline recovery envelope.
const RUNOFF_AGGRESSIVENESS={asphalt:1,gravel:4.2} as const;

/** Squared speed is the approach score: acceleration adds 2*a*distance on
 * straights and fast bends; a corner spends it at a finite braking rate.
 * Unlike the normal driving profile, this never brakes for a future corner. */
function approachSpeeds(limits:number[],step:number,acceleration:number,braking:number){
  const speeds=new Array<number>(limits.length);
  const lap=(initial:number,record=false)=>{
    let score=initial;
    for(let i=0;i<limits.length;i++){
      if(record)speeds[i]=Math.sqrt(score);
      const limit=limits[i];
      score=score>limit?Math.max(limit,score-2*braking*step):Math.min(limit,score+2*acceleration*step);
    }
    return score;
  };
  // Solve the closed lap before recording, so neither the score nor its
  // release depends on where the start line happens to split an approach.
  let low=Math.min(...limits),high=Math.max(...limits);
  for(let pass=0;pass<24&&high-low>.001;pass++){
    const middle=(low+high)/2,end=lap(middle);
    if(Math.abs(end-middle)<.001){low=high=middle;break;}
    if(end>middle)low=middle;else high=middle;
  }
  lap((low+high)/2,true);
  return speeds;
}

/** Estimate approach energy and form one continuous outside recovery path
 * per bend. This runs when a circuit is built, never in the driving loop.
 * It is a layout estimate, independent of the player's current car or speed. */
export function applyRunoffProfile(track:RacingLineTrack,kerbWidth:number){
  const {samples,features,length,width}=track,n=samples.length,step=length/n;
  const wrap=(i:number)=>(i%n+n)%n;
  const lateral=11,braking=8,acceleration=3.6,topSpeed=Math.min(90,27*Math.sqrt(features.scale));
  // Centreline bend radius determines whether the road itself forces a
  // slowdown. Mild bends retain their score instead of resetting a straight.
  const cornerLimits=samples.map(s=>Math.min(topSpeed**2,lateral/Math.max(.0005,Math.abs(s.curvature))));
  const approach=approachSpeeds(cornerLimits,step,acceleration,braking);
  const left=new Array<number>(n).fill(0),right=new Array<number>(n).fill(0);
  const turns=samples.map(s=>Math.abs(s.curvature)>features.threshold*.65?Math.sign(s.curvature):0);
  // Tiny heading jitters must not split one recovery path into separate lobes.
  for(let start=0;start<n;start++)if(turns[start]&&turns[start]!==turns[wrap(start-1)]){
    const turn=turns[start];let count=1,total=Math.abs(samples[start].curvature)*step;
    while(count<n&&turns[wrap(start+count)]===turn){total+=Math.abs(samples[wrap(start+count)].curvature)*step;count++;}
    if(total<.1&&count*step<width)for(let k=0;k<count;k++)turns[wrap(start+k)]=0;
  }
  // A shallow patch within a compound bend must not restart its envelope.
  // Keep substantial straights and every change of turning direction separate.
  const bridgeLength=Math.max(width*2,topSpeed*.65);
  for(let i=0;i<n;i++)if(!turns[i]&&turns[wrap(i-1)]){
    let count=1;while(count<n&&!turns[wrap(i+count)])count++;
    if(count*step<=bridgeLength&&turns[wrap(i+count)]===turns[wrap(i-1)]){
      for(let k=0;k<count;k++)turns[wrap(i+k)]=turns[wrap(i-1)];
    }
  }
  const boundary=turns.findIndex((turn,i)=>turn!==turns[wrap(i-1)]);
  const corners:{start:number;count:number;side:number;angles:number[];total:number}[]=[];
  if(boundary>=0)for(let walked=0;walked<n;){
    const start=wrap(boundary+walked),turn=turns[start];let count=1;
    while(walked+count<n&&turns[wrap(start+count)]===turn)count++;
    if(turn){
      const angles=[0];
      for(let k=0;k<count;k++)angles.push(angles[k]+Math.abs(samples[wrap(start+k)].curvature)*step);
      const total=angles[count];
      if(total>.3&&count*step>=Math.max(2,step*1.25))corners.push({start,count,side:-turn,angles,total});
    }
    walked+=count;
  }
  // A circle has no entry/exit event; give it only a modest outside shoulder.
  if(boundary<0&&turns[0])for(let i=0;i<n;i++){
    (turns[0]>0?right:left)[i]=width*.15*clamp(approach[i]**2*Math.abs(samples[i].curvature)/lateral,0,1);
  }
  for(const corner of corners){
    const {start,count,side,angles,total}=corner,entrySquared=approach[start]**2;
    let safeSquared=topSpeed**2,peakDemand=0;
    for(let k=0;k<count;k++){
      const i=wrap(start+k);safeSquared=Math.min(safeSquared,cornerLimits[i]);
      peakDemand=Math.max(peakDemand,entrySquared*Math.abs(samples[i].curvature)/lateral);
    }
    const severity=ease((total-.25)/.9)*ease((peakDemand-.45)/.7);
    if(severity<.03)continue;
    // Inherited energy sets one scale for the whole bend. Never take the
    // farthest of independent traces: that makes lobes and pinched joins.
    const reserve=Math.max(0,entrySquared-safeSquared)/(2*braking);
    const peakWidth=Math.min(width*3,24*Math.sqrt(features.scale),width*.32+reserve*.48)*severity;
    let gap=0;while(gap<n-count&&!turns[wrap(start+count+gap)])gap++;
    const tailLength=Math.min(gap*step,length*.035,Math.max(width*2,Math.sqrt(entrySquared)*.8));
    const tail=Math.ceil(tailLength/step),envelope=side>0?left:right,exitRatio=.32;
    for(let k=0;k<count+tail;k++){
      const i=wrap(start+k);let offset:number;
      // A short available exit blends back within the corner as well as its
      // tail, keeping both pieces continuous before the next turning event.
      const room=Math.max(0,(count-k)*step+tailLength),exitFade=ease(room/(width*1.25));
      if(k<count){
        const phase=angles[k]/total;
        // A single C2 curve opens gently on entry, peaks at the turning
        // midpoint, then retains a smaller recovery lane through the exit.
        const opening=ease((phase-.1)/.44),closing=1-(1-exitRatio)*ease((phase-.54)/.46);
        offset=peakWidth*opening*closing*exitFade;
      }else{
        offset=peakWidth*exitRatio*(1-ease(((k-count)*step)/tailLength))*exitFade;
      }
      envelope[i]=Math.max(envelope[i],offset);
    }
  }
  // Generate and fair both outlines identically, changing only aggression.
  // The gravel floor keeps their shared material seam continuous.
  features.runoffLeft=runoffBoundary(track,left,1,kerbWidth,RUNOFF_AGGRESSIVENESS.asphalt);
  features.runoffRight=runoffBoundary(track,right,-1,kerbWidth,RUNOFF_AGGRESSIVENESS.asphalt);
  features.gravelLeft=runoffBoundary(track,left,1,kerbWidth,RUNOFF_AGGRESSIVENESS.gravel,features.runoffLeft);
  features.gravelRight=runoffBoundary(track,right,-1,kerbWidth,RUNOFF_AGGRESSIVENESS.gravel,features.runoffRight);
  for(let i=0;i<n;i++){
    const a=features.gravelLeft[i],b=features.gravelRight[i];features.runoffWidth[i]=Math.max(a,b);features.outer[i]=a>b?1:b>a?-1:0;
  }
}
