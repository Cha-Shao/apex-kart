// Original noise-excited rubber friction, with broad non-harmonic resonances.
// No continuous sine-wave whistle and no external audio samples.
class FrictionBand {
  constructor(){this.z1=0;this.z2=0;this.b0=0;this.b2=0;this.a1=0;this.a2=0;}
  tune(sr,hz,q){const w=2*Math.PI*hz/sr,alpha=Math.sin(w)/(2*q),a0=1+alpha;this.b0=alpha/a0;this.b2=-this.b0;this.a1=-2*Math.cos(w)/a0;this.a2=(1-alpha)/a0;}
  sample(x){const y=this.b0*x+this.z1;this.z1=-this.a1*y+this.z2;this.z2=this.b2*x-this.a2*y;return y;}
}
export class TyreSqueal {
  constructor(sampleRate=48000){
    this.sampleRate=sampleRate;this.speed=0;this.slipL=0;this.slipR=0;
    this.targetL=0;this.targetR=0;this.gainL=0;this.gainR=0;
    this.seed=0x3c6ef372;this.jitter=0;this.jitterTarget=0;this.grain=0;this.grainTarget=0;this.grainClock=0;
    this.lowL=0;this.lowR=0;this.highL=0;this.highR=0;
    this.bandsL=[new FrictionBand(),new FrictionBand(),new FrictionBand()];
    this.bandsR=[new FrictionBand(),new FrictionBand(),new FrictionBand()];
  }
  noise(){this.seed=(Math.imul(this.seed,1664525)+1013904223)|0;return (this.seed>>>0)/2147483648-1;}
  set({speed=0,squealLeft=0,squealRight=0,running=false,enabled=false}={}){
    this.speed=Math.max(0,speed);this.slipL=Math.max(0,Math.min(1,squealLeft));this.slipR=Math.max(0,Math.min(1,squealRight));
    const active=running&&enabled&&this.speed>12,volume=.10+.15*Math.min(1,Math.max(0,(this.speed-12)/100));
    this.targetL=active?this.slipL*volume:0;this.targetR=active?this.slipR*volume:0;
  }
  mix(left,right){
    const sr=this.sampleRate,count=left.length;
    if(this.targetL===0&&this.targetR===0&&this.gainL<1e-6&&this.gainR<1e-6)return;
    const attack=1-Math.exp(-1/(sr*.035)),release=1-Math.exp(-1/(sr*.12));
    const speed=Math.min(1,this.speed/180),slip=Math.max(this.slipL,this.slipR),shift=1+this.jitter*.035;
    const fundamental=(480+110*slip+45*speed)*shift,q=2.4+slip*2.8;
    this.bandsL[0].tune(sr,fundamental,q);this.bandsL[1].tune(sr,fundamental*1.83,q*.75);this.bandsL[2].tune(sr,fundamental*3.17,1.8);
    this.bandsR[0].tune(sr,fundamental*1.025,q);this.bandsR[1].tune(sr,fundamental*1.79,q*.8);this.bandsR[2].tune(sr,fundamental*3.09,1.8);
    const low=1-Math.exp(-2*Math.PI*110/sr),high=1-Math.exp(-2*Math.PI*3200/sr),slow=1-Math.exp(-1/(sr*.025));
    for(let i=0;i<count;i++){
      this.gainL+=(this.targetL-this.gainL)*(this.targetL>this.gainL?attack:release);
      this.gainR+=(this.targetR-this.gainR)*(this.targetR>this.gainR?attack:release);
      if(--this.grainClock<=0){this.grainClock=Math.floor(sr*(.018+.009*(this.noise()+1)));this.grainTarget=this.noise();this.jitterTarget=this.noise();}
      this.grain+=(this.grainTarget-this.grain)*slow;this.jitter+=(this.jitterTarget-this.jitter)*slow;
      const noiseL=this.noise(),noiseR=this.noise();
      this.lowL+=(noiseL-this.lowL)*low;this.lowR+=(noiseR-this.lowR)*low;
      this.highL+=(noiseL-this.lowL-this.highL)*high;this.highR+=(noiseR-this.lowR-this.highR)*high;
      const exciterL=this.highL,exciterR=this.highR;
      const rubL=this.bandsL[0].sample(exciterL)*2.5+this.bandsL[1].sample(exciterL)*1.6+this.bandsL[2].sample(exciterL)*.65;
      const rubR=this.bandsR[0].sample(exciterR)*2.5+this.bandsR[1].sample(exciterR)*1.6+this.bandsR[2].sample(exciterR)*.65;
      const modulation=.8+this.grain*.25;
      const l=Math.tanh((rubL+exciterL*.14+this.lowL*.5)*1.25)*this.gainL*modulation;
      const r=Math.tanh((rubR+exciterR*.14+this.lowR*.5)*1.25)*this.gainR*modulation;
      left[i]=Math.max(-1,Math.min(1,left[i]+l+r*.18));
      if(right)right[i]=Math.max(-1,Math.min(1,right[i]+r+l*.18));
    }
  }
}