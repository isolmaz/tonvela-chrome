// Linked stereo level control and a 5 ms look-ahead peak limiter.
// No samples leave this processor. Total adaptive/manual gain is capped at 4.
export class DynamicsCore {
  constructor(sampleRate, settings = {}) {
    this.sampleRate = sampleRate;
    this.lookahead = Math.max(1, Math.round(sampleRate * 0.005));
    this.ringSize = this.lookahead + 1;
    this.rings = [new Float32Array(this.ringSize), new Float32Array(this.ringSize)];
    this.queueSize = this.lookahead + 2;
    this.peakValues = new Float64Array(this.queueSize);
    this.peakTimes = new Float64Array(this.queueSize);
    this.head = 0;
    this.tail = 0;
    this.clock = 0;
    this.power = 0;
    this.gain = 1;
    this.limiterGain = 1;
    this.silentSamples = 0;
    this.release = Math.exp(-1 / (sampleRate * 0.08));
    this.settings = {};
    this.setSettings(settings);
  }

  setSettings(settings) {
    const sane = (x, fallback, low, high) => Number.isFinite(x) ? Math.min(high, Math.max(low, x)) : fallback;
    this.settings = { volume: sane(settings.volume, 100, 0, 400), leveling: settings.leveling === true || settings.mode === "steady", targetDb: sane(settings.targetDb, -22, -48, -6), mode: settings.mode || "normal" };
    this.volume = this.settings.volume / 100;
    this.target = 10 ** (this.settings.targetDb / 20);
    this.ceiling = 10 ** ((this.settings.mode === "night" ? -6 : -0.5) / 20);
    const upTime = this.settings.mode === "night" ? 0.28 : this.settings.mode === "music" ? 1.5 : 0.55;
    this.up = Math.exp(-1 / (this.sampleRate * upTime));
    this.down = Math.exp(-1 / (this.sampleRate * 0.035));
    this.manualSmoothing = Math.exp(-1 / (this.sampleRate * 0.012));
  }

  process(input, output) {
    const frames = output[0].length;
    const channels = Math.min(2, output.length);
    let inputEnergy = 0;
    for (let ch = 0; ch < channels; ch++) {
      const source = input[ch] || input[0];
      if (!source) continue;
      for (let n = 0; n < frames; n++) {
        const value = Number.isFinite(source[n]) ? source[n] : 0;
        inputEnergy += value * value;
      }
    }
    const blockPower = inputEnergy / (frames * channels);
    const rms = Math.sqrt(blockPower);
    const smoothing = Math.exp(-frames / (this.sampleRate * 0.09));
    this.power = this.power * smoothing + blockPower * (1 - smoothing);
    if (rms < 0.00126) this.silentSamples += frames; // -58 dBFS: do not amplify pauses.
    else this.silentSamples = 0;
    let wanted = this.volume;
    if (this.settings.leveling && this.silentSamples < this.sampleRate * 0.25 && this.power > 1e-8) {
      wanted = Math.min(4, this.volume * this.target / Math.sqrt(this.power));
    } else if (this.settings.leveling && this.silentSamples < this.sampleRate * 0.7) {
      wanted = Math.min(this.gain, this.volume || 0);
    }
    wanted = Math.max(0, Math.min(4, wanted));
    const coefficient = !this.settings.leveling ? this.manualSmoothing : wanted < this.gain ? this.down : this.up;
    let outputEnergy = 0;
    let outputPeak = 0;
    let maxReduction = 0;
    for (let n = 0; n < frames; n++) {
      this.gain = wanted + coefficient * (this.gain - wanted);
      let peak = 0;
      const slot = this.clock % this.ringSize;
      for (let ch = 0; ch < channels; ch++) {
        const source = input[ch] || input[0];
        const raw = source && Number.isFinite(source[n]) ? source[n] : 0;
        const value = raw * this.gain;
        this.rings[ch][slot] = value;
        peak = Math.max(peak, Math.abs(value));
      }
      while (this.head !== this.tail && this.peakTimes[this.head] < this.clock - this.lookahead) this.head = (this.head + 1) % this.queueSize;
      while (this.head !== this.tail) {
        const previous = (this.tail - 1 + this.queueSize) % this.queueSize;
        if (this.peakValues[previous] > peak) break;
        this.tail = previous;
      }
      this.peakValues[this.tail] = peak;
      this.peakTimes[this.tail] = this.clock;
      this.tail = (this.tail + 1) % this.queueSize;
      const futurePeak = this.peakValues[this.head];
      const limit = futurePeak > this.ceiling ? this.ceiling / futurePeak : 1;
      this.limiterGain = Math.min(limit, 1 - (1 - this.limiterGain) * this.release);
      maxReduction = Math.max(maxReduction, 1 - this.limiterGain);
      const readSlot = (slot + 1) % this.ringSize;
      for (let ch = 0; ch < channels; ch++) {
        const delayed = this.clock >= this.lookahead ? this.rings[ch][readSlot] : 0;
        // Explicit mute also clears the look-ahead tail on the next quantum.
        const value = this.volume === 0 ? 0 : delayed * this.limiterGain;
        output[ch][n] = value;
        outputEnergy += value * value;
        outputPeak = Math.max(outputPeak, Math.abs(value));
      }
      this.clock++;
    }
    return { inputPower: blockPower, outputPower: outputEnergy / (frames * channels), peak: outputPeak, gain: this.gain, limiting: maxReduction, audible: rms > 0.00126, atLimit: wanted >= 3.99 && this.settings.leveling };
  }
}
