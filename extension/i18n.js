// The UI language is the user's choice, independent of Chrome's; until one is
// chosen it follows Chrome's language when Tonvela has it, otherwise English.
// Messages are loaded from _locales directly. Until loadLocale() finishes, and
// in offscreen documents and Node tests, t() returns the key itself.
export const LANGUAGES = Object.freeze({ en: "English", tr: "Türkçe", es: "Español", pt_BR: "Português (Brasil)", ar: "العربية" });
export const DEFAULT_LANGUAGE = "en";
const RIGHT_TO_LEFT = new Set(["ar"]);
const KEY = /^[A-Za-z0-9_]+$/;
let messages = {};
let current = null;
let requested = null;

// Maps a browser language tag such as "es-419" or "pt-PT" to a supported language.
export function matchLanguage(tag) {
  const lower = String(tag || "").toLowerCase();
  if (lower.startsWith("pt")) return "pt_BR";
  const base = lower.split(/[-_]/)[0];
  return Object.hasOwn(LANGUAGES, base) ? base : DEFAULT_LANGUAGE;
}
export const normalizeLanguage = value => Object.hasOwn(LANGUAGES, value) ? value : matchLanguage(globalThis.chrome?.i18n?.getUILanguage?.());
export const currentLanguage = () => current || DEFAULT_LANGUAGE;

export function format(entry, substitutions = []) {
  if (!entry?.message) return "";
  return entry.message
    .replace(/\$(\w+)\$/g, (match, name) => entry.placeholders?.[name.toLowerCase()]?.content ?? match)
    .replace(/\$(\d)/g, (match, index) => String(substitutions[index - 1] ?? ""));
}

export function t(key, ...substitutions) {
  if (!KEY.test(key)) return key;
  return format(messages[key], substitutions) || key;
}

export const isMessageKey = value => KEY.test(value) && Object.hasOwn(messages, value);

export async function loadLocale(language) {
  if (language === undefined && current) return current;
  if (language === undefined) {
    try { language = (await chrome.storage.local.get("language")).language; }
    catch { language = undefined; }
  }
  language = normalizeLanguage(language);
  // The last requested language wins, even if an earlier fetch finishes later.
  requested = language;
  if (language === current) return language;
  const response = await fetch(new URL(`_locales/${language}/messages.json`, import.meta.url));
  if (!response.ok) throw new Error(`Missing messages for ${language}`);
  const next = await response.json();
  if (requested !== language) return currentLanguage();
  messages = next;
  current = language;
  return language;
}

export async function saveLanguage(language) {
  language = normalizeLanguage(language);
  await chrome.storage.local.set({ language });
  return loadLocale(language);
}

globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.language) loadLocale(changes.language.newValue).catch(() => {});
});

// data-i18n sets text content; data-i18n-attr holds space-separated attribute:messageKey pairs.
export function localizePage(root = document) {
  document.documentElement.lang = currentLanguage().replace("_", "-");
  document.documentElement.dir = RIGHT_TO_LEFT.has(currentLanguage()) ? "rtl" : "ltr";
  for (const element of root.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  for (const element of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of element.dataset.i18nAttr.split(/\s+/)) {
      const [name, key] = pair.split(":");
      element.setAttribute(name, t(key));
    }
  }
}
