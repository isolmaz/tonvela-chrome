import { MODES, DEFAULT_SETTINGS, normalizeSettings, selectMode, clamp } from "./shared.js";
import { t, localizePage, loadLocale, saveLanguage, currentLanguage } from "./i18n.js";
import { saveTheme } from "./theme.js";

const $ = id => document.getElementById(id);
let tabId;
let settings = { ...DEFAULT_SETTINGS };
let active = false;
let supported = false;
let busy = false;
let revision = 0;
let pending = 0;
let updateTimer;
let feedbackTimer;
let undoAction = null;
let meterPort = null;
let lastState = null;
let renderedKey = "";
let meterView = { amount: -1, note: "" };

async function request(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ target: "background", type, tabId, ...extra });
  if (!response?.ok) throw new Error(response?.error || t("errNoExtension"));
  return response;
}
function error(text = "") { $("error").textContent = text; $("error").hidden = !text; }
function hideFeedback() { clearTimeout(feedbackTimer); $("feedback").hidden = true; undoAction = null; }
function feedback(text, undo = null) {
  clearTimeout(feedbackTimer);
  undoAction = undo;
  $("feedback-text").textContent = text;
  $("undo").hidden = !undo;
  $("feedback").hidden = false;
  feedbackTimer = setTimeout(hideFeedback, undo ? 8000 : 3000);
}
// "yerel-dosya" is the stored site key for file: pages; show it in the chosen language.
function siteLabel(site) { return site === "yerel-dosya" ? t("localFile") : site || t("openInVideoTab"); }
function updateFill(input) { input.style.setProperty("--fill", `${100 * (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))}%`); }

function render() {
  renderedKey = JSON.stringify([active, settings]);
  $("controls").hidden = !active;
  $("off-state").hidden = active;
  $("off-description").textContent = t(supported ? "offDescSupported" : "offDescUnsupported");
  if (!active) $("advanced").open = false;
  $("current-mode").textContent = t(MODES[settings.mode].name);
  $("volume").value = settings.volume;
  $("volume-value").textContent = settings.volume;
  $("volume").setAttribute("aria-valuetext", t("volumePercent", settings.volume));
  updateFill($("volume"));
  for (const radio of document.querySelectorAll('input[name="mode"]')) { radio.checked = radio.value === settings.mode; radio.disabled = busy; }
  $("mode-description").textContent = t(MODES[settings.mode].description);
  $("mode-tag").textContent = t(settings.mode === "voice" ? "tagVoice" : settings.mode === "music" ? "tagMusic" : settings.mode === "night" ? "tagNight" : settings.leveling ? "tagLeveled" : "tagNatural");
  $("leveling").checked = settings.leveling;
  $("leveling").disabled = busy;
  $("target-hint").hidden = settings.leveling;
  $("target").value = settings.targetDb;
  $("target-value").textContent = `${Math.round((settings.targetDb + 48) / 42 * 100)} / 100`;
  $("target").setAttribute("aria-valuetext", t("targetValueText", $("target-value").textContent));
  updateFill($("target"));
  $("remember").checked = settings.remember;
  $("power-button").disabled = busy || (!supported && !active);
  $("power-button").setAttribute("aria-checked", String(active));
  $("power-label").textContent = t(busy ? "powerWait" : active ? "powerOn" : "powerOff");
  $("learn").disabled = busy || !active;
  $("reset").disabled = busy;
  $("undo").disabled = busy;
  $("volume").disabled = busy;
  $("target").disabled = busy || !settings.leveling;
  $("remember").disabled = busy;
  for (const button of document.querySelectorAll("[data-volume]")) {
    button.disabled = busy;
    button.textContent = t("volumePercent", button.dataset.volume);
    button.setAttribute("aria-pressed", String(Number(button.dataset.volume) === settings.volume));
  }
  $("status-dot").classList.toggle("active", active);
  $("status-text").textContent = t(busy ? "statusPreparing" : active ? "statusActive" : supported ? "statusReady" : "statusUnsupported");
}
// Meter snapshots arrive several times a second; touch the DOM only when something visible changed.
function renderMeter(state) {
  lastState = state;
  const meter = state?.meter;
  const amount = Math.round(meter && active ? clamp((meter.outputDb + 60) / 54 * 100, 0, 100) : 0);
  const note = t(!active ? "meterStart" : meter?.voiceLate ? "meterVoiceLate" : meter?.limiting > 0.08 ? "meterLimiting" : meter?.atLimit ? "meterAtLimit" : !meter || meter.inputDb < -58 ? "meterWaiting" : settings.leveling ? "meterLeveling" : "meterProcessing");
  if (amount !== meterView.amount) {
    $("meter-fill").style.transform = `scaleX(${amount / 100})`;
    document.querySelector(".meter").setAttribute("aria-valuenow", String(amount));
  }
  if (note !== meterView.note) $("meter-note").textContent = note;
  meterView = { amount, note };
}
const settled = () => !busy && !pending && !updateTimer;

// Live meter: the engine pushes snapshots while this popup is open.
function connectMeter() {
  if (meterPort || !active || !tabId) return;
  const port = chrome.runtime.connect({ name: "meter" });
  meterPort = port;
  port.onMessage.addListener(({ state }) => {
    if (!state) {
      meterPort = null;
      port.disconnect();
      refresh();
      return;
    }
    if (settled()) {
      const next = normalizeSettings(state.settings);
      const key = JSON.stringify([!!state.active, next]);
      if (key !== renderedKey) {
        active = !!state.active;
        settings = next;
        render();
      }
    }
    renderMeter(state);
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (meterPort !== port) return;
    meterPort = null;
    refresh();
  });
  port.postMessage({ tabId });
}

async function refresh() {
  if (!tabId || !settled()) return;
  const before = revision;
  try {
    const response = await request("state");
    if (before !== revision || !settled()) return;
    supported = response.supported;
    active = !!response.state?.active;
    settings = normalizeSettings(response.settings);
    $("site").dataset.site = response.site || "";
    $("site").textContent = siteLabel(response.site);
    if (response.error) error(response.error);
    render();
    renderMeter(response.state);
    connectMeter();
  } catch (cause) { error(cause.message); }
}

async function saveChange() {
  clearTimeout(updateTimer);
  updateTimer = null;
  const current = ++revision;
  const value = { ...settings };
  pending++;
  try {
    const response = await request("update", { settings: value });
    if (current === revision) {
      active = !!response.state?.active;
      settings = normalizeSettings(response.settings || response.state?.settings || value);
      render();
    }
  } catch (cause) {
    error(cause.message);
  } finally { pending--; }
}
function changed(immediate = false) {
  revision++;
  error();
  render();
  clearTimeout(updateTimer);
  if (immediate) return saveChange();
  updateTimer = setTimeout(saveChange, 70);
}
async function action(operation) {
  if (busy) return;
  clearTimeout(updateTimer);
  updateTimer = null;
  busy = true;
  revision++;
  error();
  render();
  try { await operation(); }
  catch (cause) { error(cause.message); }
  finally { busy = false; render(); await refresh(); }
}

$("volume").addEventListener("input", () => { settings.volume = Number($("volume").value); changed(); });
$("volume").addEventListener("change", saveChange);
$("target").addEventListener("input", () => { settings.targetDb = Number($("target").value); changed(); });
$("target").addEventListener("change", saveChange);
document.querySelectorAll("[data-volume]").forEach(button => button.addEventListener("click", () => { settings.volume = Number(button.dataset.volume); changed(true); }));
document.querySelectorAll('input[name="mode"]').forEach(radio => radio.addEventListener("change", () => action(async () => {
  settings = selectMode(settings, radio.value);
  render();
  const response = await request("update", { settings });
  settings = normalizeSettings(response.settings || response.state?.settings);
})));
$("leveling").addEventListener("change", () => {
  settings.leveling = $("leveling").checked;
  if (!settings.leveling && settings.mode === "steady") settings.mode = "normal";
  changed(true);
});
$("remember").addEventListener("change", () => { settings.remember = $("remember").checked; changed(true); });
$("advanced").addEventListener("toggle", () => {
  if ($("advanced").open) $("advanced").querySelector("summary").scrollIntoView({ block: "start" });
  else document.querySelector(".content").scrollTop = 0;
});
$("theme").addEventListener("change", async () => {
  try { await saveTheme($("theme").value); }
  catch { error(t("errThemeSave")); }
});
$("power-button").addEventListener("click", () => action(async () => {
  if (active) await request("update", { settings });
  const response = await request(active ? "stop" : "start", { settings });
  active = !!response.state?.active;
  if (!active) {
    hideFeedback();
    document.querySelector(".content").scrollTop = 0;
  }
}));
$("learn").addEventListener("click", () => action(async () => {
  const previous = { ...settings };
  const response = await request("learn");
  settings = normalizeSettings(response.state.settings);
  feedback(t("learnedFeedback"), async () => {
    const restored = await request("update", { settings: previous });
    settings = normalizeSettings(restored.settings || previous);
    feedback(t("undoneFeedback"));
  });
}));
$("undo").addEventListener("click", () => {
  const undo = undoAction;
  hideFeedback();
  if (undo) action(undo);
});
$("reset").addEventListener("click", () => action(async () => {
  settings = { ...DEFAULT_SETTINGS, remember: settings.remember };
  await request("update", { settings });
  feedback(t("resetFeedback"));
  document.querySelector(".content").scrollTop = 0;
}));
$("language").addEventListener("change", async () => {
  try { await saveLanguage($("language").value); }
  catch { $("language").value = currentLanguage(); return; }
  localizePage();
  $("site").textContent = siteLabel($("site").dataset.site);
  meterView = { amount: -1, note: "" };
  render();
  renderMeter(lastState);
});
$("help").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL(t("helpPage")) }));
$("shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

await loadLocale().catch(() => {});
localizePage();
$("language").value = currentLanguage();
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error(t("errNoTab"));
  tabId = tab.id;
  await refresh();
} catch (cause) { error(cause.message); }
