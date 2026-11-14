import {VEHICLES,type VehicleId} from './vehicles';
export class EngineAudio {
  private vehicle:VehicleId='kart';
  private context:AudioContext|null=null;
  private engine:AudioWorkletNode|null=null;
  private loading:Promise<void>|null=null;
  enabled=false;
  get ready(){return !!this.engine;}
  get state(){return this.context?.state??'closed';}
  private async initialize(){
    if(this.engine)return;if(this.loading)return this.loading;
    this.loading=(async()=>{this.context??=new AudioContext();await this.context.audioWorklet.addModule('/audio/engine-worklet.js');this.engine=new AudioWorkletNode(this.context,'kart-200cc',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});const compressor=this.context.createDynamicsCompressor();compressor.threshold.value=-16;compressor.knee.value=16;compressor.ratio.value=4;compressor.attack.value=.004;compressor.release.value=.15;const filter=this.context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=4200;this.engine.connect(filter);filter.connect(compressor);compressor.connect(this.context.destination);})();try{await this.loading;}catch(e){this.loading=null;throw e;}
  }
  async setEnabled(enabled:boolean){if(enabled){this.context??=new AudioContext();await this.context.resume();await this.initialize();}this.enabled=enabled;this.engine?.port.postMessage({enabled,running:false});return enabled;}
  async toggle(){return this.setEnabled(!this.enabled);}
  setVehicle(id:VehicleId){this.vehicle=id;this.engine?.port.postMessage({vehicle:id,enabled:this.enabled,running:false});}
  update(rpm:number,throttle:number,running:boolean){const spec=VEHICLES[this.vehicle];this.engine?.port.postMessage({vehicle:this.vehicle,rpm:Math.max(spec.idleRPM,Math.min(spec.maxRPM,rpm)),throttle,running,enabled:this.enabled});}
}
