import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MODES } from "../extension/shared.js";

const root = path.resolve("extension");
const locales = fs.readdirSync(path.join(root, "_locales"));
const messages = Object.fromEntries(locales.map(locale => [locale, JSON.parse(fs.readFileSync(path.join(root, "_locales", locale, "messages.json"), "utf8"))]));
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? (entry.name === "vendor" ? [] : files(path.join(dir, entry.name))) : [path.join(dir, entry.name)]);
const sources = files(root).filter(file => /\.(js|html|json)$/.test(file) && !file.includes("_locales"));

function usedKeys() {
  const keys = new Set();
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    for (const [, key] of text.matchAll(/data-i18n="(\w+)"/g)) keys.add(key);
    for (const [, pairs] of text.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of pairs.split(/\s+/)) keys.add(pair.split(":")[1]);
    for (const [, key] of text.matchAll(/__MSG_(\w+)__/g)) keys.add(key);
    for (const [, args] of text.matchAll(/\b(?:t|Error|fail)\(([^;]*?)\)/g)) {
      for (const [, key] of args.matchAll(/"([a-z]+[A-Z]\w*)"/g)) keys.add(key);
    }
  }
  for (const mode of Object.values(MODES)) keys.add(mode.name).add(mode.description);
  return keys;
}

test("every locale defines the same messages", () => {
  const [first, ...rest] = locales;
  for (const locale of rest) assert.deepEqual(Object.keys(messages[locale]).sort(), Object.keys(messages[first]).sort(), locale);
});

test("every message key used by the extension exists", () => {
  const keys = usedKeys();
  assert.ok(keys.size > 80, `found ${keys.size} keys`);
  for (const locale of locales) {
    const missing = [...keys].filter(key => !messages[locale][key]);
    assert.deepEqual(missing, [], `${locale} is missing keys`);
  }
});

test("placeholders are declared and the help page exists for each locale", () => {
  for (const locale of locales) {
    for (const [key, entry] of Object.entries(messages[locale])) {
      for (const [, name] of entry.message.matchAll(/\$(\w+)\$/g)) assert.ok(entry.placeholders?.[name.toLowerCase()], `${locale}.${key} placeholder ${name}`);
    }
    assert.ok(fs.existsSync(path.join(root, messages[locale].helpPage.message)), `${locale} help page`);
  }
});

test("messages substitute named placeholders", async () => {
  const { format } = await import("../extension/i18n.js");
  const entry = messages.en.titleActive;
  assert.equal(format(entry, [150]), "Tonvela · 150%");
  assert.equal(format(messages.tr.volumePercent, [80]), "%80");
  assert.equal(format(undefined), "");
});

test("browser languages map to a supported interface language", async () => {
  const { matchLanguage, LANGUAGES } = await import("../extension/i18n.js");
  assert.deepEqual(Object.keys(LANGUAGES).sort(), [...locales].sort(), "every interface language has a locale folder");
  assert.equal(matchLanguage("es-419"), "es");
  assert.equal(matchLanguage("pt-PT"), "pt_BR");
  assert.equal(matchLanguage("pt_BR"), "pt_BR");
  assert.equal(matchLanguage("ar-EG"), "ar");
  assert.equal(matchLanguage("tr"), "tr");
  assert.equal(matchLanguage("de-DE"), "en");
  assert.equal(matchLanguage(undefined), "en");
});

test("short descriptions fit the store limit and names use a plain hyphen", () => {
  for (const locale of locales) {
    assert.ok(messages[locale].extDescription.message.length <= 132, locale);
    assert.match(messages[locale].extName.message, /^Tonvela - \S/, locale);
    assert.ok(!/—/.test(messages[locale].extName.message + messages[locale].extDescription.message), `${locale} has no em dash`);
  }
});
