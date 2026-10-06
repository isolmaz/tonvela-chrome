import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["extension/vendor/**", "node_modules/**", ".cache/**"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }] }
  },
  { files: ["extension/**/*.js"], languageOptions: { globals: { ...globals.browser, ...globals.webextensions } } },
  { files: ["extension/audio/*-worklet.js"], languageOptions: { globals: { sampleRate: "readonly", currentTime: "readonly", currentFrame: "readonly", registerProcessor: "readonly", AudioWorkletProcessor: "readonly" } } },
  { files: ["extension/audio/voice-worker.js"], languageOptions: { globals: globals.worker } },
  // Browser-side callbacks inside the Playwright script also reference page globals.
  { files: ["tests/**", "tools/**", "*.js"], languageOptions: { globals: { ...globals.node, ...globals.browser } } }
];
