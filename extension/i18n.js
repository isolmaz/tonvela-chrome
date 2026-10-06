// The UI language is the user's choice (default English), not Chrome's, so
// messages are loaded from _locales directly. Until loadLocale() finishes, and
// in offscreen documents and Node tests, t() returns the key itself.
export const LANGUAGES = Object.freeze({ en: "English", tr: "Türkçe" });
export const DEFAULT_LANGUAGE = "en";
const KEY = /^[A-Za-z0-9_]+$/;
let messages = {};
let current = null;

export const normalizeLanguage = value => Object.hasOwn(LANGUAGES, value) ? value : DEFAULT_LANGUAGE;
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
    catch { language = DEFAULT_LANGUAGE; }
  }
  language = normalizeLanguage(language);
  if (language === current) return language;
  const response = await fetch(new URL(`_locales/${language}/messages.json`, import.meta.url));
  messages = await response.json();
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
  document.documentElement.lang = currentLanguage();
  for (const element of root.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  for (const element of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of element.dataset.i18nAttr.split(/\s+/)) {
      const [name, key] = pair.split(":");
      element.setAttribute(name, t(key));
    }
  }
}
