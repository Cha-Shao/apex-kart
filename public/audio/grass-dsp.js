// Continuous dry grass brushed under tyres: a steady leafy rustle with subtle
// texture changes and fine stem crackles, without loose-stone rumble.
export class GrassRoll {
  constructor(sampleRate=48000){
    this.sampleRate=sampleRate;this.speed=0;this.seed=0x1b873593;
    this.channels=Array.from({length:2},()=>({target:0,gain:0,leafLow:0,leafHigh:0,bladeLow:0,bladeHigh:0,tone:0,toneTarget:0,rustleClock:0,rustle:0,rustleTarget:0,fibreClock:0,fibre:0}));
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
    const leafLow=1-Math.exp(-2*Math.PI*1050/sr);
    const bladeLow=1-Math.exp(-2*Math.PI*2800/sr),bladeHigh=1-Math.exp(-2*Math.PI*5600/sr);
    const pace=Math.sqrt(1+Math.min(35,speed)*.65),fibreDecay=Math.exp(-1/(sr*.003));
    const textureSmoothing=1-Math.exp(-1/(sr*.025));
    for(let i=0;i<left.length;i++){
      let l=0,r=0;
      for(let side=0;side<2;side++){
        const c=this.channels[side];
        c.gain+=(c.target-c.gain)*(c.target>c.gain?attack:release);
        if(--c.rustleClock<=0){
          // Vary the texture gently over a continuous rustle. There are no
          // footstep envelopes or gaps while the tyres keep rolling on grass.
          c.rustleClock=sr*(.11+.075*(this.noise()*.5+.5))/pace;
          c.rustleTarget=this.noise();
          c.toneTarget=1-Math.exp(-2*Math.PI*(2400+1100*(this.noise()*.5+.5))/sr);
        }
        c.rustle+=(c.rustleTarget-c.rustle)*textureSmoothing;
        c.tone+=(c.toneTarget-c.tone)*textureSmoothing;
        if(--c.fibreClock<=0){
          c.fibreClock=sr*(.012+.035*(this.noise()*.5+.5))/pace;
          c.fibre=.3+.7*(this.noise()*.5+.5);
        }
        c.fibre*=fibreDecay;
        const leafNoise=this.noise(),bladeNoise=this.noise();
        c.leafLow+=(leafNoise-c.leafLow)*leafLow;
        c.leafHigh+=(leafNoise-c.leafLow-c.leafHigh)*c.tone;
        c.bladeLow+=(bladeNoise-c.bladeLow)*bladeLow;c.bladeHigh+=(bladeNoise-c.bladeHigh)*bladeHigh;
        const leaves=c.leafHigh*1.05*(.92+c.rustle*.08);
        const fibres=(c.bladeHigh-c.bladeLow)*(.08+c.fibre*.22);
        const out=Math.tanh((leaves+fibres)*1.65)*c.gain;
        if(side===0)l=out;else r=out;
      }
      left[i]=Math.max(-1,Math.min(1,left[i]+l+r*.16));
      if(right)right[i]=Math.max(-1,Math.min(1,right[i]+r+l*.16));
    }
  }
}
