import { GtcrnProcessor, loadGtcrnModule } from "../vendor/gtcrn.js";

// Runs the speech model off the audio thread. Frames arrive on a MessagePort
// straight from the voice worklet and go back the same way.
let processor = null;

self.onmessage = async ({ data }) => {
  if (data.type === "dispose") {
    processor?.destroy();
    processor = null;
    return;
  }
  if (data.type !== "init") return;
  try {
    // All bytes come from the extension page; this resolver prevents the loader's URL fallback.
    const module = await loadGtcrnModule({ wasmBinary: data.wasmBinary, locateFile: file => file });
    processor = new GtcrnProcessor(module, { sampleRate: 48000 });
    data.port.onmessage = ({ data: frame }) => {
      if (!processor) return;
      const samples = processor.process(frame.samples);
      data.port.postMessage({ seq: frame.seq, samples }, [samples.buffer]);
    };
    self.postMessage({ type: "ready" });
  } catch (error) {
    self.postMessage({ type: "error", error: String(error?.message || error) });
  }
};
