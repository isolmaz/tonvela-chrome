import { AudioSession, setOutputDevice } from "./audio-engine.js";
import { DEFAULT_LISTENER, normalizeListener } from "./shared.js";
const sessions = new Map();
const METER_INTERVAL = 150;
let listener = DEFAULT_LISTENER;

async function stop(tabId, reason) {
  const session = sessions.get(tabId);
  if (!session) return;
  sessions.delete(tabId);
  await session.stop();
  if (reason) chrome.runtime.sendMessage({ target: "background", type: "session-ended", tabId, error: reason }).catch(() => {});
}

// A missing device falls back to the default output instead of failing the session.
async function applyOutputDevice(strict) {
  try { await setOutputDevice(listener.outputDevice); }
  catch {
    await setOutputDevice("").catch(() => {});
    if (strict) throw new Error("errOutputDevice");
  }
}

async function handle(message) {
  const { type, tabId } = message;
  const current = sessions.get(tabId);
  if (type === "state") return { state: current?.snapshot() || null, count: sessions.size };
  if (type === "listener") {
    listener = normalizeListener(message.listener);
    for (const session of sessions.values()) session.setListener(listener);
    if (sessions.size) await applyOutputDevice(true);
    return {};
  }
  if (type === "prepare") {
    if (current) return { state: current.snapshot() };
    listener = normalizeListener(message.listener);
    const session = new AudioSession(tabId, message.settings, listener, reason => stop(tabId, reason));
    sessions.set(tabId, session);
    try { await session.prepare(); }
    catch (error) { await stop(tabId); throw error; }
    await applyOutputDevice(false);
    return { prepared: true };
  }
  if (type === "attach") {
    if (!current) throw new Error("errEngineNotReady");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: message.streamId } }, video: false });
      await current.attach(stream);
    } catch (error) { await stop(tabId); throw error; }
    return { state: current.snapshot() };
  }
  if (type === "stop") { await stop(tabId); return { count: sessions.size }; }
  if (type === "update") {
    if (!current) throw new Error("errNoSession");
    return { state: await current.update(message.settings) };
  }
  if (type === "learn") {
    if (!current) throw new Error("errStartFirst");
    return { state: await current.learn() };
  }
  throw new Error("errUnknownAudioOp");
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== "offscreen") return;
  handle(message).then(value => respond({ ok: true, ...value }), error => respond({ ok: false, error: String(error.message || error) }));
  return true;
});

// An open popup subscribes once and receives snapshots, instead of polling
// through the background worker. A null state means the session ended.
chrome.runtime.onConnect.addListener(port => {
  if (port.sender?.id !== chrome.runtime.id || port.name !== "meter") return;
  let timer;
  port.onMessage.addListener(({ tabId }) => {
    clearInterval(timer);
    const send = () => {
      const state = sessions.get(tabId)?.snapshot() || null;
      port.postMessage({ state });
      if (!state) clearInterval(timer);
    };
    send();
    timer = setInterval(send, METER_INTERVAL);
  });
  port.onDisconnect.addListener(() => clearInterval(timer));
});
