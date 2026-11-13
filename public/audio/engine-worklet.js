import {SingleCylinderEngine} from './engine-dsp.js';
class KartEngineProcessor extends AudioWorkletProcessor {
  constructor(){super();this.engine=new SingleCylinderEngine(sampleRate);this.port.onmessage=e=>this.engine.set(e.data);}
  process(_inputs,outputs){const channels=outputs[0];if(channels?.length)this.engine.render(channels[0],channels[1]);return true;}
}
registerProcessor('kart-200cc',KartEngineProcessor);
