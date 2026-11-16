// Procedural loose-stone rolling: coarse rumble, gritty crunch and scattered
// pebble impacts. Independent sides follow wheel contact, never engine RPM.
export class GravelRoll {
  constructor(sampleRate=48000){
    this.sampleRate=sampleRate;this.speed=0;this.seed=0x73a4c951;
    this.channels=Array.from({length:2},()=>({target:0,gain:0,rumbleLow:0,rumbleHigh:0,gritLow:0,gritHigh:0,stoneLow:0,stoneHigh:0,grain:0,impact:0,clock:0}));
  }

  noise(){this.seed=(Math.imul(this.seed,1664525)+1013904223)|0;return (this.seed>>>0)/2147483648-1;}

  set({speed=0,gravelLeft=0,gravelRight=0,running=false,enabled=false}={}){
    this.speed=Math.max(0,speed);
    const rolling=Math.min(1,Math.max(0,(this.speed-.25)/4));
    const volume=running&&enabled?rolling*(.06+.19*Math.sqrt(Math.min(1,this.speed/110)))*.5:0;
    this.channels[0].target=Math.max(0,Math.min(1,gravelLeft))*volume;
    this.channels[1].target=Math.max(0,Math.min(1,gravelRight))*volume;
  }

  mix(left,right){
    if(this.channels.every(c=>c.target===0&&c.gain<1e-6))return;
    const sr=this.sampleRate,speed=this.speed/3.6;
    const attack=1-Math.exp(-1/(sr*.025)),release=1-Math.exp(-1/(sr*.09));
    const rumbleLow=1-Math.exp(-2*Math.PI*65/sr),rumbleHigh=1-Math.exp(-2*Math.PI*(420+Math.min(350,speed*9))/sr);
    const gritLow=1-Math.exp(-2*Math.PI*700/sr),gritHigh=1-Math.exp(-2*Math.PI*(2800+Math.min(1000,speed*30))/sr);
    const stoneLow=1-Math.exp(-2*Math.PI*160/sr),stoneHigh=1-Math.exp(-2*Math.PI*1600/sr);
    const grainDecay=Math.exp(-1/(sr*.012)),impactDecay=Math.exp(-1/(sr*.0045));
    for(let i=0;i<left.length;i++){
      let l=0,r=0;
      for(let side=0;side<2;side++){
        const c=this.channels[side];
        c.gain+=(c.target-c.gain)*(c.target>c.gain?attack:release);
        if(--c.clock<=0){
          c.clock=sr*(.025+.08*(this.noise()*.5+.5))/(1+speed*.32);
          c.grain=.4+.6*(this.noise()*.5+.5);c.impact=this.noise();
        }
        c.grain*=grainDecay;c.impact*=impactDecay;
        const noise=this.noise();
        c.rumbleLow+=(noise-c.rumbleLow)*rumbleLow;c.rumbleHigh+=(noise-c.rumbleHigh)*rumbleHigh;
        c.gritLow+=(noise-c.gritLow)*gritLow;c.gritHigh+=(noise-c.gritHigh)*gritHigh;
        c.stoneLow+=(c.impact-c.stoneLow)*stoneLow;c.stoneHigh+=(c.impact-c.stoneHigh)*stoneHigh;
        const rumble=(c.rumbleHigh-c.rumbleLow)*2.2;
        const crunch=(c.gritHigh-c.gritLow)*(.55+c.grain*1.15);
        const stones=(c.stoneHigh-c.stoneLow)*2.4;
        const out=Math.tanh((rumble+crunch+stones)*1.8)*c.gain;
        if(side===0)l=out;else r=out;
      }
      left[i]=Math.max(-1,Math.min(1,left[i]+l+r*.16));
      if(right)right[i]=Math.max(-1,Math.min(1,right[i]+r+l*.16));
    }
  }
}
