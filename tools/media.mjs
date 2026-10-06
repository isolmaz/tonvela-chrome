/* global chrome -- used inside extension callbacks */
// Records the README GIFs (docs/media) and Chrome Web Store images (dist/store, or
// the folder in TONVELA_STORE_DIR)
// from the real extension popup in Chromium. Needs .cache/test-speech.wav
// (tools/create-speech-fixture.ps1) and plays it audibly while recording.
import { createRequire } from "node:module";
import path from "node:path";
import http from "node:http";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sharp = require("sharp");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const HOST = "video.example";
const POPUP_SCALE = 1;
const PAD = 36;
const BACKDROP = ["#0b2b28", "#081614"];
const media = path.resolve("docs/media");
const store = path.resolve(process.env.TONVELA_STORE_DIR || "dist/store");
await fs.mkdir(media, { recursive: true });
await fs.mkdir(store, { recursive: true });

const server = http.createServer(async (req, res) => {
  if (req.url === "/speech.wav") { res.setHeader("Content-Type", "audio/wav"); res.end(await fs.readFile(".cache/test-speech.wav")); return; }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><title>Video</title><button id="play">Play</button><audio src="/speech.wav" preload="auto" loop></audio><script>document.querySelector("#play").onclick=()=>{document.querySelector("audio").play();window.ctx=new AudioContext({sampleRate:48000});window.osc=new OscillatorNode(ctx,{frequency:220});window.amp=new GainNode(ctx,{gain:0.05});osc.connect(amp).connect(ctx.destination);osc.start();}</script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://${HOST}:${port}/`;
const extension = path.resolve("extension");
const profile = await fs.mkdtemp(path.resolve(".cache/media-profile-"));
const context = await chromium.launchPersistentContext(profile, { headless: true, executablePath: chromium.executablePath(), ignoreDefaultArgs: ["--disable-extensions", "--mute-audio"], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging", `--host-resolver-rules=MAP ${HOST} 127.0.0.1`], viewport: { width: 1000, height: 800 } });

const calls = new Map();
let sequence = 0;
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
    const call = parsed.id && calls.get(parsed.id);
    if (!call) return;
    calls.delete(parsed.id);
    parsed.error ? call.reject(new Error(JSON.stringify(parsed.error))) : call.resolve(parsed.result);
  });
  const send = (sessionId, method, params = {}) => new Promise((resolve, reject) => {
    const number = ++sequence;
    calls.set(number, { resolve, reject });
    cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: number, method, params }) }).catch(reject);
  });
  const tabTarget = (await cdp.send("Target.getTargets", { filter: [{ type: "tab" }, { exclude: true }] })).targetInfos.find(t => t.url === url);
  await page.bringToFront();
  await cdp.send("Extensions.triggerAction", { id, targetId: tabTarget.targetId });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    target = (await cdp.send("Target.getTargets")).targetInfos.find(t => t.url === `chrome-extension://${id}/popup.html`);
    if (!target) await delay(100);
  }
  if (!target) throw new Error("popup did not open");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false });
  const ui = async expression => {
    const result = await send(sessionId, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const until = async (expression, timeout = 10000) => {
    const start = Date.now();
    while (!await ui(expression)) { if (Date.now() - start > timeout) throw new Error(`timed out: ${expression}`); await delay(80); }
  };
  const click = selector => ui(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const select = (selector, value) => ui(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("change", {bubbles:true})); })()`);
  await until('!document.querySelector("#power-button").disabled');

  async function shot() {
    for (let i = 0; i < 20; i++) {
      const size = await ui("({height:innerHeight,body:document.body.scrollHeight})");
      if (size.body === size.height) break;
      await delay(60); // popup window still resizing to its content
    }
    const { data } = await send(sessionId, "Page.captureScreenshot", { format: "png" });
    return Buffer.from(data, "base64");
  }
  // 2x capture for store images. Clipped scaled captures sometimes repeat part of
  // the popup, so keep one only when it matches a plain 1x capture.
  async function sharpShot() {
    const plain = await shot();
    const { width, height } = await sharp(plain).metadata();
    const reference = await sharp(plain).raw().toBuffer();
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data } = await send(sessionId, "Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 2 } });
      const png = Buffer.from(data, "base64");
      const small = await sharp(png).resize(width, height).raw().toBuffer();
      let diff = 0;
      for (let i = 0; i < small.length; i++) diff += Math.abs(small[i] - reference[i]);
      if (diff / small.length < 6) return png;
      await delay(200);
    }
    throw new Error("could not get a clean 2x capture");
  }
  // A frame is the popup with rounded corners on a fixed-size backdrop, so GIF frames match in size.
  const popupWidth = Math.round(372 * POPUP_SCALE);
  const canvas = { width: popupWidth + PAD * 2, height: Math.round(500 * POPUP_SCALE) + PAD * 2 };
  const backdrop = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BACKDROP[0]}"/><stop offset="1" stop-color="${BACKDROP[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`)).png().toBuffer();
  async function popupImage(png, scale = POPUP_SCALE) {
    const resized = await sharp(png).resize({ width: Math.round(372 * scale) }).png().toBuffer();
    const { width, height } = await sharp(resized).metadata();
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${Math.round(12 * scale)}"/></svg>`);
    return sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  }
  async function frame(png) {
    return sharp(backdrop).composite([{ input: await popupImage(png), left: PAD, top: PAD }]).png().toBuffer();
  }

  // Each step captures one frame and holds it for `ms` milliseconds.
  let frames = [];
  const capture = async (ms = 120) => frames.push({ png: await shot(), ms });
  const record = async (count, ms = 120) => { for (let i = 0; i < count; i++) { await capture(ms); await delay(ms / 2); } };
  async function saveGif(name) {
    const images = await Promise.all(frames.map(item => frame(item.png)));
    await sharp(images, { join: { animated: true } }).gif({ delay: frames.map(item => item.ms), loop: 0, effort: 10, dither: 0 }).toFile(path.join(media, name));
    console.log(`${name}: ${frames.length} frames`);
    frames = [];
  }

  // 1. Turn it on: start screen, switch, live meter.
  await capture(1400);
  await click("#power-button");
  await capture(300);
  await until('document.querySelector("#power-button").getAttribute("aria-checked") === "true" && !document.querySelector("#power-button").disabled');
  await until('parseFloat(document.querySelector("#meter-fill").style.transform.replace("scaleX(", "")) > 0.2');
  await record(14);
  await capture(1000);
  await saveGif("turn-on.gif");

  // 2. Boost, keep steady, keep this level with undo.
  await capture(700);
  for (let volume = 115; volume <= 400; volume += 15) {
    await ui(`(() => { const e = document.querySelector("#volume"); e.value = ${volume}; e.dispatchEvent(new Event("input", {bubbles:true})); })()`);
    await capture(70);
  }
  await ui('document.querySelector("#volume").dispatchEvent(new Event("change", {bubbles:true}))');
  await record(6);
  await capture(900);
  const storeOn = await sharpShot();
  await click('[data-volume="100"]');
  await delay(300);
  await click("#leveling");
  await delay(300);
  await record(5);
  await capture(800);
  await delay(1500);
  await click("#learn");
  await until('!document.querySelector("#feedback").hidden');
  const storeLearn = await sharpShot();
  await record(6);
  await capture(1800);
  await click("#undo");
  await until('!document.querySelector("#feedback").hidden && document.querySelector("#undo").hidden');
  await capture(1400);
  await saveGif("level.gif");

  // 3. Advanced settings: modes, appearance and language.
  await until('document.querySelector("#feedback").hidden', 6000);
  await click("#advanced summary");
  await delay(400);
  await capture(1000);
  for (const mode of ["steady", "speech", "night", "music"]) {
    await click(`input[name="mode"][value="${mode}"]`);
    await until('!document.querySelector("#power-button").disabled');
    await delay(150);
    await capture(900);
  }
  const storeModes = await sharpShot();
  await click('input[name="mode"][value="normal"]');
  await until('!document.querySelector("#power-button").disabled');
  await ui('document.querySelector("#theme").scrollIntoView({block:"center"})');
  await capture(700);
  await select("#theme", "light");
  await until('document.documentElement.dataset.theme === "light"');
  await delay(150);
  await capture(1200);
  await select("#language", "tr");
  await until('document.documentElement.lang === "tr"');
  await delay(150);
  await capture(1400);
  await select("#language", "en");
  await select("#theme", "dark");
  await until('document.documentElement.dataset.theme === "dark" && document.documentElement.lang === "en"');
  await delay(150);
  await capture(1000);
  await saveGif("settings.gif");

  // Light-theme main screen for the store.
  await click("#advanced summary");
  await select("#theme", "light");
  await until('document.documentElement.dataset.theme === "light"');
  await ui('document.querySelector(".content").scrollTop = 0');
  await delay(600);
  const storeLight = await sharpShot();
  await select("#theme", "dark");
  await select("#language", "tr");
  await until('document.documentElement.dataset.theme === "dark" && document.documentElement.lang === "tr"');
  await ui('document.querySelector(".content").scrollTop = 0');
  await delay(600);
  const storeTurkish = await sharpShot();
  await select("#language", "en");

  // Chrome Web Store: five 1280x800 screenshots, 440x280 and 1400x560 promo images
  // (opaque, no alpha) and a store icon with the recommended 16 px transparent padding.
  for (const file of await fs.readdir(store)) if (file.endsWith(".png")) await fs.rm(path.join(store, file));
  const escape = text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const icon = await fs.readFile("extension/icons/128.png");
  async function storeImage(name, png, title, lines, light = false) {
    const [top, bottom] = light ? ["#eef6f4", "#d9ebe7"] : BACKDROP;
    const ink = light ? "#0c2723" : "#f1f2f3";
    const muted = light ? "#3f5c57" : "#a9c9c2";
    const text = lines.map((line, i) => `<text x="96" y="${432 + i * 44}" font-size="28" fill="${muted}">${escape(line)}</text>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="1280" height="800" fill="url(#g)"/><g font-family="Segoe UI, sans-serif"><text x="168" y="214" font-size="40" font-weight="700" fill="${ink}">Tonvela</text><text x="96" y="330" font-size="52" font-weight="700" fill="${ink}">${escape(title)}</text>${text}</g></svg>`;
    const popup = await popupImage(png, 1.4);
    const { height } = await sharp(popup).metadata();
    await sharp(Buffer.from(svg)).composite([
      { input: await sharp(icon).resize(56).png().toBuffer(), left: 96, top: 168 },
      { input: popup, left: 1280 - 96 - Math.round(372 * 1.4), top: Math.round((800 - height) / 2) }
    ]).removeAlpha().png().toFile(path.join(store, name));
  }
  await storeImage("screenshot-1-volume.png", storeOn, "Up to 400% volume", ["Boost quiet videos with a peak limiter", "that keeps the sound clean."]);
  await storeImage("screenshot-2-level.png", storeLearn, "Keep this level", ["Make what you hear right now the target.", "Undo brings your settings back."]);
  await storeImage("screenshot-3-modes.png", storeModes, "Six listening modes", ["Steady, Speech, Night, Music and", "an on-device Voice only filter."]);
  await storeImage("screenshot-4-light.png", storeLight, "Your audio stays local", ["No servers, accounts or recording.", "Dark, light or system theme."], true);
  await storeImage("screenshot-5-turkish.png", storeTurkish, "English or Turkish", ["Pick the interface language,", "independent of Chrome's language."]);
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BACKDROP[0]}"/><stop offset="1" stop-color="${BACKDROP[1]}"/></linearGradient></defs><rect width="440" height="280" fill="url(#g)"/><g font-family="Segoe UI, sans-serif" text-anchor="middle"><text x="220" y="178" font-size="40" font-weight="700" fill="#f1f2f3">Tonvela</text><text x="220" y="218" font-size="19" fill="#a9c9c2">Balanced sound for every video</text></g></svg>`;
  await sharp(Buffer.from(tile)).composite([{ input: await sharp(icon).resize(72).png().toBuffer(), left: 184, top: 52 }]).removeAlpha().png().toFile(path.join(store, "promo-tile-440x280.png"));
  const marquee = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="560"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BACKDROP[0]}"/><stop offset="1" stop-color="${BACKDROP[1]}"/></linearGradient></defs><rect width="1400" height="560" fill="url(#g)"/><g font-family="Segoe UI, sans-serif"><text x="208" y="246" font-size="64" font-weight="700" fill="#f1f2f3">Tonvela</text><text x="112" y="330" font-size="32" fill="#a9c9c2">Balanced sound for every video.</text><text x="112" y="380" font-size="26" fill="#7fa79e">Up to 400% volume · steady levels · runs on your device</text></g></svg>`;
  const marqueePopup = await popupImage(storeOn, 1);
  const { height: marqueeHeight } = await sharp(marqueePopup).metadata();
  await sharp(Buffer.from(marquee)).composite([
    { input: await sharp(icon).resize(80).png().toBuffer(), left: 112, top: 182 },
    { input: marqueePopup, left: 1400 - 112 - 372, top: Math.round((560 - marqueeHeight) / 2) }
  ]).removeAlpha().png().toFile(path.join(store, "marquee-1400x560.png"));
  await sharp(icon).resize(96).extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(store, "store-icon-128.png"));
  console.log("store images written");
  await click("#power-button");
  await delay(500);
} finally {
  await context.close();
  server.close();
  await fs.rm(profile, { recursive: true, force: true });
}
