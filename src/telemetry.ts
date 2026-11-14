export interface PedalSample {time:number;throttle:number;brake:number;demand:number}
export class PedalHistory {
  samples:PedalSample[]=[];
  elapsed=0;
  private interval=0;
  reset(){this.samples=[];this.elapsed=0;this.interval=0;}
  record(dt:number,throttle:number,brake:number,demand=brake){
    this.elapsed+=dt;this.interval+=dt;if(this.interval<.05)return;this.interval%=.05;
    const clamp=(n:number)=>Math.max(0,Math.min(1,n));
    this.samples.push({time:this.elapsed,throttle:clamp(throttle),brake:clamp(brake),demand:clamp(demand)});
    while(this.samples.length&&this.samples[0].time<this.elapsed-10)this.samples.shift();
  }
  draw(canvas:HTMLCanvasElement){
    const c=canvas.getContext('2d')!,w=canvas.width,h=canvas.height,left=27,right=9,top=9,bottom=19,width=w-left-right,height=h-top-bottom;
    c.clearRect(0,0,w,h);c.font='9px monospace';c.lineWidth=1;c.textAlign='right';c.fillStyle='#a4acab';
    for(const v of [0,.5,1]){const y=top+height*(1-v);c.fillText(`${v*100}`,left-6,y+3);c.strokeStyle='#e8efee24';c.beginPath();c.moveTo(left,y);c.lineTo(w-right,y);c.stroke();}
    c.textAlign='center';
    for(let s=-10;s<=0;s+=2){const x=left+width*(1+s/10);c.fillText(s===0?'现在':`${s}s`,x,h-4);c.strokeStyle='#e8efee14';c.beginPath();c.moveTo(x,top);c.lineTo(x,top+height);c.stroke();}
    const x=(p:PedalSample)=>left+width*(1+(p.time-this.elapsed)/10),y=(v:number)=>top+height*(1-v);
    c.save();c.beginPath();c.rect(left,top,width,height);c.clip();
    c.fillStyle='#f4937c20';c.beginPath();
    this.samples.forEach((p,i)=>i?c.lineTo(x(p),y(Math.max(p.brake,p.demand))):c.moveTo(x(p),y(Math.max(p.brake,p.demand))));
    for(let i=this.samples.length-1;i>=0;i--){const p=this.samples[i];c.lineTo(x(p),y(p.brake));}c.closePath();c.fill();
    for(const [key,color,dashed] of [['demand','#cbd3ce90',true],['throttle','#d6c16d',false],['brake','#f4937c',false]] as const){
      c.strokeStyle=color;c.lineWidth=dashed?1:2;c.lineJoin='round';c.setLineDash(dashed?[4,3]:[]);c.beginPath();
      this.samples.forEach((p,i)=>i?c.lineTo(x(p),y(p[key])):c.moveTo(x(p),y(p[key])));c.stroke();
    }
    c.restore();
  }
}
