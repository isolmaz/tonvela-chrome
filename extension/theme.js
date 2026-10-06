const systemTheme = matchMedia("(prefers-color-scheme: dark)");
const normalizeTheme = value => ["dark", "light", "system"].includes(value) ? value : "dark";
let preference = "dark";

function applyTheme(value) {
  preference = normalizeTheme(value);
  document.documentElement.dataset.theme = preference === "system" ? (systemTheme.matches ? "dark" : "light") : preference;
  const picker = document.getElementById("theme");
  if (picker) picker.value = preference;
}

export async function saveTheme(value) {
  const normalized = normalizeTheme(value);
  await chrome.storage.local.set({ theme: normalized });
  applyTheme(normalized);
}

systemTheme.addEventListener("change", () => {
  if (preference === "system") applyTheme(preference);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.theme) applyTheme(changes.theme.newValue);
});
try {
  const { theme } = await chrome.storage.local.get("theme");
  applyTheme(theme);
} catch {
  applyTheme("dark");
}
