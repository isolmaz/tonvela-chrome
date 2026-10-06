import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { loadGtcrnModule, GtcrnProcessor } from "../extension/vendor/gtcrn.js";

const wave = await fs.readFile(".cache/test-speech.wav");
let rate, channels, bits, format, data;
for (let offset = 12; offset + 8 <= wave.length;) {
  const name = wave.toString("ascii", offset, offset + 4);
  const size = wave.readUInt32LE(offset + 4);
  if (name === "fmt ") { format = wave.readUInt16LE(offset + 8); channels = wave.readUInt16LE(offset + 10); rate = wave.readUInt32LE(offset + 12); bits = wave.readUInt16LE(offset + 22); }
  if (name === "data") data = wave.subarray(offset + 8, offset + 8 + size);
  offset += size + 8 + (size % 2);
}
assert.equal(format, 1);
assert.equal(bits, 16);
const count = data.length / (channels * 2);
const clean = new Float32Array(Math.ceil(count * 16000 / rate));
const read = n => data.readInt16LE(Math.min(count - 1, n) * channels * 2) / 32768;
for (let i = 0; i < clean.length; i++) {
  const position = i * rate / 16000;
  const n = Math.floor(position), fraction = position - n;
  clean[i] = read(n) * (1 - fraction) + read(n + 1) * fraction;
}
const rms = (array, start = 0, end = array.length) => {
  let sum = 0;
  for (let i = start; i < end; i++) sum += array[i] ** 2;
  return Math.sqrt(sum / (end - start));
};
const scale = 0.055 / rms(clean);
const sr = 16000;
const length = Math.ceil((clean.length + sr * 4) / 256) * 256;
const reference = new Float32Array(length);
const mix = new Float32Array(length);
let random = 3456;
for (let i = 0; i < length; i++) {
  reference[i] = (clean[i - 2 * sr] || 0) * scale;
  random = (1664525 * random + 1013904223) >>> 0;
  const noise = (random / 2 ** 32 - 0.5) * 0.07;
  const time = i / sr;
  const chord = 0.02 * (Math.sin(2 * Math.PI * 220 * time) + Math.sin(2 * Math.PI * 277.18 * time) + Math.sin(2 * Math.PI * 329.63 * time)) * (0.6 + 0.4 * Math.cos(2 * Math.PI * 1.5 * time));
  mix[i] = reference[i] + noise + chord;
}
const binary = await fs.readFile("extension/vendor/gtcrn.wasm");
const module = await loadGtcrnModule({ wasmBinary: binary });
const processor = new GtcrnProcessor(module);
const enhanced = new Float32Array(length);
const started = performance.now();
for (let i = 0; i < length; i += 256) enhanced.set(processor.process(mix.subarray(i, i + 256)), i);
const seconds = (performance.now() - started) / 1000;
processor.destroy();
assert.ok(enhanced.every(Number.isFinite));
let bestLag = 0, bestCorrelation = -1;
const start = 2 * sr;
const end = Math.min(length - 1024, start + clean.length);
for (let lag = 0; lag <= 1024; lag++) {
  let dot = 0, rr = 0, yy = 0;
  for (let i = start; i < end; i += 8) { const x = reference[i], y = enhanced[i + lag]; dot += x * y; rr += x * x; yy += y * y; }
  const correlation = dot / Math.sqrt(Math.max(rr * yy, 1e-20));
  if (correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag; }
}
function sisdr(signal, lag) {
  let dot = 0, refEnergy = 0;
  for (let i = start; i < end; i++) { dot += reference[i] * signal[i + lag]; refEnergy += reference[i] ** 2; }
  const factor = dot / refEnergy;
  let noise = 0, target = 0;
  for (let i = start; i < end; i++) { const projection = factor * reference[i]; target += projection ** 2; noise += (signal[i + lag] - projection) ** 2; }
  return 10 * Math.log10(target / Math.max(noise, 1e-20));
}
const inputScore = sisdr(mix, 0), outputScore = sisdr(enhanced, bestLag);
const suppression = 20 * Math.log10(rms(mix, sr, sr * 2) / Math.max(rms(enhanced, sr, sr * 2), 1e-12));
const result = { fixture: "Local Windows speech mixed with deterministic noise and a synthetic musical chord", sampleRate: sr, durationSeconds: length / sr, processingSeconds: seconds, realTimeFactor: seconds / (length / sr), alignmentDelayMs: bestLag / sr * 1000, inputSiSdrDb: inputScore, outputSiSdrDb: outputScore, improvementDb: outputScore - inputScore, backgroundOnlySuppressionDb: suppression, speechCorrelation: bestCorrelation };
await fs.writeFile(".cache/voice-test-results.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
assert.ok(result.improvementDb > 2, "the speech model must improve the mixed speech fixture");
assert.ok(suppression > 6, "background-only segments must be suppressed");
assert.ok(bestCorrelation > 0.65, "recognizable speech waveform must remain");
assert.ok(result.realTimeFactor < 1, "model must run faster than real time on this machine");
