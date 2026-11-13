// Original procedural audio. One combustion every two crank revolutions:
// a 200 cc single-cylinder four-stroke rental kart. No third-party samples.
export class SingleCylinderEngine {
  constructor(sampleRate=48000){this.sampleRate=sampleRate;this.rpm=1500;this.targetRpm=1500;this.throttle=0;this.load=0;this.phase=0;this.crank=0;this.gain=0;this.targetGain=0;this.seed=712;this.noiseLow=0;this.exhaust=0;this.dc=0;this.fireVariation=1;}
  set({rpm,throttle,running,enabled}){if(Number.isFinite(rpm))this.targetRpm=Math.max(1450,Math.min(4600,rpm));if(Number.isFinite(throttle))this.throttle=Math.max(0,Math.min(1,throttle));this.targetGain=running&&enabled?.58:0;}
  noise(){this.seed=(Math.imul(this.seed,1664525)+1013904223)|0;return (this.seed>>>0)/2147483648-1;}
  render(left,right){
    const sr=this.sampleRate;
    for(let i=0;i<left.length;i++){
      this.rpm+=(this.targetRpm-this.rpm)/(sr*.16);this.load+=(this.throttle-this.load)/(sr*.055);this.gain+=(this.targetGain-this.gain)/(sr*.04);
      this.phase+=this.rpm/(120*sr);if(this.phase>=1){this.phase-=1;this.fireVariation=.90+.10*this.noise();}this.crank=(this.crank+this.rpm/(60*sr))%1;
      const n=this.noise(),p=this.phase,env=Math.exp(-p*(22-this.load*7))*this.fireVariation;
      const pulse=env*(Math.sin(p*Math.PI*12)+.40*Math.sin(p*Math.PI*28)+.16*n)*(.45+this.load*.58);this.exhaust+=(pulse-this.exhaust)*.12;this.noiseLow+=(n-this.noiseLow)*.22;
      const mechanical=Math.sin(this.crank*Math.PI*2)*.08+Math.sin(this.crank*Math.PI*8)*.03,intake=(n-this.noiseLow)*(.012+this.load*.028)*(.4+env),raw=this.exhaust+mechanical+intake;this.dc+=(raw-this.dc)*.001;
      const out=Math.tanh((raw-this.dc)*1.9)*this.gain*.48;left[i]=out;if(right)right[i]=out*.96+mechanical*this.gain*.012;
    }
  }
}
