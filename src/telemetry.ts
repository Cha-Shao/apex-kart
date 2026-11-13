export interface PedalSample {time:number;throttle:number;brake:number}
export class PedalHistory {
  samples:PedalSample[]=[];
  elapsed=0;
  private interval=0;
  reset(){this.samples=[];this.elapsed=0;this.interval=0;}
  record(dt:number,throttle:number,brake:number){this.elapsed+=dt;this.interval+=dt;if(this.interval<.05)return;this.interval%=.05;this.samples.push({time:this.elapsed,throttle:Math.max(0,Math.min(1,throttle)),brake:Math.max(0,Math.min(1,brake))});while(this.samples.length&&this.samples[0].time<this.elapsed-10)this.samples.shift();}
  draw(canvas:HTMLCanvasElement){const c=canvas.getContext('2d')!,w=canvas.width,h=canvas.height,left=27,right=9,top=9,bottom=19,width=w-left-right,height=h-top-bottom;c.clearRect(0,0,w,h);c.font='9px monospace';c.lineWidth=1;c.textAlign='right';c.fillStyle='#a4acab';for(const v of [0,.5,1]){const y=top+height*(1-v);c.fillText(`${v*100}`,left-6,y+3);c.strokeStyle='#e8efee24';c.beginPath();c.moveTo(left,y);c.lineTo(w-right,y);c.stroke();}c.textAlign='center';for(let s=-10;s<=0;s+=2){const x=left+width*(1+s/10);c.fillText(s===0?'现在':`${s}s`,x,h-4);c.strokeStyle='#e8efee14';c.beginPath();c.moveTo(x,top);c.lineTo(x,top+height);c.stroke();}for(const [key,color] of [['throttle','#d6c16d'],['brake','#f4937c']] as const){c.strokeStyle=color;c.lineWidth=2;c.lineJoin='round';c.beginPath();this.samples.forEach((p,i)=>{const x=left+width*(1+(p.time-this.elapsed)/10),y=top+height*(1-p[key]);i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();}}
}
