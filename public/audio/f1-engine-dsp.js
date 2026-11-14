// Original synthesis of a four-stroke turbo V6: six firings per two crank turns.
// Inspired by the 2024 power-unit architecture, not a recorded RB20 sample.
export class TurboV6Engine {
  constructor(sampleRate=48000){this.sampleRate=sampleRate;this.rpm=3500;this.targetRpm=3500;this.throttle=0;this.load=0;this.phase=0;this.bodyPhase=0;this.turboPhase=0;this.gain=0;this.targetGain=0;this.seed=420;this.lowNoise=0;this.previousLoad=0;this.dc=0;this.muffled=0;}
  set({rpm,throttle,running,enabled}){if(Number.isFinite(rpm))this.targetRpm=Math.max(3500,Math.min(15000,rpm));if(Number.isFinite(throttle))this.throttle=Math.max(0,Math.min(1,throttle));this.targetGain=running&&enabled?.30:0;}
  render(left,right){
    const sr=this.sampleRate,tau=Math.PI*2,muffleCoefficient=1-Math.exp(-tau*1800/sr);
    for(let i=0;i<left.length;i++){
      this.rpm+=(this.targetRpm-this.rpm)/(sr*.045);this.load+=(this.throttle-this.load)/(sr*.035);this.gain+=(this.targetGain-this.gain)/(sr*.035);
      this.phase=(this.phase+this.rpm/(20*sr))%1;this.bodyPhase=(this.bodyPhase+this.rpm/(40*sr))%1;this.turboPhase=(this.turboPhase+(700+this.rpm*.09+this.load*220)/sr)%1;
      this.seed=(Math.imul(this.seed,1664525)+1013904223)|0;const noise=(this.seed>>>0)/2147483648-1;this.lowNoise+=(noise-this.lowNoise)*.12;
      const p=this.phase*tau;
      const exhaust=(.72*Math.sin(p)+.16*Math.sin(p*2+.35)+.055*Math.sin(p*3+.65)+.65*Math.sin(this.bodyPhase*tau))*(.34+this.load*.65);
      const turbine=Math.sin(this.turboPhase*tau)*(.003+this.load*.008),intake=(noise-this.lowNoise)*(.010+this.load*.022);
      this.previousLoad+=(this.load-this.previousLoad)/(sr*.18);const lift=Math.max(0,this.previousLoad-this.load);
      const raw=exhaust+turbine+intake+this.lowNoise*lift*.55;this.dc+=(raw-this.dc)*.001;
      this.muffled+=(raw-this.dc-this.muffled)*muffleCoefficient;
      const out=Math.tanh(this.muffled*.92)*this.gain;left[i]=out;if(right)right[i]=out*.98+intake*this.gain*.016;
    }
  }
}
