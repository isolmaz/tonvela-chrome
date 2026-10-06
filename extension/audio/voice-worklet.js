import { VoiceFrameQueue, VOICE_FRAME } from "./voice-buffer.js";

// Only buffering happens on the audio thread; GTCRN runs in voice-worker.js.
class TonvelaVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alive = true;
    this.offset = 0;
    this.seq = 0;
    this.frame = new Float32Array(VOICE_FRAME);
    this.playing = null;
    this.queue = new VoiceFrameQueue();
    this.reportedLate = 0;
    this.reportedAt = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "model") {
        this.model = data.port;
        this.model.onmessage = ({ data: result }) => this.queue.receive(result.seq, result.samples);
      }
      if (data.type === "dispose") {
        this.alive = false;
        this.model?.close();
        this.model = null;
      }
    };
  }
  send() {
    const frame = this.frame;
    this.frame = new Float32Array(VOICE_FRAME);
    this.queue.push(this.seq, frame, !!this.model);
    if (this.model) {
      const copy = frame.slice();
      this.model.postMessage({ seq: this.seq, samples: copy }, [copy.buffer]);
    }
    this.seq++;
    this.playing = this.queue.take(this.seq - this.queue.delay);
    if (this.queue.late > this.reportedLate && currentTime - this.reportedAt > 1) {
      this.port.postMessage({ type: "late", count: this.queue.late });
      this.reportedLate = this.queue.late;
      this.reportedAt = currentTime;
    }
  }
  process(inputs, outputs) {
    if (!this.alive) return false;
    const output = outputs[0];
    if (!output?.length) return true;
    const input = inputs[0] || [];
    for (let i = 0; i < output[0].length; i++) {
      let mono = 0;
      for (let ch = 0; ch < input.length; ch++) mono += input[ch][i] || 0;
      this.frame[this.offset] = mono / (input.length || 1);
      const value = this.playing ? this.playing[this.offset] : 0;
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = value;
      if (++this.offset === VOICE_FRAME) {
        this.offset = 0;
        this.send();
      }
    }
    return true;
  }
}
registerProcessor("tonvela-voice", TonvelaVoice);
