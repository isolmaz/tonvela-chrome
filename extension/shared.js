import { t, isMessageKey } from "./i18n.js";

// name and description are message keys in _locales.
export const MODES = Object.freeze({
  normal: { name: "modeNormal", description: "modeNormalDesc", leveling: false, targetDb: -22 },
  steady: { name: "modeSteady", description: "modeSteadyDesc", leveling: true, targetDb: -22 },
  speech: { name: "modeSpeech", description: "modeSpeechDesc", leveling: true, targetDb: -22 },
  night: { name: "modeNight", description: "modeNightDesc", leveling: true, targetDb: -28 },
  music: { name: "modeMusic", description: "modeMusicDesc", leveling: false, targetDb: -22 },
  voice: { name: "modeVoice", description: "modeVoiceDesc", leveling: true, targetDb: -22 }
});

export const DEFAULT_SETTINGS = Object.freeze({ volume: 100, mode: "normal", leveling: false, targetDb: -22, remember: true });
export const MAX_SITES = 100;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, fallback, min, max) => Number.isFinite(value) ? clamp(value, min, max) : fallback;

export function normalizeSettings(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const mode = Object.hasOwn(MODES, value.mode) ? value.mode : "normal";
  return {
    volume: Math.round(number(value.volume, 100, 0, 400)),
    mode,
    leveling: mode === "steady" || value.leveling === true,
    targetDb: number(value.targetDb, -22, -48, -6),
    remember: value.remember !== false
  };
}

export function selectMode(settings, mode) {
  if (!Object.hasOwn(MODES, mode)) return normalizeSettings(settings);
  return normalizeSettings({ ...settings, mode, leveling: MODES[mode].leveling, targetDb: MODES[mode].targetDb });
}

export function siteKey(url) {
  try {
    const parsed = new URL(url);
    return ["https:", "http:", "file:"].includes(parsed.protocol) ? (parsed.protocol === "file:" ? "yerel-dosya" : parsed.hostname) : "";
  } catch { return ""; }
}

// Keep only the most recently edited MAX_SITES site preferences, without history or page URLs.
export function rememberSite(sites, key, settings) {
  const next = { ...(sites || {}) };
  if (!key) return next;
  delete next[key];
  if (settings.remember) next[key] = settings;
  return Object.fromEntries(Object.entries(next).slice(-MAX_SITES));
}

export function applyCommand(settings, command) {
  const next = normalizeSettings(settings);
  if (command === "volume-up") next.volume = Math.min(400, next.volume + 10);
  else if (command === "volume-down") next.volume = Math.max(0, next.volume - 10);
  else if (command === "toggle-leveling") {
    next.leveling = !next.leveling;
    if (!next.leveling && next.mode === "steady") next.mode = "normal";
  } else return null;
  return next;
}

// Runs operations one at a time; a failure does not block later operations.
export function createSerialQueue() {
  let queue = Promise.resolve();
  return operation => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };
}

// Coalesces writes per key; when the delay passes, `onDue(flush)` decides where flush runs.
export function createPendingWrites(write, delay, onDue = flush => flush()) {
  const pending = new Map();
  let timer = null;
  async function flush() {
    clearTimeout(timer);
    timer = null;
    const jobs = [...pending.values()];
    pending.clear();
    for (const job of jobs) await write(job);
  }
  return {
    schedule(key, job) {
      pending.delete(key);
      pending.set(key, job);
      clearTimeout(timer);
      timer = setTimeout(() => onDue(flush), delay);
    },
    flush,
    get size() { return pending.size; }
  };
}

export function readableError(error) {
  const text = String(error?.message || error || "errUnknown");
  if (isMessageKey(text)) return t(text);
  if (/activeTab|invoked|not been invoked|Extension has not/.test(text)) return t("errActiveTab");
  if (/Cannot capture|chrome:\/\/|not supported|not capturable/.test(text)) return t("errCannotCapture");
  if (/already being captured|already captured/.test(text)) return t("errAlreadyCaptured");
  if (/Permission|NotAllowed|denied|not permitted/.test(text)) return t("errPermission");
  if (/NotReadable|Could not start|Failed to start/.test(text)) return t("errNotReadable");
  return text.slice(0, 260);
}
