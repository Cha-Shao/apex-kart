export class EngineAudio {
  private context:AudioContext|null=null;
  private oscillator:OscillatorNode|null=null;
  private harmonics:OscillatorNode|null=null;
  private gain:GainNode|null=null;
  enabled=false;
  async toggle(){
    if(!this.context){this.context=new AudioContext();this.gain=this.context.createGain();this.gain.gain.value=0;const filter=this.context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=650;this.gain.connect(filter);filter.connect(this.context.destination);this.oscillator=this.context.createOscillator();this.oscillator.type='sawtooth';this.oscillator.connect(this.gain);this.oscillator.start();this.harmonics=this.context.createOscillator();this.harmonics.type='triangle';this.harmonics.connect(this.gain);this.harmonics.start();}
    await this.context.resume();this.enabled=!this.enabled;return this.enabled;
  }
  update(rpm:number,throttle:number,running:boolean){if(!this.context||!this.gain||!this.oscillator||!this.harmonics)return;const t=this.context.currentTime;this.oscillator.frequency.setTargetAtTime(28+rpm/74,t,.07);this.harmonics.frequency.setTargetAtTime(14+rpm/148,t,.08);this.gain.gain.setTargetAtTime(this.enabled&&running?.018+throttle*.012:0,t,.1);}
}
