import test from "node:test";
import assert from "node:assert/strict";
import { rememberSite, applyCommand, createSerialQueue, createPendingWrites, normalizeSettings, normalizeListener, isOriginal, readableError, MAX_SITES, DEFAULT_LISTENER } from "../extension/shared.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const settings = (extra = {}) => normalizeSettings({ volume: 150, ...extra });
const stored = ({ volume, mode, targetDb }) => ({ volume, mode, targetDb });

test("site settings keep the most recently edited sites without extra fields", () => {
  let sites = {};
  for (let i = 0; i < MAX_SITES + 5; i++) sites = rememberSite(sites, `site${i}.example`, settings({ volume: i }));
  assert.equal(Object.keys(sites).length, MAX_SITES);
  assert.equal(sites["site0.example"], undefined);
  sites = rememberSite(sites, "site10.example", { ...settings({ volume: 300 }), remember: false, extra: 1 });
  assert.equal(Object.keys(sites).at(-1), "site10.example");
  assert.deepEqual(sites["site10.example"], stored(settings({ volume: 300 })));
  assert.deepEqual(rememberSite(sites, "", settings()), sites);
  assert.deepEqual(rememberSite(undefined, "a.example", settings()), { "a.example": stored(settings()) });
});

test("keyboard commands step volume within bounds and switch between Normal and Steady", () => {
  assert.equal(applyCommand(settings({ volume: 395 }), "volume-up").volume, 400);
  assert.equal(applyCommand(settings({ volume: 5 }), "volume-down").volume, 0);
  assert.equal(applyCommand(settings({ volume: 100 }), "volume-up").volume, 110);
  const steady = applyCommand(settings({ mode: "steady" }), "toggle-leveling");
  assert.equal(steady.mode, "normal");
  assert.equal(steady.leveling, false);
  const night = applyCommand(settings({ mode: "night" }), "toggle-leveling");
  assert.equal(night.mode, "normal", "any leveling mode goes back to Normal");
  const music = applyCommand(settings({ mode: "music", targetDb: -40 }), "toggle-leveling");
  assert.equal(music.mode, "steady");
  assert.equal(music.leveling, true);
  assert.equal(music.targetDb, -22, "Steady starts from its own target");
  assert.equal(applyCommand(settings(), "unknown"), null);
});

test("leveling follows the mode, and a stored leveling flag on Normal means Steady", () => {
  assert.equal(normalizeSettings({ mode: "normal", leveling: true }).mode, "steady");
  assert.equal(normalizeSettings({ mode: "music", leveling: true }).leveling, false);
  assert.equal(normalizeSettings({ mode: "speech", leveling: false }).leveling, true);
});

test("listener preferences reject invalid values", () => {
  assert.deepEqual(normalizeListener(null), DEFAULT_LISTENER);
  assert.deepEqual(normalizeListener({ mono: "yes", balance: 250, protection: "loud", outputDevice: 7 }), { mono: false, balance: 100, protection: "off", outputDevice: "" });
  assert.equal(normalizeListener({ balance: -42.4 }).balance, -42);
  assert.equal(normalizeListener({ protection: "strict" }).protection, "strict");
  assert.equal(normalizeListener({ outputDevice: "x".repeat(300) }).outputDevice, "");
});

test("the tab keeps its own audio only when nothing would change it", () => {
  assert.equal(isOriginal(settings({ volume: 100 }), DEFAULT_LISTENER), true);
  assert.equal(isOriginal(settings({ volume: 105 }), DEFAULT_LISTENER), false);
  assert.equal(isOriginal(settings({ volume: 100, mode: "speech" }), DEFAULT_LISTENER), false);
  for (const change of [{ mono: true }, { balance: -5 }, { protection: "light" }, { outputDevice: "abc" }]) {
    assert.equal(isOriginal(settings({ volume: 100 }), { ...DEFAULT_LISTENER, ...change }), false, JSON.stringify(change));
  }
});

test("serial queue runs operations in order and survives failures", async () => {
  const serialize = createSerialQueue();
  const order = [];
  const first = serialize(async () => { await delay(20); order.push(1); });
  const failing = serialize(async () => { order.push(2); throw new Error("boom"); });
  const third = serialize(async () => { order.push(3); return "done"; });
  await first;
  await assert.rejects(failing, /boom/);
  assert.equal(await third, "done");
  assert.deepEqual(order, [1, 2, 3]);
});

test("pending writes keep only the last value per key and flush in order", async () => {
  const written = [];
  const writes = createPendingWrites(job => { written.push(job); }, 30);
  writes.schedule("a", { value: 1 });
  writes.schedule("b", { value: 2 });
  writes.schedule("a", { value: 3 });
  assert.equal(writes.size, 2);
  assert.equal(written.length, 0);
  await delay(60);
  assert.deepEqual(written, [{ value: 2 }, { value: 3 }]);
  writes.schedule("a", { value: 4 });
  await writes.flush();
  assert.deepEqual(written.at(-1), { value: 4 });
  assert.equal(writes.size, 0);
  await delay(60);
  assert.equal(written.length, 3, "flush cancels the timer");
});

test("pending writes let the caller choose where the delayed flush runs", async () => {
  const ran = [];
  const writes = createPendingWrites(job => ran.push(job), 10, flush => { ran.push("queued"); return flush(); });
  writes.schedule("", { value: 1 });
  await delay(40);
  assert.deepEqual(ran, ["queued", { value: 1 }]);
});

test("errors map to readable text; unknown keys and messages pass through", () => {
  assert.equal(readableError(new Error("errNoTab")), "errNoTab", "Node has no chrome.i18n, so keys come back unchanged");
  assert.equal(readableError(new Error("Tab is already being captured")), "errAlreadyCaptured");
  assert.equal(readableError(new Error("Cannot capture a tab with an active stream.")), "errAlreadyCaptured", "Chrome's wording for a tab that is already captured");
  assert.equal(readableError(new Error("Cannot capture this page")), "errCannotCapture");
  assert.equal(readableError(new Error("NotAllowedError: denied")), "errPermission");
  assert.equal(readableError(new Error("No tab with id: 12.")), "errNoTab");
  assert.equal(readableError(new Error("Could not establish connection. Receiving end does not exist.")), "errEngineConnection");
  assert.equal(readableError(null), "errUnknown");
  assert.equal(readableError(new Error("x".repeat(400))).length, 260);
});
