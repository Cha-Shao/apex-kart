import {SingleCylinderEngine} from './engine-dsp.js';
import {TurboV6Engine} from './f1-engine-dsp.js';
class KartEngineProcessor extends AudioWorkletProcessor {
  constructor(){super();this.engines={kart:new SingleCylinderEngine(sampleRate),rb20:new TurboV6Engine(sampleRate)};this.vehicle='kart';this.port.onmessage=e=>{const data=e.data;if(data.vehicle in this.engines)this.vehicle=data.vehicle;this.engines[this.vehicle].set(data);};}
  process(_inputs,outputs){const channels=outputs[0];if(channels?.length)this.engines[this.vehicle].render(channels[0],channels[1]);return true;}
}
registerProcessor('kart-200cc',KartEngineProcessor);
