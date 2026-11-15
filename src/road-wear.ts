import * as THREE from 'three';
import type {TrackData} from './track';
import {racingLineOffsets} from './racing-line';
import {surfaceTrack} from './surface-track';

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const smooth=(value:number)=>{const t=clamp(value,0,1);return t*t*(3-2*t);};

/** Route-space rubber atlas: one sample in the asphalt shader, no decal meshes.
 * Distance/lateral coordinates keep every mark on its own road and bridge. */
export function roadWearTexture(track:TrackData,maxTextureSize=8192){
  const route=surfaceTrack(track),{length,width}=track,n=route.samples.length,line=racingLineOffsets(route);
  const canvas=document.createElement('canvas');canvas.width=Math.min(256,maxTextureSize);
  canvas.height=Math.min(8192,maxTextureSize,Math.max(1024,Math.ceil(length*2.5)));
  const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(canvas.width/width,0,0,canvas.height/length,canvas.width/2,0);
  // A circuit always gets the same wear, including after a terrain edit.
  let seed=7319;
  for(const p of track.controls)seed=(Math.imul(seed,31)+Math.round(p.x*17)+Math.round(p.z*29))>>>0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const wrap=(d:number)=>(d%length+length)%length;
  const at=(values:number[],d:number)=>{
    const f=wrap(d)/length*n,i=Math.floor(f),t=f-i;
    return values[i]+(values[(i+1)%n]-values[i])*t;
  };
  const centerLimit=width/2-.94,wheelLimit=width/2-.19;
  const traffic=(d:number)=>at(line,d)*centerLimit/Math.max(.4,width/2-.28);
  const sampleStep=Math.max(.65,length/8192);
  type TrailPoint={d:number;x:number;half:number};

  const trail=(from:number,to:number,offset:(d:number,t:number)=>number,tyreWidth:number,opacity:number,phase:number,loop=false,striations=false)=>{
    const count=Math.max(2,Math.ceil((to-from)/sampleStep)),points:TrailPoint[]=[];
    for(let i=0;i<=count;i++){
      const t=i/count,d=from+(to-from)*t;
      const taper=loop?1:.18+.82*Math.min(smooth(t/.08),smooth((1-t)/.13));
      // Full-lap deposits meet with the same width at the start-line seam.
      const grain=loop?t*Math.PI*2*Math.max(1,Math.round(length*.27)):d*1.7;
      const wear=.87+.09*Math.sin(grain+phase)+.04*Math.sin(grain*3+phase*2);
      points.push({d,x:clamp(offset(d,t),-wheelLimit,wheelLimit),half:tyreWidth*.5*taper*wear});
    }
    const ribbon=(spread:number,shift:number,alpha:number)=>{
      // Draw wrapped copies so entries and exits can straddle the start line.
      const first=Math.ceil(-to/length),last=Math.floor((length-from)/length);
      for(let copy=first;copy<=last;copy++){
        ctx.save();ctx.translate(0,copy*length);
        const gradient=ctx.createLinearGradient(0,from,0,to);
        const ink=(a:number)=>`rgba(255,255,255,${a})`;
        const stops=Math.min(40,Math.max(8,Math.ceil((to-from)/3)));
        for(let k=0;k<=stops;k++){
          const t=k/stops,d=from+(to-from)*t;
          const fade=loop?1:Math.min(smooth(t/.08),smooth((1-t)/.13));
          const coverage=loop?.9+.1*Math.cos(t*Math.PI*14+phase):.38+.62*smooth(.5+.5*Math.sin(d*.72+phase)*Math.cos(d*1.91+phase));
          gradient.addColorStop(t,ink(alpha*fade*coverage));
        }
        ctx.fillStyle=gradient;ctx.beginPath();
        points.forEach((p,i)=>{const x=p.x+shift-p.half*spread;i?ctx.lineTo(x,p.d):ctx.moveTo(x,p.d);});
        for(let i=points.length-1;i>=0;i--){const p=points[i];ctx.lineTo(p.x+shift+p.half*spread,p.d);}
        ctx.closePath();ctx.fill();ctx.restore();
      }
    };
    ribbon(1.65,0,opacity*.16);ribbon(1,0,opacity*.84);
    if(striations){
      // A few longitudinal contact streaks, with the aggregate still visible.
      ribbon(.09,-tyreWidth*.24,opacity*.27);ribbon(.07,tyreWidth*.19,opacity*.22);
    }
  };

  // Older traffic leaves a soft, irregular racing groove, rather than two
  // equally dark rails running around the whole circuit.
  trail(0,length,d=>traffic(d),2.7,.09,0,true);
  for(let lap=0;lap<9;lap++){
    const phase=random()*Math.PI*2,lane=(random()-.5)*1.15,gap=.54+random()*.17;
    const weave=(d:number)=>.17*Math.sin(d/length*Math.PI*6+phase)+.08*Math.sin(d/length*Math.PI*14+phase);
    for(const side of [-1,1])trail(0,length,d=>traffic(d)+lane+weave(d)+side*gap,.18+random()*.1,.035+random()*.025,phase,true);
  }

  const sourceStep=length/track.samples.length,corners=[...track.features.corners];
  // A continuously turning circuit has no straight-to-corner boundaries.
  if(!corners.length&&track.samples.every(s=>Math.abs(s.curvature)>track.features.threshold*.75)){
    for(let i=0;i<4;i++){
      const start=Math.floor(i*track.samples.length/4),end=Math.floor((i+.88)*track.samples.length/4)%track.samples.length;
      corners.push({start,end,side:-Math.sign(track.samples[start].curvature),approach:0});
    }
  }
  for(const corner of corners){
    const start=track.samples[corner.start].distance,span=wrap(track.samples[corner.end].distance-start)+sourceStep;
    let heading=0;
    for(let k=0;k<Math.round(span/sourceStep);k++)heading+=Math.abs(track.samples[(corner.start+k)%track.samples.length].curvature)*sourceStep;
    const severity=clamp(heading/1.65,.2,1),turn=-corner.side;
    const lead=Math.min(corner.approach*.6,width*(1.2+severity)),exit=Math.min(width*1.8,length*.025);
    // Slightly different laps fan in at the apex and spread on corner exit.
    for(let pass=0;pass<10+Math.round(severity*12);pass++){
      const phase=random()*Math.PI*2,lane=(random()-.5)*Math.min(3.6,width*.42),gap=.53+random()*.22;
      const from=start-lead*(.35+random()*.65)+span*random()*.15,to=start+span*(.78+random()*.22)+exit*random();
      const slide=(random()-.5)*(.35+severity*.8),tyreWidth=.17+random()*.14,opacity=.07+random()*.13;
      const path=(d:number,t:number)=>clamp(traffic(d)+lane*(1-.34*Math.sin(t*Math.PI))+slide*Math.sin(t*Math.PI)+.07*Math.sin(t*8+phase),-centerLimit,centerLimit);
      for(const side of [-1,1])trail(from,to,(d,t)=>path(d,t)+side*gap,tyreWidth,opacity,phase,false,pass%3===0);
    }
    // Lockups start on the approach, with different lengths and fading ends.
    if(corner.approach>width*.7)for(let pass=0;pass<2+Math.round(severity*4);pass++){
      const end=start+width*(random()*.55-.3),run=Math.min(corner.approach*.8,width*(1.2+random()*3.2));
      const lane=(random()-.5)*1.5,drift=(random()-.5)*.45,gap=.55+random()*.18,phase=random()*20;
      const opacity=.19+random()*.23,tyreWidth=.18+random()*.11;
      for(const side of [-1,1])trail(end-run,end,(d,t)=>clamp(traffic(d)+lane+drift*t,-centerLimit,centerLimit)+side*gap,tyreWidth,opacity,phase,false,true);
    }
    // A handful of oversteer corrections cross the older arc-shaped deposits.
    for(let pass=0;pass<1+Math.round(severity*3);pass++){
      const from=start+span*(.08+random()*.55),run=Math.min(span*.65+exit,width*(1.2+random()*1.8));
      const lane=(random()-.5)*width*.24,sweep=turn*(.65+random()*1.4),phase=random()*20,gap=.54+random()*.2;
      const opacity=.18+random()*.2,tyreWidth=.16+random()*.1;
      for(const side of [-1,1])trail(from,from+run,(d,t)=>clamp(traffic(d)+lane+sweep*(smooth(t)-.4),-centerLimit,centerLimit)+side*gap,tyreWidth,opacity,phase,false,true);
    }
  }
  const texture=new THREE.CanvasTexture(canvas);texture.name='track-rubber-deposits-and-skids';
  texture.flipY=false;texture.wrapS=THREE.ClampToEdgeWrapping;texture.wrapT=THREE.RepeatWrapping;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  return texture;
}
