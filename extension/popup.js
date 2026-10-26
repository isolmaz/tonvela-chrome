import { MODES, PROTECTION, VOLUME_PRESETS, DEFAULT_SETTINGS, DEFAULT_LISTENER, normalizeSettings, normalizeListener, selectMode, isOriginal, readableError, clamp } from "./shared.js";
import { t, localizePage, loadLocale, saveLanguage, currentLanguage, LANGUAGES } from "./i18n.js";
import { saveTheme } from "./theme.js";

const $ = id => document.getElementById(id);
const COMMIT_DELAY = 600;
let tabId;
let settings = { ...DEFAULT_SETTINGS };
let listener = { ...DEFAULT_LISTENER };
let rememberSites = true;
let active = false;
let supported = false;
let starting = false;
let revision = 0;
let sendTimer;
let commitTimer;
let balanceTimer;
let feedbackTimer;
let undoAction = null;
let meterPort = null;
let lastState = null;

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
function show(view) {
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== view;
  document.querySelector("main").scrollTop = 0;
}

function buildControls() {
  $("presets").replaceChildren(...VOLUME_PRESETS.map(volume => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.volume = volume;
    return button;
  }));
  $("modes").replaceChildren(...Object.entries(MODES).map(([mode, info]) => {
    const label = document.createElement("label");
    label.className = "row mode-row";
    label.innerHTML = `<span class="row-label"><svg class="accent-icon" aria-hidden="true"><use href="#${info.icon}"/></svg><span class="mode-text"><span></span><small></small></span></span><input type="radio" name="mode" value="${mode}"><svg class="mode-check" aria-hidden="true"><use href="#check"/></svg>`;
    return label;
  }));
  $("protection").replaceChildren(...Object.keys(PROTECTION).map(level => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="protection" value="${level}"><span></span>`;
    return label;
  }));
  $("language").replaceChildren(...Object.entries(LANGUAGES).map(([code, name]) => new Option(name, code)));
}

// Text that depends on the interface language.
function localizeControls() {
  localizePage();
  for (const button of $("presets").children) button.textContent = t("volumePercent", button.dataset.volume);
  for (const label of $("modes").children) {
    const info = MODES[label.querySelector("input").value];
    label.querySelector(".mode-text > span").textContent = t(info.name);
    label.querySelector(".mode-text > small").textContent = t(info.description);
  }
  for (const label of $("protection").children) label.querySelector("span").textContent = t(`protection_${label.querySelector("input").value}`);
  $("site").textContent = siteLabel($("site").dataset.site);
}

function statusKey(meter) {
  if (!supported) return "offDescUnsupported";
  if (starting || (!active && (sendTimer || commitTimer) && !isOriginal(settings, listener))) return "statusPreparing";
  if (!active) return "statusOriginal";
  if (settings.volume === 0) return "statusMuted";
  if (meter?.voiceLate) return "meterVoiceLate";
  if (meter?.limiting > 0.08) return "meterLimiting";
  if (meter?.atLimit) return "meterAtLimit";
  if (!meter || meter.inputDb < -58) return "meterWaiting";
  return settings.leveling ? "meterLeveling" : "meterProcessing";
}
function renderStatus() {
  const text = t(statusKey(lastState?.meter));
  if ($("status-text").textContent !== text) $("status-text").textContent = text;
  $("status-text").classList.toggle("active", active && !starting);
}

function render() {
  $("volume-value").textContent = settings.volume;
  $("volume-fill").style.width = `${settings.volume / 4}%`;
  $("volume").classList.toggle("low", settings.volume < 40);
  $("volume-icon").setAttribute("href", settings.volume ? "#speaker" : "#speaker-off");
  $("volume").setAttribute("aria-valuenow", String(settings.volume));
  $("volume").setAttribute("aria-valuetext", t("volumePercent", settings.volume));
  $("volume").setAttribute("aria-disabled", String(!supported));
  $("volume").tabIndex = supported ? 0 : -1;
  for (const button of $("presets").children) {
    button.disabled = !supported;
    button.setAttribute("aria-pressed", String(Number(button.dataset.volume) === settings.volume));
  }
  const mode = MODES[settings.mode];
  $("mode-name").textContent = t(mode.name);
  $("mode-icon").setAttribute("href", `#${mode.icon}`);
  $("open-modes").disabled = !supported;
  for (const radio of document.querySelectorAll('input[name="mode"]')) { radio.checked = radio.value === settings.mode; radio.disabled = !supported || starting; }
  $("target-panel").hidden = !settings.leveling;
  $("target").value = settings.targetDb;
  $("target-value").textContent = `${Math.round((settings.targetDb + 48) / 42 * 100)} / 100`;
  $("target").setAttribute("aria-valuetext", t("targetValueText", $("target-value").textContent));
  updateFill($("target"));
  $("learn").disabled = !active || starting;
  $("original").classList.toggle("concealed", !supported || (!active && isOriginal(settings, listener)));
  $("original").disabled = starting;
  $("mono").checked = listener.mono;
  $("balance").value = listener.balance;
  $("balance-center").hidden = listener.balance === 0;
  $("balance").setAttribute("aria-valuetext", listener.balance ? t(listener.balance < 0 ? "balanceLeftValue" : "balanceRightValue", Math.abs(listener.balance)) : t("center"));
  for (const radio of document.querySelectorAll('input[name="protection"]')) radio.checked = radio.value === listener.protection;
  $("remember").checked = rememberSites;
  $("output-device").value = [...$("output-device").options].some(option => option.value === listener.outputDevice) ? listener.outputDevice : "";
  renderStatus();
}
const settled = () => !starting && !sendTimer && !commitTimer;

// Live status: the engine pushes snapshots while this popup is open.
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
    lastState = state;
    if (settled()) {
      const next = normalizeSettings(state.settings);
      if (!state.active !== !active || JSON.stringify(next) !== JSON.stringify(settings)) {
        active = !!state.active;
        settings = next;
        render();
        return;
      }
    }
    renderStatus();
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (meterPort !== port) return;
    meterPort = null;
    refresh();
  });
  port.postMessage({ tabId });
}

function showState(response) {
  active = !!response.state?.active;
  lastState = response.state || null;
  if (!active) {
    meterPort?.disconnect();
    meterPort = null;
  }
  render();
  connectMeter();
}

async function refresh() {
  if (!tabId || !settled()) return;
  const before = revision;
  try {
    const response = await request("state");
    if (before !== revision || !settled()) return;
    supported = response.supported;
    settings = normalizeSettings(response.settings);
    listener = normalizeListener(response.listener);
    rememberSites = response.rememberSites;
    $("site").dataset.site = response.site || "";
    $("site").textContent = siteLabel(response.site);
    if (response.error) error(readableError(response.error));
    showState(response);
  } catch (cause) { error(cause.message); }
}

// Sends the current settings. `final` marks the end of an interaction, which
// releases the capture when the sound is back to the original.
async function send(final) {
  clearTimeout(sendTimer);
  sendTimer = null;
  const current = ++revision;
  const value = { ...settings };
  const capturing = !active && !isOriginal(value, listener);
  if (capturing) { starting = true; render(); }
  try {
    const response = await request("apply", { settings: value, final });
    if (current === revision) {
      settings = normalizeSettings(response.settings);
      showState(response);
    }
  } catch (cause) {
    error(cause.message);
  } finally {
    if (capturing) { starting = false; render(); }
  }
}
function change(next, final) {
  settings = normalizeSettings(next);
  revision++;
  error();
  clearTimeout(sendTimer);
  clearTimeout(commitTimer);
  commitTimer = null;
  sendTimer = final ? null : setTimeout(() => send(false), 60);
  render();
  if (final) return send(true);
}
// Wheel and keyboard steps have no end event; commit after a short pause.
function stepVolume(volume) {
  change({ ...settings, volume: clamp(volume, 0, 400) }, false);
  commitTimer = setTimeout(() => { commitTimer = null; send(true); }, COMMIT_DELAY);
}

async function saveListener(next) {
  listener = normalizeListener(next);
  revision++;
  error();
  render();
  const capturing = !active && !isOriginal(settings, listener);
  if (capturing) { starting = true; render(); }
  try {
    const response = await request("listener", { listener, settings });
    listener = normalizeListener(response.listener);
    showState(response);
  } catch (cause) { error(cause.message); }
  finally { if (capturing) { starting = false; render(); } }
}

const rightToLeft = () => document.documentElement.dir === "rtl";
function volumeFromPointer(event) {
  const box = $("volume").getBoundingClientRect();
  const along = rightToLeft() ? box.right - event.clientX : event.clientX - box.left;
  return Math.round(clamp(along / box.width, 0, 1) * 400 / 5) * 5;
}
let dragging = false;
$("volume").addEventListener("pointerdown", event => {
  if (!supported) return;
  dragging = true;
  $("volume").setPointerCapture(event.pointerId);
  $("volume").classList.add("dragging");
  change({ ...settings, volume: volumeFromPointer(event) }, false);
});
$("volume").addEventListener("pointermove", event => { if (dragging) change({ ...settings, volume: volumeFromPointer(event) }, false); });
$("volume").addEventListener("pointerup", () => {
  if (!dragging) return;
  dragging = false;
  $("volume").classList.remove("dragging");
  change(settings, true);
});
$("volume").addEventListener("wheel", event => {
  if (!supported) return;
  event.preventDefault();
  stepVolume(settings.volume + (event.deltaY < 0 ? 5 : -5));
}, { passive: false });
$("volume").addEventListener("keydown", event => {
  if (!supported) return;
  const forward = rightToLeft() ? "ArrowLeft" : "ArrowRight";
  const backward = rightToLeft() ? "ArrowRight" : "ArrowLeft";
  const steps = { ArrowUp: 5, [forward]: 5, ArrowDown: -5, [backward]: -5, PageUp: 50, PageDown: -50 };
  if (event.key in steps) stepVolume(settings.volume + steps[event.key]);
  else if (event.key === "Home") stepVolume(0);
  else if (event.key === "End") stepVolume(400);
  else return;
  event.preventDefault();
});
$("presets").addEventListener("click", event => {
  const button = event.target.closest("button[data-volume]");
  if (button) change({ ...settings, volume: Number(button.dataset.volume) }, true);
});
$("modes").addEventListener("change", event => change(selectMode(settings, event.target.value), true));
$("target").addEventListener("input", () => change({ ...settings, targetDb: Number($("target").value) }, false));
$("target").addEventListener("change", () => change(settings, true));

$("learn").addEventListener("click", async () => {
  const previous = { ...settings };
  revision++;
  try {
    const response = await request("learn");
    settings = normalizeSettings(response.state.settings);
    showState(response);
    feedback(t("learnedFeedback"), () => change(previous, true).then(() => feedback(t("undoneFeedback"))));
  } catch (cause) { error(cause.message); }
});
$("undo").addEventListener("click", () => {
  const undo = undoAction;
  hideFeedback();
  undo?.();
});
$("original").addEventListener("click", async () => {
  clearTimeout(sendTimer);
  clearTimeout(commitTimer);
  sendTimer = commitTimer = null;
  revision++;
  error();
  hideFeedback();
  try {
    const response = await request("reset");
    settings = normalizeSettings(response.settings);
    showState(response);
  } catch (cause) { error(cause.message); }
});

$("open-modes").addEventListener("click", () => show("modes-view"));
$("open-settings").addEventListener("click", () => { show("settings-view"); listDevices(); });
for (const button of document.querySelectorAll("[data-back]")) button.addEventListener("click", () => show("main-view"));
$("mono").addEventListener("change", () => saveListener({ ...listener, mono: $("mono").checked }));
$("balance").addEventListener("input", () => {
  listener = { ...listener, balance: Number($("balance").value) };
  render();
  clearTimeout(balanceTimer);
  balanceTimer = setTimeout(() => saveListener(listener), 150);
});
$("balance-center").addEventListener("click", () => saveListener({ ...listener, balance: 0 }));
$("protection").addEventListener("change", event => saveListener({ ...listener, protection: event.target.value }));
$("output-device").addEventListener("change", () => saveListener({ ...listener, outputDevice: $("output-device").value }));
$("device-names").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("devices.html") }));
$("remember").addEventListener("change", async () => {
  try { rememberSites = (await request("remember", { rememberSites: $("remember").checked })).rememberSites; }
  catch (cause) { error(cause.message); }
  render();
});
$("theme").addEventListener("change", async () => {
  try { await saveTheme($("theme").value); }
  catch { error(t("errThemeSave")); }
});
$("language").addEventListener("change", async () => {
  try { await saveLanguage($("language").value); }
  catch { $("language").value = currentLanguage(); return; }
  localizeControls();
  render();
});
$("help").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL(t("helpPage")) }));
$("shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

// Without a granted device permission Chrome hides output names, so only the default is listed.
async function listDevices() {
  let outputs = [];
  try { outputs = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audiooutput" && device.deviceId && device.deviceId !== "default"); }
  catch { outputs = []; }
  const named = outputs.filter(device => device.label);
  const select = $("output-device");
  select.replaceChildren(new Option(t("defaultDevice"), ""), ...named.map(device => new Option(device.label, device.deviceId)));
  if (listener.outputDevice && !named.some(device => device.deviceId === listener.outputDevice)) select.append(new Option(t("savedDevice"), listener.outputDevice));
  $("device-names").hidden = named.length > 0;
  render();
}
navigator.mediaDevices?.addEventListener("devicechange", () => { if (!$("settings-view").hidden) listDevices(); });

buildControls();
await loadLocale().catch(() => {});
localizeControls();
$("language").value = currentLanguage();
render();
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error(t("errNoTab"));
  tabId = tab.id;
  await refresh();
  // Opening Tonvela applies a site's remembered sound, or the listener preferences.
  if (supported && !active && !isOriginal(settings, listener)) await send(true);
} catch (cause) { error(cause.message); }
