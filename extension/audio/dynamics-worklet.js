import { DynamicsCore } from "./dynamics-core.js";

class TonvelaDynamics extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.core = new DynamicsCore(sampleRate, options.processorOptions.settings);
    this.frames = 0;
    this.inputEnergy = 0;
    this.outputEnergy = 0;
    this.peak = 0;
    this.limiting = 0;
    this.alive = true;
    this.port.onmessage = ({ data }) => {
      if (data.type === "settings") this.core.setSettings(data.settings);
      if (data.type === "dispose") this.alive = false;
    };
  }
  process(inputs, outputs) {
    if (!this.alive) return false;
    const output = outputs[0];
    if (!output?.length) return true;
    const meter = this.core.process(inputs[0] || [], output);
    const frames = output[0].length;
    this.frames += frames;
    this.inputEnergy += meter.inputPower * frames;
    this.outputEnergy += meter.outputPower * frames;
    this.peak = Math.max(this.peak, meter.peak);
    this.limiting = Math.max(this.limiting, meter.limiting);
    if (this.frames >= sampleRate / 10) {
      this.port.postMessage({ type: "meter", ...meter, inputPower: this.inputEnergy / this.frames, outputPower: this.outputEnergy / this.frames, peak: this.peak, limiting: this.limiting, frames: this.frames });
      this.frames = this.inputEnergy = this.outputEnergy = this.peak = this.limiting = 0;
    }
    return true;
  }
}
registerProcessor("tonvela-dynamics", TonvelaDynamics);
