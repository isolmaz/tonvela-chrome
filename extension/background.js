import { DEFAULT_SETTINGS, normalizeSettings, normalizeListener, isOriginal, siteKey, readableError, rememberSite, applyCommand, createSerialQueue, createPendingWrites } from "./shared.js";
import { t, loadLocale } from "./i18n.js";

let creation;
const serialize = createSerialQueue();
// Dial drags send many updates; persist only the last one per site.
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
async function preferences() {
  const data = await chrome.storage.local.get(["sites", "listener", "rememberSites"]);
  return { sites: data.sites || {}, listener: normalizeListener(data.listener), rememberSites: data.rememberSites !== false };
}
// A site starts from its remembered settings, otherwise from the original sound.
async function initial(tab) {
  const { sites, rememberSites } = await preferences();
  const key = siteKey(tab.url);
  return normalizeSettings(rememberSites && key && sites[key] ? sites[key] : DEFAULT_SETTINGS);
}
async function write(tab, settings) {
  const { sites, rememberSites } = await preferences();
  const key = siteKey(tab.url);
  if (!rememberSites || !key) return;
  const isDefault = ["volume", "mode", "targetDb"].every(name => settings[name] === DEFAULT_SETTINGS[name]);
  const next = isDefault ? { ...sites } : rememberSite(sites, key, settings);
  if (isDefault) delete next[key];
  await chrome.storage.local.set({ sites: next });
}
async function badge(tabId, settings) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#087F78" });
  await chrome.action.setBadgeText({ tabId, text: settings ? t("volumePercent", settings.volume) : "" });
  await chrome.action.setTitle({ tabId, title: settings ? t(settings.leveling ? "titleActiveLeveling" : "titleActive", settings.volume) : t("extName") });
}
async function closeIfEmpty(tabId) {
  if (await exists() && (await audio("state", tabId)).count === 0) await chrome.offscreen.closeDocument();
}
async function release(tabId) {
  if (await exists()) { await audio("stop", tabId); await closeIfEmpty(tabId); }
  await badge(tabId, null).catch(() => {});
  await chrome.storage.session.remove(`error:${tabId}`);
}
async function start(tab, settings, listener) {
  if (!siteKey(tab.url)) throw new Error("errUnsupportedPage");
  await ensureEngine();
  try {
    // Prepare models BEFORE obtaining the short-lived, single-use stream token.
    await audio("prepare", tab.id, { settings, listener });
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const result = await audio("attach", tab.id, { streamId });
    await chrome.storage.session.remove(`error:${tab.id}`);
    return result.state;
  } catch (error) {
    if (await exists()) { await audio("stop", tab.id).catch(() => {}); await closeIfEmpty(tab.id); }
    throw error;
  }
}
// Captures the tab when the settings change its sound. Back at the original sound,
// a final change releases the capture; intermediate steps of a drag keep it.
async function apply(tab, settings, final) {
  const { listener } = await preferences();
  const current = await getSession(tab.id);
  const original = isOriginal(settings, listener);
  let state = null;
  if (current && original && final) await release(tab.id);
  else if (current) state = (await audio("update", tab.id, { settings })).state;
  else if (!original) state = await start(tab, settings, listener);
  if (state) await badge(tab.id, settings);
  return state;
}

async function handle(message) {
  if (message.type === "session-ended") {
    await badge(message.tabId, null).catch(() => {});
    if (message.error) await chrome.storage.session.set({ [`error:${message.tabId}`]: message.error });
    await closeIfEmpty(message.tabId);
    return {};
  }
  if (!Number.isInteger(message.tabId)) throw new Error("errNoTab");
  const tab = await chrome.tabs.get(message.tabId);
  if (message.type === "state") {
    if (writes.size) await serialize(writes.flush);
    const state = await getSession(tab.id);
    const { listener, rememberSites } = await preferences();
    const errors = await chrome.storage.session.get(`error:${tab.id}`);
    return { state, settings: state?.settings || await initial(tab), listener, rememberSites, site: siteKey(tab.url), supported: !!siteKey(tab.url), error: errors[`error:${tab.id}`] || null };
  }
  if (message.type === "apply") {
    const settings = normalizeSettings(message.settings);
    const state = await apply(tab, settings, message.final === true);
    writes.schedule(siteKey(tab.url), { tab, settings });
    return { state, settings };
  }
  if (message.type === "listener") {
    const listener = normalizeListener(message.listener);
    await chrome.storage.local.set({ listener });
    if (await exists()) {
      try { await audio("listener", tab.id, { listener }); }
      catch (error) {
        // A device that can't play stays unselected, so the tab isn't captured for it.
        if (error.message === "errOutputDevice") {
          const fallback = { ...listener, outputDevice: "" };
          await chrome.storage.local.set({ listener: fallback });
          await audio("listener", tab.id, { listener: fallback });
          const current = await getSession(tab.id);
          if (current) await apply(tab, current.settings, true);
        }
        throw error;
      }
    }
    const current = await getSession(tab.id);
    return { state: await apply(tab, current?.settings || normalizeSettings(message.settings), true), listener };
  }
  if (message.type === "reset") {
    await writes.flush();
    await release(tab.id);
    await write(tab, DEFAULT_SETTINGS);
    return { state: null, settings: normalizeSettings(DEFAULT_SETTINGS) };
  }
  if (message.type === "remember") {
    const rememberSites = message.rememberSites === true;
    await writes.flush();
    await chrome.storage.local.set(rememberSites ? { rememberSites } : { rememberSites, sites: {} });
    const current = await getSession(tab.id);
    if (rememberSites && current) await write(tab, current.settings);
    return { rememberSites };
  }
  if (message.type === "learn") {
    if (!await exists()) throw new Error("errStartFirst");
    const result = await audio("learn", tab.id);
    await writes.flush();
    await write(tab, result.state.settings);
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
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return;
    await writes.flush();
    const state = await getSession(tab.id);
    const settings = applyCommand(state?.settings || await initial(tab), command);
    if (!settings) return;
    await apply(tab, settings, true);
    await write(tab, settings);
  }).catch(async error => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) await chrome.storage.session.set({ [`error:${tab.id}`]: String(error?.message || error) });
  });
});

// Settings stored under "preferences" carry a global remember flag; keep its choice once, then drop the key.
chrome.runtime.onInstalled.addListener(async () => {
  const { preferences: legacy } = await chrome.storage.local.get("preferences");
  if (!legacy) return;
  if (legacy.remember === false) await chrome.storage.local.set({ rememberSites: false, sites: {} });
  await chrome.storage.local.remove("preferences");
});
