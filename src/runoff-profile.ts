import {racingLineOffsets,type RacingLineTrack} from './racing-line';
import type {Point} from './track';

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const angle=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));

/** Estimate a design speed and sweep recoverable driving errors around the
 * rubbered line. This runs when a circuit is built, never in the driving loop.
 * It is a layout estimate, independent of the player's current car or speed. */
export function applyRunoffProfile(track:RacingLineTrack,kerbWidth:number){
  const {samples,features,length,width}=track,n=samples.length,step=length/n;
  const wrap=(i:number)=>(i%n+n)%n,line=racingLineOffsets(track);
  const points:Point[]=samples.map((s,i)=>({x:s.x+s.nx*line[i],z:s.z+s.nz*line[i]}));
  const radius=Math.max(1,Math.ceil(Math.min(4,width*.3)/step));
  const heading:number[]=[],curvature:number[]=[],segment:number[]=[];
  for(let i=0;i<n;i++){
    const a=points[wrap(i-radius)],b=points[i],c=points[wrap(i+radius)];
    const ax=b.x-a.x,az=b.z-a.z,bx=c.x-b.x,bz=c.z-b.z;
    heading.push(Math.atan2(c.z-a.z,c.x-a.x));
    curvature.push(2*(ax*bz-az*bx)/Math.max(.001,Math.hypot(ax,az)*Math.hypot(bx,bz)*Math.hypot(c.x-a.x,c.z-a.z)));
    const next=points[wrap(i+1)];segment.push(Math.max(step*.35,Math.hypot(next.x-b.x,next.z-b.z)));
  }
  const lateral=11,braking=8,acceleration=3.6,topSpeed=Math.min(90,27*Math.sqrt(features.scale));
  const speed=curvature.map(k=>Math.min(topSpeed,Math.sqrt(lateral/Math.max(.0005,Math.abs(k)))));
  // Propagate braking backwards and acceleration forwards across the lap seam.
  for(let pass=0;pass<3;pass++){
    for(let i=n-1;i>=0;i--){const j=wrap(i+1);speed[i]=Math.min(speed[i],Math.sqrt(speed[j]**2+2*braking*segment[i]));}
    for(let i=0;i<n;i++){const j=wrap(i+1);speed[j]=Math.min(speed[j],Math.sqrt(speed[i]**2+2*acceleration*segment[i]));}
  }
  const left=new Array<number>(n).fill(0),right=new Array<number>(n).fill(0);
  const maxWidth=Math.min(width*2.2,16*Math.sqrt(features.scale));
  for(let i=0;i<n;i++){
    const k=samples[i].curvature,risk=clamp((Math.abs(k)/features.threshold-.5)/.9,0,1);
    // A small recovery shoulder follows cornering load, rather than assigning
    // every corner the same large apron. Straight sections have no baseline.
    const shoulder=risk*(width*.12+Math.min(3,speed[i]**2*Math.abs(k)*.16)+speed[i]**2/(2*braking)*.045);
    (k>0?right:left)[i]=Math.min(maxWidth,shoulder);
  }
  const stride=Math.max(1,Math.round(2.5/step)),dt=.12;
  for(let seed=0;seed<n;seed+=stride){
    const ahead=wrap(seed+Math.max(1,Math.round(speed[seed]*.65/step)));
    if(Math.max(Math.abs(samples[seed].curvature),Math.abs(samples[ahead].curvature))<features.threshold*.65)continue;
    // Preserve the original asphalt apron, including both driving errors.
    for(const [overspeed,reaction,deceleration] of [[1.12,.24,8],[1.25,.42,6.5]]){
      let x=points[seed].x,z=points[seed].z,yaw=heading[seed],v=speed[seed]*overspeed,reference=seed,progress=0,cursor=seed,travel=0;
      const travelLimit=Math.min(length*.18,v*reaction+v*v/(2*deceleration)+width);
      for(let time=0;time<6&&v>3&&travel<travelLimit;time+=dt){
        const index=wrap(reference),next=wrap(reference+1),t=clamp(progress/segment[index],0,1);
        const desiredHeading=heading[index]+angle(heading[next]-heading[index])*t;
        const desiredYaw=(curvature[index]+(curvature[next]-curvature[index])*t)*v+angle(desiredHeading-yaw)*1.8;
        const rate=time<reaction?0:clamp(desiredYaw,-lateral*.88/v,lateral*.88/v),distance=v*dt;
        x+=Math.cos(yaw+rate*dt*.5)*distance;z+=Math.sin(yaw+rate*dt*.5)*distance;yaw+=rate*dt;
        travel+=distance;progress+=distance;
        while(progress>=segment[wrap(reference)]){progress-=segment[wrap(reference)];reference++;}
        if(time>=reaction)v=Math.max(0,v-deceleration*dt);
        // Keep projection on this stretch of the route. A global nearest point
        // can jump to another leg of a hairpin or to an overpass.
        const search=Math.max(2,Math.ceil((distance+width*.65)/step));let best=Infinity,bestIndex=cursor,bestLateral=0;
        for(let k=cursor-search;k<=cursor+search;k++){
          if(Math.abs(k-seed)*step>travelLimit+width)continue;
          const i=wrap(k),j=wrap(k+1),a=samples[i],b=samples[j],dx=b.x-a.x,dz=b.z-a.z;
          const u=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1),px=a.x+dx*u,pz=a.z+dz*u,d=(x-px)**2+(z-pz)**2;
          if(d<best){best=d;bestIndex=k;bestLateral=((x-px)*-dz+(z-pz)*dx)/(Math.hypot(dx,dz)||1);}
        }
        cursor=bestIndex;
        const i=wrap(cursor),side=bestLateral>=0?1:-1,edge=width*.5+kerbWidth*(side>0?features.left:features.right)[i];
        const excursion=Math.abs(bestLateral)+1.1-edge;
        if(excursion>0&&best<Math.pow(width*.5+maxWidth+2,2)){
          const envelope=side>0?left:right;envelope[i]=Math.max(envelope[i],Math.min(maxWidth,excursion));
        }
      }
    }
  }
  // Compact C2 kernels round both ends, including at the lap seam and through
  // reversing bends. Unlike a sign-based cutoff, they reach zero tangentially.
  const smooth=(values:number[])=>values.map((_,i)=>{
    const reach=Math.min(length*.08,Math.max(width*1.3,speed[i]*.55)),count=Math.ceil(reach/step);
    let sum=0,weight=0;
    for(let k=-count;k<=count;k++){
      const q=Math.abs(k*step)/reach;if(q>=1)continue;
      const w=Math.pow(1-q*q,3);sum+=values[wrap(i+k)]*w;weight+=w;
    }
    return sum/Math.max(.001,weight);
  });
  features.runoffLeft=smooth(smooth(left));features.runoffRight=smooth(smooth(right));
  // Add gravel beyond the existing asphalt rather than replacing part of it.
  // The bounded band tapers with the apron and stays absent on bare straights.
  const gravelOuter=(apron:number)=>apron+width*.8*Math.tanh(apron/width);
  features.gravelLeft=features.runoffLeft.map(gravelOuter);
  features.gravelRight=features.runoffRight.map(gravelOuter);
  for(let i=0;i<n;i++){
    const a=features.gravelLeft[i],b=features.gravelRight[i];features.runoffWidth[i]=Math.max(a,b);features.outer[i]=a>b?1:b>a?-1:0;
  }
}
