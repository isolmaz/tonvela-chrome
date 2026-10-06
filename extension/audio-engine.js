import { normalizeSettings, clamp } from "./shared.js";

// chrome.i18n is not available in offscreen documents: errors carry message
// keys, and the background worker translates them.
const settle = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const db = power => 10 * Math.log10(Math.max(power, 1e-12));
let modelBytes;
let sharedContext;

async function getModel() {
  if (!modelBytes) modelBytes = fetch(new URL("vendor/gtcrn.wasm", import.meta.url)).then(response => {
    if (!response.ok) throw new Error("errModelRead");
    return response.arrayBuffer();
  }).catch(error => { modelBytes = null; throw error; });
  return modelBytes;
}

// One AudioContext serves every captured tab; each session owns a subgraph.
function getContext() {
  if (!sharedContext) sharedContext = (async () => {
    const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    await context.audioWorklet.addModule(new URL("audio/dynamics-worklet.js", import.meta.url));
    await context.audioWorklet.addModule(new URL("audio/voice-worklet.js", import.meta.url));
    return context;
  })().catch(error => { sharedContext = null; throw error; });
  return sharedContext;
}

export class AudioSession {
  constructor(tabId, settings, onFailure) {
    this.tabId = tabId;
    this.settings = normalizeSettings(settings);
    this.onFailure = onFailure;
    this.history = [];
    this.measureAfter = 0;
    this.voiceLateAt = -Infinity;
    this.meter = { inputDb: -120, outputDb: -120, peak: 0, gain: 1, limiting: 0, atLimit: false };
    this.stopped = false;
  }

  async prepare() {
    this.context = await getContext();
    const ctx = this.context;
    this.dynamics = new AudioWorkletNode(ctx, "tonvela-dynamics", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit", processorOptions: { settings: this.settings } });
    this.dynamics.port.onmessage = ({ data }) => {
      if (data.type !== "meter") return;
      this.meter = { inputDb: db(data.inputPower), outputDb: db(data.outputPower), peak: data.peak, gain: data.gain, limiting: data.limiting, atLimit: data.atLimit };
      if (performance.now() >= this.measureAfter) this.history.push({ at: performance.now(), power: data.outputPower, audible: data.audible });
      while (this.history.length && this.history[0].at < performance.now() - 2500) this.history.shift();
    };
    this.dynamics.onprocessorerror = () => this.fail("errProcessing");
    this.highpass = new BiquadFilterNode(ctx, { type: "highpass", frequency: 10, Q: 0.707 });
    this.presence = new BiquadFilterNode(ctx, { type: "peaking", frequency: 2200, Q: 0.7, gain: 0 });
    this.bass = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 180, gain: 0 });
    this.fader = new GainNode(ctx, { gain: 0 });
    this.highpass.connect(this.presence).connect(this.bass).connect(this.dynamics).connect(this.fader).connect(ctx.destination);
    this.configureFilters();
    if (this.settings.mode === "voice") this.voice = await this.makeVoice();
  }

  async makeVoice() {
    if (this.context.sampleRate !== 48000) throw new Error("errModel48k");
    const binary = await getModel();
    const worker = new Worker(new URL("audio/voice-worker.js", import.meta.url), { type: "module" });
    const channel = new MessageChannel();
    const voice = { worker, node: null };
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("errModelTimeout")), 10000);
        const done = (settle, value) => { clearTimeout(timeout); settle(value); };
        worker.onerror = event => { console.error("Tonvela speech model:", event.message); done(reject, new Error("errModelBrowser")); };
        worker.onmessage = ({ data }) => {
          if (data.type === "ready") done(resolve);
          if (data.type === "error") { console.error("Tonvela speech model:", data.error); done(reject, new Error("errModelBrowser")); }
        };
        worker.postMessage({ type: "init", wasmBinary: binary, port: channel.port1 }, [channel.port1]);
      });
      voice.node = new AudioWorkletNode(this.context, "tonvela-voice", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
      voice.node.port.postMessage({ type: "model", port: channel.port2 }, [channel.port2]);
      voice.node.port.onmessage = ({ data }) => { if (data.type === "late") this.voiceLateAt = performance.now(); };
      voice.node.onprocessorerror = () => this.fail("errModelStopped");
      worker.onerror = () => this.fail("errModelStopped");
      return voice;
    } catch (error) {
      this.disposeVoice(voice);
      throw error;
    }
  }

  disposeVoice(voice) {
    if (!voice) return;
    voice.worker.postMessage({ type: "dispose" });
    voice.worker.terminate();
    if (voice.node) {
      voice.node.port.postMessage({ type: "dispose" });
      voice.node.disconnect();
      voice.node.port.close();
    }
  }

  async attach(stream) {
    this.stream = stream;
    if (!stream.getAudioTracks().length) throw new Error("errNoAudio");
    this.source = this.context.createMediaStreamSource(stream);
    this.connectSource();
    for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => this.fail("errTrackEnded"), { once: true });
    await this.context.resume();
    if (this.context.state !== "running") throw new Error("errEngineStart");
    this.fader.gain.setTargetAtTime(1, this.context.currentTime, 0.018);
  }

  connectSource() {
    if (this.voice) this.source.connect(this.voice.node).connect(this.highpass);
    else this.source.connect(this.highpass);
  }

  configureFilters() {
    const mode = this.settings.mode;
    const speaking = mode === "speech" || mode === "voice";
    const time = this.context.currentTime;
    this.highpass.frequency.setTargetAtTime(speaking ? 85 : 10, time, 0.025);
    this.presence.gain.setTargetAtTime(mode === "speech" ? 3 : mode === "voice" ? 1 : 0, time, 0.025);
    this.bass.gain.setTargetAtTime(mode === "night" ? -3 : mode === "music" ? 1.2 : speaking ? -1.5 : 0, time, 0.025);
  }

  async update(settings) {
    if (this.stopped) throw new Error("errSessionEnded");
    const next = normalizeSettings(settings);
    let replacement;
    if (next.mode === "voice" && !this.voice) replacement = await this.makeVoice();
    if (this.stopped) { this.disposeVoice(replacement); throw new Error("errTrackEnded"); }
    const replaceRoute = !!replacement || (this.voice && next.mode !== "voice");
    if (replaceRoute) {
      this.fader.gain.setTargetAtTime(0, this.context.currentTime, 0.008);
      await settle(45);
      this.source.disconnect();
      this.disposeVoice(this.voice);
      this.voice = replacement || null;
      this.voiceLateAt = -Infinity;
      this.connectSource();
      this.fader.gain.setTargetAtTime(1, this.context.currentTime, 0.018);
    }
    if (["volume", "mode", "leveling", "targetDb"].some(key => next[key] !== this.settings[key])) {
      this.history = [];
      // Exclude queued meter frames and the short volume-transition tail.
      this.measureAfter = performance.now() + 200;
    }
    this.settings = next;
    this.configureFilters();
    this.dynamics.port.postMessage({ type: "settings", settings: next });
    if (this.context.state === "suspended") await this.context.resume();
    return this.snapshot();
  }

  async learn() {
    if (!this.settings.volume) throw new Error("errNeedVolume");
    const recent = this.history.filter(point => point.audible && point.at > performance.now() - 2000 && point.power > 1e-9);
    if (recent.length < 8) throw new Error("errNeedAudio");
    const power = recent.reduce((sum, point) => sum + point.power, 0) / recent.length;
    const targetDb = clamp(db(power) - 20 * Math.log10(this.settings.volume / 100), -48, -6);
    return this.update({ ...this.settings, leveling: true, targetDb });
  }

  snapshot() {
    const meter = { ...this.meter, voiceLate: performance.now() - this.voiceLateAt < 3000 };
    return { active: !this.stopped, tabId: this.tabId, settings: this.settings, meter, contextState: this.context?.state };
  }

  fail(message) {
    if (!this.stopped) this.onFailure?.(message);
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.fader && this.context.state === "running") {
      this.fader.gain.setTargetAtTime(0, this.context.currentTime, 0.008);
      await settle(40);
    }
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.source?.disconnect();
    this.disposeVoice(this.voice);
    this.voice = null;
    this.dynamics?.port.postMessage({ type: "dispose" });
    this.dynamics?.port.close();
    for (const node of [this.highpass, this.presence, this.bass, this.dynamics, this.fader]) node?.disconnect();
    this.history = [];
  }
}
