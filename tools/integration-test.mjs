/* global chrome, amp -- used inside page and extension callbacks */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import path from "node:path";
import http from "node:http";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const pass = (test, extra = {}) => { results.push({ test, passed: true, ...extra }); console.log(`PASS ${test}${Object.keys(extra).length ? " " + JSON.stringify(extra) : ""}`); };
const server = http.createServer(async (req, res) => {
  if (req.url === "/speech.wav") { res.setHeader("Content-Type", "audio/wav"); res.end(await fs.readFile(".cache/test-speech.wav")); return; }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><title>Tonvela Local Test</title><button id="play">Play test tone</button><audio src="/speech.wav" preload="auto" controls loop></audio><script>document.querySelector("#play").onclick=()=>{window.ctx=new AudioContext({sampleRate:48000});window.osc=new OscillatorNode(ctx,{frequency:440});window.amp=new GainNode(ctx,{gain:0.02});osc.connect(amp).connect(ctx.destination);osc.start();ctx.resume();}</script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const extension = path.resolve("extension");
// A fresh profile each run: a kept one can start the extension's previous service worker code.
const profile = path.resolve(".cache/fulltest-profile");
await fs.rm(profile, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(profile, { headless: true, executablePath: chromium.executablePath(), ignoreDefaultArgs: ["--disable-extensions", "--mute-audio"], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging", "--window-size=1280,1000", "--lang=en-US"], viewport: { width: 1000, height: 800 }, screen: { width: 1280, height: 1000 } });
let sequence = 0;
const calls = new Map();
const runtimeErrors = [];
const networkRequests = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => Promise.all([chrome.storage.local.clear(), chrome.storage.session.clear()]));
  let page = await context.newPage();
  await page.goto(url);
  await page.locator("#play").click();
  await page.waitForFunction(() => document.querySelector("audio").readyState >= 3);
  const cdp = await context.browser().newBrowserCDPSession();
  cdp.on("Target.receivedMessageFromTarget", ({ message }) => {
    const parsed = JSON.parse(message);
    if (parsed.id) {
      const call = calls.get(parsed.id);
      if (call) { calls.delete(parsed.id); clearTimeout(call.timeout); parsed.error ? call.reject(new Error(JSON.stringify(parsed.error))) : call.resolve(parsed.result); }
    } else if (parsed.method === "Runtime.exceptionThrown") runtimeErrors.push(parsed.params.exceptionDetails.text + " " + (parsed.params.exceptionDetails.exception?.description || ""));
    else if (parsed.method === "Network.requestWillBeSent") networkRequests.push(parsed.params.request.url);
  });
  async function send(sessionId, method, params = {}) {
    const number = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { calls.delete(number); reject(new Error(`${method} timed out`)); }, 15000);
      calls.set(number, { resolve, reject, timeout });
      cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: number, method, params }) }).catch(error => { clearTimeout(timeout); calls.delete(number); reject(error); });
    });
  }
  async function attach(target) {
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false });
    await send(sessionId, "Runtime.enable");
    await send(sessionId, "Network.enable");
    return sessionId;
  }
  async function evaluate(sessionId, expression) {
    const result = await send(sessionId, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  let tabTarget = (await cdp.send("Target.getTargets", { filter: [{ type: "tab" }, { exclude: true }] })).targetInfos.find(t => t.url === url);
  async function openPopup() {
    await page.bringToFront();
    await cdp.send("Extensions.triggerAction", { id, targetId: tabTarget.targetId });
    let target;
    for (let i = 0; i < 30; i++) {
      target = (await cdp.send("Target.getTargets")).targetInfos.find(t => t.url === `chrome-extension://${id}/popup.html`);
      if (target) break;
      await delay(100);
    }
    assert.ok(target, "popup opens");
    const session = await attach(target);
    await until(async () => await evaluate(session, 'document.querySelector("#status-text").textContent !== ""'));
    return { session, target };
  }
  async function until(predicate, timeout = 10000) {
    const start = Date.now();
    while (!await predicate()) { if (Date.now() - start > timeout) throw new Error("Condition timed out"); await delay(100); }
  }
  let popup = await openPopup();
  let ui = expression => evaluate(popup.session, expression);
  // The popup may hold focus, so find the test tab by URL (visible after activeTab is granted).
  const tabId = (await worker.evaluate(target => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === target)?.id), url));
  assert.ok(Number.isInteger(tabId), "test tab found");
  const request = (type, extra = {}) => ui(`chrome.runtime.sendMessage(${JSON.stringify({ target: "background", type, tabId, ...extra })})`);
  const state = async () => (await request("state")).state;
  const engineOpen = async () => (await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }))).length > 0;
  const click = selector => ui(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({block:"nearest"}); if (!element.checkVisibility() || element.disabled) throw new Error("Control is not available: " + ${JSON.stringify(selector)}); element.click(); })()`);
  const pick = (selector, value) => ui(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event("change", {bubbles:true})); })()`);
  const emptyLabels = () => ui('[...document.querySelectorAll("[data-i18n]")].filter(e => !e.textContent.trim()).map(e => e.dataset.i18n)');
  let shown = "main";
  const open = async name => {
    if (name === shown) return;
    if (shown !== "main") await click(`#${shown}-view [data-back]`);
    if (name !== "main") await click(name === "modes" ? "#open-modes" : "#open-settings");
    shown = name;
  };
  const setTheme = async value => {
    await pick("#theme", value);
    await until(async () => (await worker.evaluate(() => chrome.storage.local.get("theme"))).theme === value);
  };

  const original = await ui('({height:document.body.scrollHeight,status:document.querySelector("#status-text").textContent,lang:document.documentElement.lang,dir:document.documentElement.dir,presets:[...document.querySelectorAll("#presets button")].map(b => b.textContent),originalHidden:document.querySelector("#original").classList.contains("concealed")})');
  assert.equal(original.status, "Original sound");
  assert.deepEqual([original.lang, original.dir], ["en", "ltr"], "Chrome's English is the starting language");
  assert.deepEqual(original.presets, ["100%", "200%", "400%"]);
  assert.ok(original.originalHidden && original.height < 450, JSON.stringify(original));
  assert.equal(await state(), null, "opening Tonvela does not capture the tab");
  assert.equal(await engineOpen(), false);
  assert.equal(await ui('document.querySelector("a[href^=http]")'), null, "no external links in the popup");
  assert.deepEqual(await emptyLabels(), []);
  pass("Popup opens on the original sound without capturing the tab", original);

  await open("settings");
  for (const [language, dir] of [["tr", "ltr"], ["es", "ltr"], ["pt_BR", "ltr"], ["ar", "rtl"]]) {
    await pick("#language", language);
    await until(async () => await ui("document.documentElement.lang") === language.replace("_", "-"));
    assert.equal(await ui("document.documentElement.dir"), dir, language);
    assert.deepEqual(await emptyLabels(), [], `${language} labels`);
    assert.ok(await ui("document.body.scrollWidth === 372"), `${language} fits the popup width`);
  }
  await pick("#language", "tr");
  await until(async () => await ui("document.documentElement.lang") === "tr");
  assert.equal(await ui('document.querySelector("#presets button").textContent'), "%100");
  await pick("#language", "en");
  await until(async () => await ui("document.documentElement.lang") === "en");
  assert.equal((await worker.evaluate(() => chrome.storage.local.get("language"))).language, "en");
  pass("Interface switches between English, Turkish, Spanish, Portuguese and right-to-left Arabic");

  await send(popup.session, "Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await until(async () => await ui('document.documentElement.dataset.theme === "light"'));
  await send(popup.session, "Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await until(async () => await ui('document.documentElement.dataset.theme === "dark"'));
  await setTheme("light");
  await until(async () => await ui('document.documentElement.dataset.theme === "light"'));
  await setTheme("system");
  pass("Appearance follows the system by default; light and dark can be chosen");
  await open("main");

  await click('#presets [data-volume="400"]');
  await until(async () => (await state())?.meter.inputDb > -50);
  await until(async () => await ui('document.querySelector("#status-text").classList.contains("active")'));
  assert.equal(await ui('document.querySelector("#volume").getAttribute("aria-valuenow")'), "400");
  const active = await ui('({height:document.body.scrollHeight,originalVisible:!document.querySelector("#original").classList.contains("concealed")})');
  assert.ok(active.originalVisible && active.height < 450, JSON.stringify(active));
  pass("Choosing a volume captures the tab and shows the way back", active);
  const screenshot = await send(popup.session, "Page.captureScreenshot", { format: "png" });
  await fs.writeFile(".cache/popup-active.png", Buffer.from(screenshot.data, "base64"));
  const offscreenTarget = (await cdp.send("Target.getTargets")).targetInfos.find(t => t.url === `chrome-extension://${id}/offscreen.html`);
  // Attaching enables runtime-error and network monitoring in the audio engine.
  await attach(offscreenTarget);

  await context.setOffline(true);
  await delay(600);
  const boosted = await state();
  assert.equal(boosted.contextState, "running");
  assert.ok(Math.abs(boosted.meter.outputDb - boosted.meter.inputDb - 12.0412) < 0.2);
  pass("400 percent gain through the real tab stream", { gainDb: boosted.meter.outputDb - boosted.meter.inputDb });

  await page.evaluate(() => amp.gain.value = 0.5);
  await open("settings");
  await click('input[name="protection"][value="strict"]');
  await until(async () => (await worker.evaluate(() => chrome.storage.local.get("listener"))).listener?.protection === "strict");
  await delay(800);
  let peak = 0;
  for (let i = 0; i < 8; i++) { peak = Math.max(peak, (await state()).meter.peak); await delay(120); }
  assert.ok(peak <= 10 ** (-12 / 20) + 1e-3 && peak > 10 ** (-13.5 / 20), `strict peak ${peak}`);
  await click('input[name="protection"][value="off"]');
  pass("Hearing protection keeps peaks under the strict ceiling at 400%", { peakDb: 20 * Math.log10(peak) });
  await page.evaluate(() => amp.gain.value = 0.02);

  const deviceError = await request("listener", { listener: { outputDevice: "missing-device" }, settings: boosted.settings });
  assert.equal(deviceError.ok, false);
  assert.ok((await state())?.active, "a missing output device keeps the session on the default device");
  assert.equal((await request("state")).listener.outputDevice, "", "a device that failed is not kept as the choice");
  await request("listener", { listener: {}, settings: boosted.settings });
  pass("A missing output device falls back to the default device");

  await open("main");
  await click('#presets [data-volume="100"]');
  await open("modes");
  await click('input[name="mode"][value="steady"]');
  await until(async () => (await state())?.settings.mode === "steady");
  await until(async () => await ui('!document.querySelector("#target-panel").hidden && !document.querySelector("#learn").disabled'));
  // Let Steady settle so the last two seconds of output are level.
  await delay(4000);
  const beforeLearn = (await state()).meter.outputDb;
  await click("#learn");
  await until(async () => await ui('!document.querySelector("#feedback").hidden'));
  const learned = await state();
  assert.ok(Math.abs(learned.settings.targetDb - beforeLearn) < 1.2, JSON.stringify({ beforeLearn, learned: learned.settings }));
  pass("Keep this level uses the audible level as the target", { targetDb: learned.settings.targetDb });
  await click("#undo");
  await until(async () => (await state()).settings.targetDb === -22);
  pass("Undo restores the settings from before the captured target");

  await request("apply", { settings: { ...learned.settings, mode: "steady", targetDb: -30, volume: 100 }, final: true });
  await page.evaluate(() => amp.gain.value = 0.04);
  await delay(1800);
  const quiet = await state();
  await page.evaluate(() => amp.gain.value = 0.16);
  await delay(1500);
  const loud = await state();
  assert.ok(Math.abs(quiet.meter.outputDb - loud.meter.outputDb) < 1);
  pass("Stable output across changing video volume", { quietDb: quiet.meter.outputDb, loudDb: loud.meter.outputDb });

  for (const mode of ["speech", "night", "music"]) {
    await click(`input[name="mode"][value="${mode}"]`);
    await until(async () => (await state())?.settings.mode === mode);
    assert.equal(await ui('document.querySelector("#error").hidden'), true);
    assert.equal(await ui('document.querySelector("#target-panel").hidden'), mode === "music", mode);
  }
  pass("Speech, night and music mode switching");
  await page.evaluate(async () => { amp.gain.value = 0; const audio = document.querySelector("audio"); audio.volume = 0.2; await audio.play(); });
  await click('input[name="mode"][value="voice"]');
  try { await until(async () => (await state())?.settings.mode === "voice", 15000); }
  catch (error) { console.log("VOICE DEBUG", await ui("document.body.innerText"), runtimeErrors, await state()); throw error; }
  await until(async () => (await state())?.meter.outputDb > -60);
  assert.equal(await ui('document.querySelector("#error").hidden'), true);
  // Speech has pauses, so sample for a few seconds instead of reading one moment.
  const voiceSamples = [];
  for (let i = 0; i < 15; i++) { voiceSamples.push((await state()).meter); await delay(200); }
  const voiceLoudest = Math.max(...voiceSamples.map(meter => meter.outputDb));
  assert.ok(voiceLoudest > -40, `speech keeps playing through the model: ${voiceLoudest}`);
  assert.ok(voiceSamples.every(meter => !meter.voiceLate), "model worker keeps up with real time");
  pass("Local speech model loads and processes speech with browser offline", { loudestDb: voiceLoudest });
  const modesLayout = await ui("({bodyHeight:document.body.scrollHeight,width:document.body.scrollWidth})");
  await open("settings");
  const settingsLayout = await ui("({bodyHeight:document.body.scrollHeight,width:document.body.scrollWidth})");
  for (const layout of [modesLayout, settingsLayout]) assert.ok(layout.bodyHeight <= 600 && layout.width === 372, JSON.stringify(layout));
  pass("Mode list and settings fit within Chrome's popup size", { modes: modesLayout, settings: settingsLayout });
  await open("main");

  await request("apply", { settings: { volume: 137, mode: "normal" }, final: true });
  await page.evaluate(() => { document.querySelector("audio").pause(); amp.gain.value = 0.02; });
  await cdp.send("Target.closeTarget", { targetId: popup.target.targetId });
  await delay(1000);
  // Use a normal extension page as the test control after the popup closes.
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/help.html`);
  const controlRequest = (type, extra = {}, target = tabId) => control.evaluate(message => chrome.runtime.sendMessage(message), { target: "background", type, tabId: target, ...extra });
  const persisted = await controlRequest("state");
  assert.ok(persisted.state.active && persisted.state.meter.outputDb > -60);
  pass("Closing the popup does not stop audio");
  popup = await openPopup();
  shown = "main";
  await until(async () => await ui('document.querySelector("#volume").getAttribute("aria-valuenow") === "137"'));
  assert.equal(await ui('document.querySelector("#status-text").classList.contains("active")'), true);
  await setTheme("dark");
  await until(async () => await control.evaluate(() => document.documentElement.dataset.theme) === "dark");
  await setTheme("system");
  pass("Reopening shows the running session; help shares the theme");
  await page.evaluate(() => amp.gain.value = 0);
  await delay(2300);
  const silentLearn = await controlRequest("learn");
  assert.equal(silentLearn.ok, false);
  pass("Silent video cannot set a false target");
  await page.evaluate(() => amp.gain.value = 0.02);

  await click("#original");
  await until(async () => !(await state()) && !(await engineOpen()));
  assert.equal((await worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).filter(item => item.status === "active").length, 0);
  assert.equal(await ui('document.querySelector("#volume").getAttribute("aria-valuenow")'), "100");
  pass("Back to original sound releases the capture and the audio engine");

  await open("settings");
  await click("#mono");
  await until(async () => (await state())?.active === true);
  await click("#mono");
  await until(async () => !(await state()));
  pass("Mono on its own captures the tab and releases it when turned off");
  await open("main");

  await click('#presets [data-volume="200"]');
  await until(async () => (await state())?.settings.volume === 200);
  await cdp.send("Target.closeTarget", { targetId: popup.target.targetId });
  await delay(700);
  const pageUrl = page.url();
  await page.close();
  await until(async () => !(await engineOpen()));
  pass("Closing the captured tab releases the audio engine");
  const sites = (await worker.evaluate(() => chrome.storage.local.get("sites"))).sites;
  assert.equal(sites[new URL(pageUrl).hostname].volume, 200);
  await context.setOffline(false);
  page = await context.newPage();
  await page.goto(pageUrl);
  await page.locator("#play").click();
  tabTarget = (await cdp.send("Target.getTargets", { filter: [{ type: "tab" }, { exclude: true }] })).targetInfos.find(t => t.url === pageUrl);
  popup = await openPopup();
  shown = "main";
  const reopenedTab = await worker.evaluate(target => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === target)?.id), pageUrl);
  await until(async () => (await controlRequest("state", {}, reopenedTab)).state?.settings.volume === 200);
  pass("Opening Tonvela on a remembered site applies its saved volume");
  await open("settings");
  await click("#remember");
  await until(async () => Object.keys((await worker.evaluate(() => chrome.storage.local.get("sites"))).sites || {}).length === 0);
  pass("Turning off site memory deletes the saved sites");
  await controlRequest("reset", {}, reopenedTab);

  assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));
  assert.equal(networkRequests.filter(value => /^https?:/.test(value)).length, 0);
  pass("No extension runtime errors and no external extension requests", { localRequests: networkRequests.length });
  await fs.writeFile(".cache/integration-results.json", JSON.stringify({ browser: context.browser().version(), results, runtimeErrors, networkRequests }, null, 2));
} finally {
  for (const call of calls.values()) clearTimeout(call.timeout);
  await context.close();
  server.close();
}
