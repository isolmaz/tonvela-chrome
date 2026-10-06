import test from "node:test";
import assert from "node:assert/strict";
import { VoiceFrameQueue, VOICE_FRAME } from "../extension/audio/voice-buffer.js";

const frame = value => new Float32Array(VOICE_FRAME).fill(value);

test("processed frames play after the fixed delay", () => {
  const queue = new VoiceFrameQueue(3);
  for (let seq = 0; seq < 3; seq++) {
    queue.push(seq, frame(seq), true);
    queue.receive(seq, frame(100 + seq));
  }
  assert.equal(queue.take(-2), null, "nothing to play before the first frame is due");
  assert.equal(queue.take(0)[0], 100);
  assert.equal(queue.take(1)[0], 101);
  assert.equal(queue.late, 0);
});

test("a frame the model missed plays unprocessed and counts as late", () => {
  const queue = new VoiceFrameQueue(3);
  queue.push(0, frame(1), true);
  assert.equal(queue.take(0)[0], 1);
  assert.equal(queue.late, 1);
  queue.receive(0, frame(9));
  assert.equal(queue.wet.size, 0, "results arriving after playback are dropped");
});

test("frames produced before the model connected are not counted as late", () => {
  const queue = new VoiceFrameQueue(3);
  queue.push(0, frame(1), false);
  assert.equal(queue.take(0)[0], 1);
  assert.equal(queue.late, 0);
});

test("buffers stay bounded while frames flow", () => {
  const queue = new VoiceFrameQueue(3);
  for (let seq = 0; seq < 1000; seq++) {
    queue.push(seq, frame(0), true);
    if (seq % 2) queue.receive(seq, frame(1));
    queue.take(seq - 3);
  }
  assert.ok(queue.dry.size <= 3 && queue.wet.size <= 3);
});
