import type {TrackData} from './track';
import {surfaceTrack} from './surface-track';

/** Shared by the painted grid and the vehicle's starting position. */
export function startGridSlots(trackWidth:number){
  const width=Math.min(2.6,trackWidth*.28),length=Math.min(3.8,trackWidth*.36),spacing=Math.max(4.2,length+2),slots=[];
  for(let row=0;row<5;row++)for(const side of [-1,1]){
    const front=-(row+1)*spacing-(side>0?spacing*.5:0),back=front-length,center=side*trackWidth*.23;
    slots.push({front,back,center,left:center-width/2,right:center+width/2});
  }
  return slots;
}

export function firstGridPose(track:TrackData){
  const slot=startGridSlots(track.width)[0],rendered=surfaceTrack(track),samples=rendered.samples;
  const distance=(slot.front+slot.back)*.5,progress=((distance/track.length)%1+1)%1,f=progress*samples.length,i=Math.floor(f),t=f-i;
  const a=samples[i],b=samples[(i+1)%samples.length],tx=a.tx+(b.tx-a.tx)*t,tz=a.tz+(b.tz-a.tz)*t,length=Math.hypot(tx,tz)||1;
  const nx=a.nx+(b.nx-a.nx)*t,nz=a.nz+(b.nz-a.nz)*t;
  return {index:Math.floor(progress*track.samples.length),sample:{...a,x:a.x+(b.x-a.x)*t+nx*slot.center,z:a.z+(b.z-a.z)*t+nz*slot.center,tx:tx/length,tz:tz/length,nx:-tz/length,nz:tx/length,distance:progress*track.length}};
}
