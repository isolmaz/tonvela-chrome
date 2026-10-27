import test from "node:test";
import assert from "node:assert/strict";
import { DynamicsCore, PROTECTION } from "../extension/audio/dynamics-core.js";
import { normalizeSettings, selectMode, siteKey } from "../extension/shared.js";

const sampleRate = 48000;
const amplitudeDb = x => 20 * Math.log10(Math.max(x, 1e-12));
function run(core, seconds, sample, offset = 0) {
  const input = [new Float32Array(128), new Float32Array(128)];
  const output = [new Float32Array(128), new Float32Array(128)];
  let energy = 0, count = 0, peak = 0, channelError = 0, meter;
  for (let n = 0; n < seconds * sampleRate; n += 128) {
    for (let i = 0; i < 128; i++) { input[0][i] = sample(offset + n + i); input[1][i] = input[0][i] * 0.5; }
    meter = core.process(input, output);
    for (let i = 0; i < 128; i++) {
      assert.ok(Number.isFinite(output[0][i]));
      peak = Math.max(peak, Math.abs(output[0][i]));
      channelError = Math.max(channelError, Math.abs(output[1][i] - output[0][i] / 2));
      if (n >= seconds * sampleRate - sampleRate) { energy += output[0][i] ** 2; count++; }
    }
  }
  return { rms: Math.sqrt(energy / count), peak, channelError, meter };
}
const tone = amplitude => n => amplitude * Math.sin(2 * Math.PI * 440 * n / sampleRate);

test("settings reject invalid modes, non-finite gain, invalid storage and unsupported pages", () => {
  assert.equal(normalizeSettings({ volume: Infinity }).volume, 100);
  assert.equal(normalizeSettings({ volume: 999 }).volume, 400);
  assert.equal(normalizeSettings({ volume: -5 }).volume, 0);
  assert.equal(normalizeSettings(null).mode, "normal");
  assert.equal(normalizeSettings({ mode: "constructor" }).mode, "normal");
  assert.equal(selectMode({}, "night").leveling, true);
  assert.equal(selectMode({}, "music").leveling, false);
  assert.equal(selectMode({ targetDb: -40 }, "night").targetDb, -28, "a mode starts from its own target");
  assert.equal(siteKey("https://www.youtube.com/watch?v=private"), "www.youtube.com");
  assert.equal(siteKey("chrome://extensions"), "");
});

test("manual 400 percent produces 4x signal gain below limiter", () => {
  const result = run(new DynamicsCore(sampleRate, { volume: 400 }), 2, tone(0.04));
  assert.ok(Math.abs(result.rms / (0.04 / Math.SQRT2) - 4) < 0.02);
  assert.ok(result.channelError < 1e-7, "stereo balance must stay linked");
});

test("look-ahead limiter bounds transients and maintains stereo balance", () => {
  let state = 12;
  const result = run(new DynamicsCore(sampleRate, { volume: 400 }), 3, n => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return n % 101 === 0 ? 1 : (state / 2 ** 32 - 0.5) * 1.6;
  });
  assert.ok(result.peak <= 10 ** (-0.5 / 20) + 1e-6, `peak ${result.peak}`);
  assert.ok(result.channelError < 1e-7);
});

test("fixed level converges across an 18 dB input change", () => {
  const core = new DynamicsCore(sampleRate, { volume: 100, leveling: true, targetDb: -22 });
  const quiet = run(core, 4, tone(0.08));
  const loud = run(core, 4, tone(0.64), 4 * sampleRate);
  const difference = Math.abs(amplitudeDb(quiet.rms) - amplitudeDb(loud.rms));
  assert.ok(difference < 0.8, `remaining variation ${difference.toFixed(2)} dB`);
  const stereoRms = loud.rms * Math.sqrt(0.625);
  assert.ok(Math.abs(amplitudeDb(stereoRms) + 22) < 0.6);
});

test("automatic and manual gain together never exceed 400 percent", () => {
  const core = new DynamicsCore(sampleRate, { volume: 400, leveling: true, targetDb: -10 });
  const result = run(core, 3, tone(0.008));
  assert.ok(result.meter.gain <= 4);
  assert.ok(result.meter.atLimit);
});

test("silence remains silent and pause resets adaptive amplification", () => {
  const core = new DynamicsCore(sampleRate, { volume: 100, leveling: true });
  run(core, 2, tone(0.008));
  const silence = run(core, 2, () => 0);
  assert.equal(silence.rms, 0);
  assert.ok(silence.meter.gain < 1.01);
});

test("mute outputs exact zero and night peaks have a lower ceiling", () => {
  const core = new DynamicsCore(sampleRate, { volume: 400 });
  run(core, 1, tone(0.2));
  core.setSettings({ volume: 0 });
  assert.equal(run(core, 0.1, tone(0.2)).peak, 0);
  const night = run(new DynamicsCore(sampleRate, { volume: 400, mode: "night" }), 1, tone(0.8));
  assert.ok(night.peak <= 10 ** (-6 / 20) + 1e-6);
});

test("non-finite audio cannot poison future output", () => {
  const core = new DynamicsCore(sampleRate, { volume: 100 });
  run(core, 0.1, n => n % 2 ? NaN : Infinity);
  const clean = run(core, 1, tone(0.1));
  assert.ok(clean.rms > 0.06);
});

test("mono sends the average of both channels to each ear", () => {
  const result = run(new DynamicsCore(sampleRate, { volume: 100, mono: true }), 0.5, tone(0.2));
  const core = new DynamicsCore(sampleRate, { volume: 100, mono: true });
  const input = [new Float32Array(128).fill(0.4), new Float32Array(128).fill(0)];
  const output = [new Float32Array(128), new Float32Array(128)];
  for (let i = 0; i < 10; i++) core.process(input, output);
  assert.ok(Math.abs(output[0][127] - 0.2) < 1e-6 && Math.abs(output[1][127] - 0.2) < 1e-6, `${output[0][127]} ${output[1][127]}`);
  assert.ok(result.rms > 0);
});

test("balance only turns the opposite side down", () => {
  const input = [new Float32Array(128).fill(0.3), new Float32Array(128).fill(0.3)];
  const output = [new Float32Array(128), new Float32Array(128)];
  const right = new DynamicsCore(sampleRate, { volume: 100, balance: 50 });
  for (let i = 0; i < 10; i++) right.process(input, output);
  assert.ok(Math.abs(output[0][127] - 0.15) < 1e-6, "left is halved");
  assert.ok(Math.abs(output[1][127] - 0.3) < 1e-6, "right keeps its level");
  const left = new DynamicsCore(sampleRate, { volume: 100, balance: -100 });
  for (let i = 0; i < 10; i++) left.process(input, output);
  assert.ok(Math.abs(output[0][127] - 0.3) < 1e-6);
  assert.equal(output[1][127], 0);
});

test("hearing protection lowers the peak ceiling, and night keeps the lower of both", () => {
  for (const [protection, ceilingDb] of Object.entries(PROTECTION)) {
    const result = run(new DynamicsCore(sampleRate, { volume: 400, protection }), 1, tone(0.8));
    assert.ok(result.peak <= 10 ** (ceilingDb / 20) + 1e-6, `${protection}: ${result.peak}`);
    assert.ok(result.peak > 10 ** ((ceilingDb - 1) / 20), `${protection} still plays near its ceiling`);
  }
  const night = run(new DynamicsCore(sampleRate, { volume: 400, mode: "night", protection: "strict" }), 1, tone(0.8));
  assert.ok(night.peak <= 10 ** (PROTECTION.strict / 20) + 1e-6);
  const nightLight = run(new DynamicsCore(sampleRate, { volume: 400, mode: "night", protection: "light" }), 1, tone(0.8));
  assert.ok(nightLight.peak <= 10 ** (-6 / 20) + 1e-6, "night ceiling stays when protection is lighter");
});
