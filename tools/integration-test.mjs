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
const context = await chromium.launchPersistentContext(path.resolve(".cache/fulltest-profile"), { headless: true, executablePath: chromium.executablePath(), ignoreDefaultArgs: ["--disable-extensions", "--mute-audio"], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging", "--window-size=1280,1000"], viewport: { width: 1000, height: 800 }, screen: { width: 1280, height: 1000 } });
let sequence = 0;
const calls = new Map();
const runtimeErrors = [];
const networkRequests = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => Promise.all([chrome.storage.local.clear(), chrome.storage.session.clear()]));
  const page = await context.newPage();
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
  const tabTarget = (await cdp.send("Target.getTargets", { filter: [{ type: "tab" }, { exclude: true }] })).targetInfos.find(t => t.url === url);
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
    await until(async () => await evaluate(session, '!document.querySelector("#power-button").disabled'));
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
  const click = selector => ui(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({block:"nearest"}); if (!element.checkVisibility() || element.disabled) throw new Error("Control is not available: " + ${JSON.stringify(selector)}); element.click(); })()`);
  const setTheme = async value => {
    await ui(`(() => { const picker = document.querySelector("#theme"); picker.scrollIntoView({block:"nearest"}); picker.value = ${JSON.stringify(value)}; picker.dispatchEvent(new Event("change", {bubbles:true})); })()`);
    await until(async () => (await worker.evaluate(() => chrome.storage.local.get("theme"))).theme === value);
  };
  const offLayout = await ui('({height:document.body.scrollHeight,hidden:document.querySelector("#controls").hidden,advanced:document.querySelector("#advanced").open,theme:document.documentElement.dataset.theme,power:document.querySelector("#power-button").getAttribute("aria-checked")})');
  assert.ok(offLayout.height < 300 && offLayout.hidden && !offLayout.advanced);
  assert.equal(offLayout.theme, "dark");
  assert.equal(offLayout.power, "false");
  assert.equal(await ui('document.querySelector("a[href^=http]")'), null, "no external links in the popup");
  const labels = await ui('({empty:[...document.querySelectorAll("[data-i18n]")].filter(e => !e.textContent.trim()).map(e => e.dataset.i18n),power:document.querySelector("#power-label").textContent,lang:document.documentElement.lang})');
  assert.deepEqual(labels.empty, []);
  assert.deepEqual([labels.power, labels.lang], ["Off", "en"], "English is the default language");
  assert.equal(await ui('document.querySelector("[data-volume=\'100\']").textContent'), "100%", "quick buttons use the English percent format");
  const switchLanguage = async value => {
    await ui(`(() => { const picker = document.querySelector("#language"); picker.value = ${JSON.stringify(value)}; picker.dispatchEvent(new Event("change", {bubbles:true})); })()`);
    await until(async () => await ui('document.documentElement.lang') === value);
  };
  await switchLanguage("tr");
  assert.equal(await ui('document.querySelector("#power-label").textContent'), "Kapalı");
  assert.equal(await ui('document.querySelector("[data-volume=\'100\']").textContent'), "%100");
  assert.equal((await worker.evaluate(() => chrome.storage.local.get("language"))).language, "tr");
  await switchLanguage("en");
  assert.equal(await ui('document.querySelector("#power-label").textContent'), "Off");
  pass("Language defaults to English and switches to Turkish and back");
  pass("Compact disabled screen, dark default, no external links", offLayout);
  await ui('document.querySelector("#power-button").click()');
  await until(async () => (await state())?.meter.inputDb > -50);
  await until(async () => await ui('!document.querySelector("#power-button").disabled'));
  const simpleLayout = await ui('({height:document.body.scrollHeight,hidden:document.querySelector("#controls").hidden,advanced:document.querySelector("#advanced").open,learnVisible:document.querySelector("#learn").checkVisibility(),themeVisible:document.querySelector("#theme").checkVisibility(),power:document.querySelector("#power-button").getAttribute("aria-checked")})');
  assert.ok(simpleLayout.height < 550 && !simpleLayout.hidden && !simpleLayout.advanced && simpleLayout.learnVisible && !simpleLayout.themeVisible);
  assert.equal(simpleLayout.power, "true");
  pass("Enabled screen shows basic controls with advanced settings collapsed", simpleLayout);
  await until(async () => await ui('parseFloat(document.querySelector("#meter-fill").style.transform.replace("scaleX(", "")) > 0'));
  pass("Popup meter updates from the engine without polling");
  let screenshot = await send(popup.session, "Page.captureScreenshot", { format: "png" });
  await fs.writeFile(".cache/popup-simple-dark.png", Buffer.from(screenshot.data, "base64"));
  const base = await state();
  assert.equal(base.contextState, "running");
  pass("Actual tab capture and audible processed stream", { inputDb: base.meter.inputDb });
  const offscreenTarget = (await cdp.send("Target.getTargets")).targetInfos.find(t => t.url === `chrome-extension://${id}/offscreen.html`);
  // Attaching enables runtime-error and network monitoring in the audio engine.
  await attach(offscreenTarget);

  await context.setOffline(true);
  await ui(`document.querySelector('[data-volume="400"]').click()`);
  await delay(500);
  const boosted = await state();
  assert.ok(Math.abs(boosted.meter.outputDb - boosted.meter.inputDb - 12.0412) < 0.2);
  pass("400 percent gain through the real tab stream", { gainDb: boosted.meter.outputDb - boosted.meter.inputDb });
  await click("#advanced summary");
  await until(async () => await ui('document.querySelector(".content").scrollTop > 0'));
  assert.ok(await ui('document.querySelector(".modes").getBoundingClientRect().bottom <= document.querySelector(".content").getBoundingClientRect().bottom'));
  assert.equal(await ui('document.querySelector("#theme").checkVisibility()'), true);
  await setTheme("light");
  await until(async () => await ui('document.documentElement.dataset.theme === "light"'));
  await setTheme("system");
  await send(popup.session, "Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await until(async () => await ui('document.documentElement.dataset.theme === "light"'));
  await send(popup.session, "Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await until(async () => await ui('document.documentElement.dataset.theme === "dark"'));
  await setTheme("dark");
  pass("Advanced settings expose appearance; light, dark and live system theme work");
  await click("#reset");
  await until(async () => (await state()).settings.volume === 100);
  await until(async () => await ui('!document.querySelector("#power-button").disabled'));
  await click("#advanced summary");
  await delay(1500);
  const beforeLearn = (await state()).meter.outputDb;
  await ui('document.querySelector("#learn").click()');
  await until(async () => (await state()).settings.leveling);
  const learned = await state();
  assert.ok(Math.abs(learned.settings.targetDb - beforeLearn) < 1.2, JSON.stringify({beforeLearn, learned}));
  pass("Capture current audible level as target", { targetDb: learned.settings.targetDb });
  await until(async () => await ui('!document.querySelector("#undo").hidden && !document.querySelector("#undo").disabled'));
  await ui('document.querySelector("#undo").click()');
  await until(async () => { const settings = (await state()).settings; return !settings.leveling && settings.targetDb === -22; });
  await until(async () => await ui('!document.querySelector("#power-button").disabled && !document.querySelector("#leveling").checked'));
  pass("Undo restores the settings from before the captured target");

  await request("update", { settings: { ...learned.settings, mode: "steady", targetDb: -30, volume: 100 } });
  await page.evaluate(() => amp.gain.value = 0.04);
  await delay(1800);
  const quiet = await state();
  await page.evaluate(() => amp.gain.value = 0.16);
  await delay(1500);
  const loud = await state();
  assert.ok(Math.abs(quiet.meter.outputDb - loud.meter.outputDb) < 1);
  pass("Stable output across changing video volume", { quietDb: quiet.meter.outputDb, loudDb: loud.meter.outputDb });

  await click("#advanced summary");
  for (const mode of ["speech", "night", "music"]) {
    await click(`input[name="mode"][value="${mode}"]`);
    await until(async () => (await state())?.settings.mode === mode);
    await until(async () => await ui('!document.querySelector("#power-button").disabled'));
    assert.equal(await ui('document.querySelector("#error").hidden'), true);
  }
  pass("Speech, night and music mode switching");
  await page.evaluate(async () => { amp.gain.value = 0; const audio = document.querySelector("audio"); audio.volume = 0.2; await audio.play(); });
  await click('input[name="mode"][value="voice"]');
  try { await until(async () => (await state())?.settings.mode === "voice", 15000); }
  catch (error) { console.log("VOICE DEBUG", await ui('document.body.innerText'), runtimeErrors, await state()); throw error; }
  await until(async () => (await state())?.meter.outputDb > -60);
  assert.equal(await ui('document.querySelector("#error").hidden'), true);
  // Speech has pauses, so sample for a few seconds instead of reading one moment.
  const voiceSamples = [];
  for (let i = 0; i < 15; i++) { voiceSamples.push((await state()).meter); await delay(200); }
  const voiceLoudest = Math.max(...voiceSamples.map(meter => meter.outputDb));
  assert.ok(voiceLoudest > -40, `speech keeps playing through the model: ${voiceLoudest}`);
  assert.ok(voiceSamples.every(meter => !meter.voiceLate), "model worker keeps up with real time");
  const modelState = await state();
  pass("Local speech model loads and processes speech with browser offline", { loudestDb: voiceLoudest });
  await ui('document.querySelector("#theme").scrollIntoView({block:"center"})');
  screenshot = await send(popup.session, "Page.captureScreenshot", { format: "png" });
  await fs.writeFile(".cache/popup-final.png", Buffer.from(screenshot.data, "base64"));
  const layout = await ui('({bodyHeight:document.body.scrollHeight,width:document.body.scrollWidth,powerTop:document.querySelector("#power-button").getBoundingClientRect().top,footerBottom:document.querySelector("footer").getBoundingClientRect().bottom,themeBottom:document.querySelector("#theme").getBoundingClientRect().bottom,contentBottom:document.querySelector(".content").getBoundingClientRect().bottom,scrollable:document.querySelector(".content").scrollHeight>document.querySelector(".content").clientHeight})');
  assert.ok(layout.bodyHeight <= 600 && layout.width === 372 && layout.powerTop >= 0 && layout.footerBottom <= 600 && layout.themeBottom <= layout.contentBottom && layout.scrollable, JSON.stringify(layout));
  pass("Advanced popup scrolls within Chrome height while power and footer stay visible", layout);
  await setTheme("light");

  await request("update", { settings: { ...modelState.settings, mode: "normal", leveling: false, volume: 100 } });
  await page.evaluate(() => { document.querySelector("audio").pause(); amp.gain.value = 0.02; });
  await cdp.send("Target.closeTarget", { targetId: popup.target.targetId });
  await delay(1000);
  // Use a normal extension page as the test control after the popup closes.
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/help.html`);
  const controlRequest = (type, extra = {}) => control.evaluate(message => chrome.runtime.sendMessage(message), { target: "background", type, tabId, ...extra });
  const persisted = await controlRequest("state");
  assert.ok(persisted.state.active && persisted.state.meter.outputDb > -60);
  pass("Closing popup does not stop audio");
  popup = await openPopup();
  await until(async () => await ui('!document.querySelector("#controls").hidden'));
  assert.equal(await ui('document.querySelector("#advanced").open'), false);
  assert.equal(await ui('document.documentElement.dataset.theme'), "light");
  assert.equal(await ui('document.querySelector("#theme").value'), "light");
  assert.equal(await control.evaluate(() => document.documentElement.dataset.theme), "light");
  pass("Reopening preserves active audio and theme, closes advanced; help shares theme");
  await click("#advanced summary");
  await setTheme("dark");
  await cdp.send("Target.closeTarget", { targetId: popup.target.targetId });
  await page.evaluate(() => { document.querySelector("audio").pause(); amp.gain.value = 0; });
  await delay(2300);
  const silentLearn = await controlRequest("learn");
  assert.equal(silentLearn.ok, false);
  pass("Silent video cannot set a false target");

  await page.evaluate(() => amp.gain.value = 0.02);
  await controlRequest("update", { settings: { ...persisted.settings, volume: 137, remember: true } });
  popup = await openPopup();
  await click("#power-button");
  await until(async () => await ui('document.querySelector("#controls").hidden && !document.querySelector("#power-button").disabled'));
  assert.equal(await ui('document.querySelector("#advanced").open'), false);
  assert.ok(await ui('document.body.scrollHeight < 300'));
  const stopped = await controlRequest("state");
  assert.equal(stopped.state, null);
  assert.equal(stopped.settings.volume, 137);
  assert.equal((await worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).filter(item => item.status === "active").length, 0);
  assert.equal((await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }))).length, 0);
  pass("Stop releases capture and audio engine; saved site setting remains");
  await click("#power-button");
  await until(async () => !!(await state())?.active);
  assert.equal((await state()).settings.volume, 137);
  pass("Power switch restores the previous volume on restart");
  await page.close();
  await until(async () => (await worker.evaluate(() => chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"]}))).length === 0);
  pass("Closing the captured tab releases the audio engine");
  assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));
  assert.equal(networkRequests.filter(value => /^https?:/.test(value)).length, 0);
  pass("No extension runtime errors and no external extension requests", { localRequests: networkRequests.length });
  await fs.writeFile(".cache/integration-results.json", JSON.stringify({ browser: context.browser().version(), results, runtimeErrors, networkRequests }, null, 2));
} finally {
  for (const call of calls.values()) clearTimeout(call.timeout);
  await context.close();
  server.close();
}
