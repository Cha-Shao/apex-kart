// Original procedural grass/soil rolling noise: low earth rumble, leaf rustle
// and irregular clods. Independent wheel-side signals avoid a repeating loop.
export class GrassRoll {
  constructor(sampleRate=48000){
    this.sampleRate=sampleRate;this.speed=0;this.seed=0x1b873593;
    this.channels=Array.from({length:2},()=>({target:0,gain:0,soilLow:0,soilHigh:0,leafLow:0,leafHigh:0,grain:0,grainClock:0,flutter:0,flutterTarget:0}));
  }

  noise(){this.seed=(Math.imul(this.seed,1664525)+1013904223)|0;return (this.seed>>>0)/2147483648-1;}

  set({speed=0,grassLeft=0,grassRight=0,running=false,enabled=false}={}){
    this.speed=Math.max(0,speed);
    const active=running&&enabled,rolling=Math.min(1,Math.max(0,(this.speed-.3)/5));
    const volume=active?rolling*(.055+.24*Math.sqrt(Math.min(1,this.speed/110)))*.175:0;
    this.channels[0].target=Math.max(0,Math.min(1,grassLeft))*volume;
    this.channels[1].target=Math.max(0,Math.min(1,grassRight))*volume;
  }

  mix(left,right){
    if(this.channels.every(c=>c.target===0&&c.gain<1e-6))return;
    const sr=this.sampleRate,speed=this.speed/3.6;
    const attack=1-Math.exp(-1/(sr*.035)),release=1-Math.exp(-1/(sr*.10));
    const soilLow=1-Math.exp(-2*Math.PI*45/sr),soilHigh=1-Math.exp(-2*Math.PI*(280+Math.min(250,speed*6))/sr);
    const leafLow=1-Math.exp(-2*Math.PI*650/sr),leafHigh=1-Math.exp(-2*Math.PI*(2200+Math.min(1600,speed*35))/sr);
    const flutter=1-Math.exp(-1/(sr*.018)),grainDecay=Math.exp(-1/(sr*.009));
    for(let i=0;i<left.length;i++){
      let l=0,r=0;
      for(let side=0;side<2;side++){
        const c=this.channels[side];
        c.gain+=(c.target-c.gain)*(c.target>c.gain?attack:release);
        if(--c.grainClock<=0){
          // Random spacing shrinks with distance travelled, rather than RPM.
          c.grainClock=sr*(.045+.10*(this.noise()*.5+.5))/(1+speed*.12);
          c.grain=.35+.65*(this.noise()*.5+.5);c.flutterTarget=this.noise();
        }
        c.grain*=grainDecay;c.flutter+=(c.flutterTarget-c.flutter)*flutter;
        const noise=this.noise();
        c.soilLow+=(noise-c.soilLow)*soilLow;c.soilHigh+=(noise-c.soilHigh)*soilHigh;
        c.leafLow+=(noise-c.leafLow)*leafLow;c.leafHigh+=(noise-c.leafHigh)*leafHigh;
        const soil=(c.soilHigh-c.soilLow)*1.65;
        const leaves=(c.leafHigh-c.leafLow)*(.42+c.grain*.75);
        const out=Math.tanh((soil+leaves)*(.85+c.flutter*.25)*2.1)*c.gain;
        if(side===0)l=out;else r=out;
      }
      left[i]=Math.max(-1,Math.min(1,left[i]+l+r*.16));
      if(right)right[i]=Math.max(-1,Math.min(1,right[i]+r+l*.16));
    }
  }
}
