import { t, loadLocale, localizePage } from "./i18n.js";

// Chrome shows output device names only to pages with a granted microphone permission.
// The stream is stopped at once; no audio is read.
await loadLocale().catch(() => {});
localizePage();
document.title = t("devicesTitle");
const result = document.getElementById("result");
document.getElementById("allow").addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    result.textContent = t("devicesDone");
  } catch {
    result.textContent = t("devicesDenied");
  }
});
