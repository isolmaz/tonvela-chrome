import { DEFAULT_SETTINGS, normalizeSettings, siteKey, readableError, rememberSite, applyCommand, createSerialQueue, createPendingWrites } from "./shared.js";
import { t, loadLocale } from "./i18n.js";

let creation;
const serialize = createSerialQueue();
// Slider drags send many updates; persist only the last one per site.
const writes = createPendingWrites(({ tab, settings }) => write(tab, settings), 400, flush => serialize(flush).catch(() => {}));

async function exists() {
  return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] })).length > 0;
}
async function ensureEngine() {
  if (await exists()) return;
  if (!creation) creation = chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "Process and play the selected tab's audio on this device." }).finally(() => { creation = null; });
  await creation;
}
async function audio(type, tabId, extra = {}) {
  const result = await chrome.runtime.sendMessage({ target: "offscreen", type, tabId, ...extra });
  if (!result?.ok) throw new Error(result?.error || "errEngineConnection");
  return result;
}
async function getSession(tabId) {
  if (!await exists()) return null;
  return (await audio("state", tabId)).state;
}
async function saved(tab) {
  const key = siteKey(tab.url);
  const data = await chrome.storage.local.get(["preferences", "sites"]);
  const last = data.preferences || DEFAULT_SETTINGS;
  return normalizeSettings(last.remember !== false && key && data.sites?.[key] ? data.sites[key] : last);
}
async function write(tab, settings) {
  const data = await chrome.storage.local.get("sites");
  await chrome.storage.local.set({ preferences: settings, sites: rememberSite(data.sites, siteKey(tab.url), settings) });
}
// Must run inside serialize(); earlier debounced writes land first.
async function save(tab, settings) {
  await writes.flush();
  await write(tab, settings);
}
async function badge(tabId, settings) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#087F78" });
  await chrome.action.setBadgeText({ tabId, text: settings ? `${settings.volume}%` : "" });
  await chrome.action.setTitle({ tabId, title: settings ? t(settings.leveling ? "titleActiveLeveling" : "titleActive", settings.volume) : t("extName") });
}
async function closeIfEmpty(tabId) {
  if (await exists() && (await audio("state", tabId)).count === 0) await chrome.offscreen.closeDocument();
}
async function start(tab, settings) {
  if (!siteKey(tab.url)) throw new Error("errUnsupportedPage");
  const existing = await getSession(tab.id);
  if (existing) return (await audio("update", tab.id, { settings })).state;
  await ensureEngine();
  try {
    // Prepare models BEFORE obtaining the short-lived, single-use stream token.
    await audio("prepare", tab.id, { settings });
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const result = await audio("attach", tab.id, { streamId });
    await chrome.storage.session.remove(`error:${tab.id}`);
    await save(tab, settings);
    await badge(tab.id, settings);
    return result.state;
  } catch (error) {
    if (await exists()) { await audio("stop", tab.id).catch(() => {}); await closeIfEmpty(tab.id); }
    throw error;
  }
}

async function handle(message) {
  if (message.type === "session-ended") {
    await badge(message.tabId, null).catch(() => {});
    if (message.error) await chrome.storage.session.set({ [`error:${message.tabId}`]: readableError(message.error) });
    await closeIfEmpty(message.tabId);
    return {};
  }
  if (!Number.isInteger(message.tabId)) throw new Error("errNoTab");
  const tab = await chrome.tabs.get(message.tabId);
  if (message.type === "state") {
    if (writes.size) await serialize(writes.flush);
    const state = await getSession(tab.id);
    const errors = await chrome.storage.session.get(`error:${tab.id}`);
    return { state, settings: state?.settings || await saved(tab), site: siteKey(tab.url), supported: !!siteKey(tab.url), error: errors[`error:${tab.id}`] || null };
  }
  if (message.type === "start") return { state: await start(tab, normalizeSettings(message.settings)) };
  if (message.type === "stop") {
    if (await exists()) { await audio("stop", tab.id); await closeIfEmpty(tab.id); }
    await badge(tab.id, null);
    await chrome.storage.session.remove(`error:${tab.id}`);
    return { state: null };
  }
  if (message.type === "update") {
    const settings = normalizeSettings(message.settings);
    const current = await getSession(tab.id);
    const state = current ? (await audio("update", tab.id, { settings })).state : null;
    writes.schedule(siteKey(tab.url), { tab, settings });
    if (current) await badge(tab.id, settings);
    return { state, settings };
  }
  if (message.type === "learn") {
    const result = await audio("learn", tab.id);
    await save(tab, result.state.settings);
    await badge(tab.id, result.state.settings);
    return result;
  }
  throw new Error("errUnknownAction");
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== "background") return;
  const task = loadLocale().catch(() => {}).then(() => message.type === "state" ? handle(message) : serialize(() => handle(message)));
  task.then(value => respond({ ok: true, ...value }), error => respond({ ok: false, error: readableError(error) }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  serialize(async () => {
    if (await exists()) { await audio("stop", tabId); await closeIfEmpty(tabId); }
    await chrome.storage.session.remove(`error:${tabId}`);
  }).catch(() => {});
});

chrome.commands.onCommand.addListener(command => {
  serialize(async () => {
    await loadLocale().catch(() => {});
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await writes.flush();
    const state = await getSession(tab.id);
    const settings = applyCommand(state?.settings || await saved(tab), command);
    if (!settings) return;
    if (state) { await audio("update", tab.id, { settings }); await badge(tab.id, settings); }
    else await start(tab, settings);
    await save(tab, settings);
  }).catch(async error => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.storage.session.set({ [`error:${tab.id}`]: readableError(error) });
  });
});
