/* global chrome -- used inside extension callbacks */
// Records the README GIFs (docs/media) and Chrome Web Store images (dist/store, or
// the folder in TONVELA_STORE_DIR) from the real extension popup in Chromium.
// Screenshots are made for every interface language; the promo tiles carry no
// words because the store can't localize them. Needs .cache/test-speech.wav
// (tools/create-speech-fixture.ps1) and plays it audibly while recording.
import { createRequire } from "node:module";
import path from "node:path";
import http from "node:http";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sharp = require("sharp");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const HOST = "www.video.example";
const PAD = 36;
const STAGE = { light: "#e8e8ed", dark: "#0b0b0d" };
const ACCENT = "#087f6b";
const media = path.resolve("docs/media");
const store = path.resolve(process.env.TONVELA_STORE_DIR || "dist/store");

// Store captions: what each screenshot shows, in plain words and with no claims
// beyond what the extension does.
const CAPTIONS = {
  en: [
    ["Up to 4× volume", "Boost quiet videos. A look-ahead limiter keeps peaks clean."],
    ["Steady, clear sound", "Quiet parts come up, loud parts come down. Speech, Night and Music modes."],
    ["Mono, balance and hearing protection", "Pick an output device, mix to mono and set a peak limit."],
    ["Stays on your device", "No servers, accounts or recordings. Back to the original sound in one tap."]
  ],
  tr: [
    ["4 kata kadar ses", "Kısık videoların sesini yükseltin. Sınırlayıcı ani tepeleri temiz tutar."],
    ["Dengeli, net ses", "Kısık yerler yükselir, yüksek yerler iner. Konuşma, Gece ve Müzik modları."],
    ["Mono, denge ve kulak koruma", "Çıkış cihazı seçin, sesi monoya alın, tepe sınırı belirleyin."],
    ["Sesiniz cihazınızda kalır", "Sunucu, hesap veya kayıt yok. Tek dokunuşla orijinal sese dönün."]
  ],
  es: [
    ["Volumen hasta 4×", "Sube el volumen de los videos bajos. Un limitador mantiene limpios los picos."],
    ["Sonido estable y claro", "Las partes bajas suben y las fuertes bajan. Modos Diálogo, Noche y Música."],
    ["Mono, balance y protección auditiva", "Elige un dispositivo de salida, pasa a mono y fija un límite de picos."],
    ["Todo en tu dispositivo", "Sin servidores, cuentas ni grabaciones. Vuelve al sonido original con un toque."]
  ],
  pt_BR: [
    ["Volume até 4×", "Aumente o volume de vídeos baixos. Um limitador mantém os picos limpos."],
    ["Som estável e claro", "As partes baixas sobem e as altas descem. Modos Fala, Noite e Música."],
    ["Mono, balanço e proteção auditiva", "Escolha um dispositivo de saída, use mono e defina um limite de picos."],
    ["Tudo no seu dispositivo", "Sem servidores, contas ou gravações. Volte ao som original com um toque."]
  ],
  ar: [
    ["صوت أعلى حتى 4 أضعاف", "ارفع صوت الفيديوهات الهادئة. يحافظ المحدِّد على نقاء الذروات."],
    ["صوت ثابت وواضح", "ترتفع الأجزاء الهادئة وتنخفض العالية. أوضاع الكلام والليلي والموسيقى."],
    ["صوت أحادي وتوازن وحماية للسمع", "اختر جهاز الإخراج، وحوّل الصوت إلى أحادي، وحدّد سقفًا للذروة."],
    ["يبقى كل شيء على جهازك", "بلا خوادم أو حسابات أو تسجيل. عُد إلى الصوت الأصلي بلمسة واحدة."]
  ]
};
const RIGHT_TO_LEFT = new Set(["ar"]);

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
const context = await chromium.launchPersistentContext(profile, { headless: true, executablePath: chromium.executablePath(), ignoreDefaultArgs: ["--disable-extensions", "--mute-audio"], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging", `--host-resolver-rules=MAP ${HOST} 127.0.0.1`, "--lang=en-US"], viewport: { width: 1000, height: 800 } });

const calls = new Map();
let sequence = 0;
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => Promise.all([chrome.storage.local.clear(), chrome.storage.session.clear()]).then(() => chrome.storage.local.set({ theme: "light", language: "en" })));
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
  let { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false });
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
  const key = name => ui(`document.querySelector("#volume").dispatchEvent(new KeyboardEvent("keydown", {key: ${JSON.stringify(name)}, bubbles: true}))`);
  const apply = settings => ui(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab]) => chrome.runtime.sendMessage({target:"background",type:"apply",tabId:tab.id,settings:${JSON.stringify(settings)},final:true}))`);
  const back = () => ui('document.querySelector(".view:not([hidden]) [data-back]")?.click()');
  const setLanguage = async language => {
    await select("#language", language);
    await until(`document.documentElement.lang === ${JSON.stringify(language.replace("_", "-"))}`);
  };
  const setTheme = async theme => {
    await select("#theme", theme);
    await until(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`);
  };
  await until('document.querySelector("#status-text").textContent !== ""');

  // Captures only the content, once the popup window has settled at its height.
  async function capture(scale) {
    await ui("document.fonts.ready.then(() => true)");
    const height = await ui("document.body.scrollHeight");
    for (let i = 0; i < 50 && await ui("innerHeight") !== height; i++) await delay(60);
    const { data } = await send(sessionId, "Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 372, height, scale } });
    return Buffer.from(data, "base64");
  }
  const shot = () => capture(1);
  // A 2x capture of the popup window repeats part of its content once a screen
  // is taller than the window, so store screenshots render popup.html in a tab
  // at 2x, answering the popup's active-tab query with the video tab.
  async function openPopupTab() {
    const videoTab = await ui("chrome.tabs.query({active:true,currentWindow:true}).then(([tab]) => tab.id)");
    await ui("window.close()").catch(() => {});
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: false }));
    await send(sessionId, "Page.enable");
    await send(sessionId, "Page.addScriptToEvaluateOnNewDocument", { source: `{ const query = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = info => info.active ? chrome.tabs.get(${videoTab}).then(tab => [tab]) : query(info); }` });
    await send(sessionId, "Emulation.setDeviceMetricsOverride", { width: 372, height: 200, deviceScaleFactor: 2, mobile: false });
    await send(sessionId, "Page.navigate", { url: `chrome-extension://${id}/popup.html` });
    await until('document.querySelector("#status-text")?.textContent > ""');
  }
  async function sharpShot() {
    await delay(700);
    await ui("document.fonts.ready.then(() => true)");
    const height = await ui("document.body.scrollHeight");
    await send(sessionId, "Emulation.setDeviceMetricsOverride", { width: 372, height, deviceScaleFactor: 2, mobile: false });
    await delay(300);
    const { data } = await send(sessionId, "Page.captureScreenshot", { format: "png" });
    await send(sessionId, "Emulation.setDeviceMetricsOverride", { width: 372, height: 200, deviceScaleFactor: 2, mobile: false });
    return Buffer.from(data, "base64");
  }
  const roundedPopup = async (png, scale) => {
    const resized = await sharp(png).resize({ width: Math.round(372 * scale) }).png().toBuffer();
    const { width, height } = await sharp(resized).metadata();
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${Math.round(14 * scale)}"/></svg>`);
    return { image: await sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer(), width, height };
  };
  const shadow = (width, height, radius) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width + 120}" height="${height + 120}"><defs><filter id="s"><feGaussianBlur stdDeviation="18"/></filter></defs><rect x="60" y="72" width="${width}" height="${height}" rx="${radius}" fill="#000" fill-opacity=".22" filter="url(#s)"/></svg>`)).png().toBuffer();

  // README GIFs: the popup on a fixed-size stage, so all frames match.
  const canvas = { width: 372 + PAD * 2, height: 600 + PAD * 2 };
  const stage = await sharp({ create: { width: canvas.width, height: canvas.height, channels: 3, background: STAGE.light } }).png().toBuffer();
  let frames = [];
  const frame = async (ms = 120) => frames.push({ png: await shot(), ms });
  const record = async (count, ms = 120) => { for (let i = 0; i < count; i++) { await frame(ms); await delay(ms / 2); } };
  async function saveGif(name) {
    const images = await Promise.all(frames.map(async item => {
      const { image } = await roundedPopup(item.png, 1);
      return sharp(stage).composite([{ input: image, left: PAD, top: PAD }]).png().toBuffer();
    }));
    await sharp(images, { join: { animated: true } }).gif({ delay: frames.map(item => item.ms), loop: 0, effort: 10, dither: 0 }).toFile(path.join(media, name));
    console.log(`${name}: ${frames.length} frames`);
    frames = [];
  }
  await setTheme("light");

  // 1. Volume: from the original sound to 250%, then back.
  await frame(1400);
  await ui('document.querySelector("#volume").focus()');
  for (let i = 0; i < 30; i++) { await key("ArrowUp"); await frame(60); }
  await until('document.querySelector("#status-text").classList.contains("active")');
  await record(10);
  await click('#presets [data-volume="400"]');
  await record(8);
  await frame(1200);
  await click("#original");
  await until('document.querySelector("#original").classList.contains("concealed")');
  await delay(200); // the volume bar's width transition
  await frame(1400);
  await saveGif("volume.gif");

  // 2. Listening modes.
  await click('#presets [data-volume="200"]');
  await until('document.querySelector("#status-text").classList.contains("active")');
  await frame(900);
  await click("#open-modes");
  await frame(900);
  for (const mode of ["steady", "speech", "night", "music"]) {
    await click(`input[name="mode"][value="${mode}"]`);
    await delay(250);
    await frame(1000);
  }
  await click('input[name="mode"][value="steady"]');
  await back();
  await record(6);
  await frame(1200);
  await saveGif("modes.gif");

  // 3. Settings: listening preferences, appearance and language.
  await click("#open-settings");
  await frame(1000);
  await click("#mono");
  await frame(800);
  await click('input[name="protection"][value="medium"]');
  await frame(900);
  await click("#mono");
  await click('input[name="protection"][value="off"]');
  await setTheme("dark");
  await frame(1000);
  await setLanguage("tr");
  await frame(1200);
  await setLanguage("en");
  await setTheme("light");
  await frame(800);
  await back();
  await frame(1000);
  await saveGif("settings.gif");

  // Chrome Web Store: four 1280x800 screenshots per language (opaque PNGs),
  // language-neutral 440x280 and 1400x560 promo tiles, and the store icon.
  await fs.rm(store, { recursive: true, force: true });
  await fs.mkdir(store, { recursive: true });
  await openPopupTab();
  const icon = await fs.readFile("extension/icons/128.png");
  const escape = text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const wrap = (text, limit) => text.split(" ").reduce((lines, word) => {
    const last = lines.at(-1);
    if (last && (last + " " + word).length <= limit) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
    return lines;
  }, []);
  async function storeImage(file, png, [title, subtitle], { language, dark = false }) {
    const rtl = RIGHT_TO_LEFT.has(language);
    const ink = dark ? "#f5f5f7" : "#1d1d1f";
    const muted = dark ? "#a1a1a6" : "#6e6e73";
    // Tall screens shrink so the popup and its shadow stay inside the 800 px frame.
    const { height: captured } = await sharp(png).metadata();
    const { image, width, height } = await roundedPopup(png, Math.min(1.4, 660 / (captured / 2)));
    const popupLeft = rtl ? 96 : 1280 - 96 - width;
    const popupTop = Math.round((800 - height) / 2);
    const textX = rtl ? 1280 - 96 : 96;
    // Arabic letters run wider at the same size, so its lines break earlier.
    const titleLines = wrap(title, rtl ? 15 : 20);
    const subtitleLines = wrap(subtitle, rtl ? 30 : 34);
    const titleTop = 330 - (titleLines.length - 1) * 30;
    const text = [
      ...titleLines.map((line, i) => `<text x="${textX}" y="${titleTop + i * 62}" font-size="52" font-weight="600" fill="${ink}">${escape(line)}</text>`),
      ...subtitleLines.map((line, i) => `<text x="${textX}" y="${titleTop + titleLines.length * 62 + 26 + i * 40}" font-size="27" fill="${muted}">${escape(line)}</text>`)
    ].join("");
    const brandX = rtl ? 1280 - 96 - 56 : 96;
    const brandTop = titleTop - 158;
    const brandText = `<text x="${rtl ? brandX - 16 : brandX + 72}" y="${brandTop + 38}" font-size="34" font-weight="600" fill="${ink}" text-anchor="${rtl ? "end" : "start"}">Tonvela</text>`;
    // In a right-to-left group, "start" anchors each line at its right edge.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="${dark ? STAGE.dark : STAGE.light}"/><g font-family="Segoe UI, sans-serif">${brandText}<g direction="${rtl ? "rtl" : "ltr"}" text-anchor="start">${text}</g></g></svg>`;
    await sharp(Buffer.from(svg)).composite([
      { input: await sharp(icon).resize(56).png().toBuffer(), left: brandX, top: brandTop },
      { input: await shadow(width, height, 20), left: popupLeft - 60, top: popupTop - 60 },
      { input: image, left: popupLeft, top: popupTop }
    ]).removeAlpha().png().toFile(path.join(store, language, file));
  }

  for (const language of Object.keys(CAPTIONS)) {
    await fs.mkdir(path.join(store, language), { recursive: true });
    await setLanguage(language);
    await setTheme("light");
    const captions = CAPTIONS[language];
    await apply({ volume: 300, mode: "normal" });
    await until('document.querySelector("#volume").getAttribute("aria-valuenow") === "300"');
    await storeImage("screenshot-1-volume.png", await sharpShot(), captions[0], { language });
    await apply({ volume: 150, mode: "steady" });
    await until('document.querySelector("#volume").getAttribute("aria-valuenow") === "150"');
    await click("#open-modes");
    await storeImage("screenshot-2-modes.png", await sharpShot(), captions[1], { language });
    await back();
    await click("#open-settings");
    await click("#mono");
    await click('input[name="protection"][value="medium"]');
    await storeImage("screenshot-3-settings.png", await sharpShot(), captions[2], { language });
    await click("#mono");
    await click('input[name="protection"][value="off"]');
    await back();
    await setTheme("dark");
    await apply({ volume: 200, mode: "speech" });
    await until('document.querySelector("#volume").getAttribute("aria-valuenow") === "200"');
    await storeImage("screenshot-4-local.png", await sharpShot(), captions[3], { language, dark: true });
    console.log(`store screenshots: ${language}`);
  }
  await setLanguage("en");
  await setTheme("light");

  // Promo tiles show the brand and a volume bar, without words to translate.
  const bar = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h * 0.3}" fill="#ffffff"/><rect x="${x}" y="${y}" width="${Math.round(w * fill)}" height="${h}" rx="${h * 0.3}" fill="${ACCENT}"/>`;
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280"><rect width="440" height="280" fill="${STAGE.light}"/><g font-family="Segoe UI, sans-serif"><text x="148" y="112" font-size="40" font-weight="600" fill="#1d1d1f">Tonvela</text></g>${bar(68, 160, 304, 44, 0.62)}</svg>`;
  await sharp(Buffer.from(tile)).composite([{ input: await sharp(icon).resize(64).png().toBuffer(), left: 68, top: 66 }]).removeAlpha().png().toFile(path.join(store, "promo-tile-440x280.png"));
  const marquee = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="560"><rect width="1400" height="560" fill="${STAGE.light}"/><g font-family="Segoe UI, sans-serif"><text x="236" y="236" font-size="72" font-weight="600" fill="#1d1d1f">Tonvela</text><text x="1288" y="300" font-size="150" font-weight="600" fill="#1d1d1f" text-anchor="end">400<tspan font-size="70" fill="#6e6e73">%</tspan></text></g>${bar(112, 330, 1176, 96, 1)}</svg>`;
  await sharp(Buffer.from(marquee)).composite([{ input: await sharp(icon).resize(100).png().toBuffer(), left: 112, top: 162 }]).removeAlpha().png().toFile(path.join(store, "marquee-1400x560.png"));
  await sharp(icon).resize(96).extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(store, "store-icon-128.png"));
  await click("#original");
  console.log("store images written");
} finally {
  await context.close();
  server.close();
  await fs.rm(profile, { recursive: true, force: true });
}
