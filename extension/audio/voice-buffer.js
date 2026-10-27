// Frames go to the model worker and are played `delay` frames later. A frame
// whose processed copy has not arrived in time plays unprocessed instead of
// leaving a gap, and counts as late.
export const VOICE_FRAME = 768;
export const VOICE_DELAY_FRAMES = 3;
// A frame the worker starts later than this after it was sent can no longer play
// processed, so the worker skips it instead of falling further behind.
export const VOICE_BUDGET_MS = VOICE_DELAY_FRAMES * VOICE_FRAME / 48;
export const isStale = (sentAt, now) => now - sentAt > VOICE_BUDGET_MS;

export class VoiceFrameQueue {
  constructor(delay = VOICE_DELAY_FRAMES) {
    this.delay = delay;
    this.dry = new Map();
    this.wet = new Map();
    this.late = 0;
  }
  push(seq, samples, sent) { this.dry.set(seq, { samples, sent }); }
  receive(seq, samples) { if (this.dry.has(seq)) this.wet.set(seq, samples); }
  take(seq) {
    const dry = this.dry.get(seq);
    const wet = this.wet.get(seq);
    this.dry.delete(seq);
    this.wet.delete(seq);
    if (wet) return wet;
    if (dry?.sent) this.late++;
    return dry?.samples || null;
  }
}
