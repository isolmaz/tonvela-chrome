<div align="center">

<img src="extension/icons/128.png" width="72" alt="Tonvela icon">

# Tonvela

**Balanced sound for every video.**
A Chrome extension that boosts, levels and clarifies tab audio — entirely on your device.

[Download](https://github.com/isolmaz/tonvela-chrome/releases/latest/download/Tonvela-Chrome.zip) · [Changelog](CHANGELOG.md) · [Privacy](PRIVACY.md) · [License](LICENSE)

**English** · [Türkçe](README.tr.md)

![Manifest V3](https://img.shields.io/badge/Manifest-V3-087f78) ![Chrome 116+](https://img.shields.io/badge/Chrome-116%2B-087f78) ![Local only](https://img.shields.io/badge/audio-stays%20on%20device-087f78)

</div>

## How it works

<table>
<tr>
<td width="33%" align="center"><img src="docs/media/volume.gif" alt="Raising the volume with the bar, picking 400%, then Back to original sound"></td>
<td width="33%" align="center"><img src="docs/media/modes.gif" alt="Opening Listening mode and choosing Steady, Speech, Night and Music"></td>
<td width="33%" align="center"><img src="docs/media/settings.gif" alt="Settings: mono sound, hearing protection, dark theme and Turkish interface"></td>
</tr>
<tr>
<td align="center"><b>1. Turn it up</b><br>Drag the bar or pick 100%, 200% or 400%. Tonvela starts when the sound changes; <i>Back to original sound</i> undoes it.</td>
<td align="center"><b>2. Choose how it sounds</b><br>Steady evens out loud and quiet parts, Speech brings voices forward, Night keeps peaks soft.</td>
<td align="center"><b>3. Make it yours</b><br>Output device, mono, balance, hearing protection, per-site memory, theme and language.</td>
</tr>
</table>

## Features

- **Up to 400% volume** with a look-ahead peak limiter.
- **Listening modes:** Normal, Steady, Speech, Night, Music and experimental **Voice only** (on-device [GTCRN](https://github.com/Xiaobin-Rong/gtcrn) speech model, mono, ~50 ms delay).
- **Keep this level:** the level you're hearing becomes the target, with undo.
- **Output device:** play processed tabs on a chosen speaker or headset.
- **Mono sound** and **left / right balance**, useful with one earbud or uneven hearing.
- **Hearing protection:** peaks stay under Light (−3 dB), Medium (−6 dB) or Strict (−12 dB) at any volume.
- **Remember settings for each site** (domain names only).
- **Shortcuts:** <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> opens Tonvela, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> change volume.
- **English, Türkçe, Español, Português (Brasil) and العربية** (right to left); system / light / dark theme.

## Install

1. Download and extract [`Tonvela-Chrome.zip`](https://github.com/isolmaz/tonvela-chrome/releases/latest/download/Tonvela-Chrome.zip).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder.
4. On a video tab, open Tonvela and drag the volume bar or pick a level.

## Privacy

Audio is processed in your browser and never leaves it. No servers, accounts, analytics or recording. The microphone is only asked for if you want to see output device names, and it is closed right away. Preferences stay in `chrome.storage.local`. Details: [PRIVACY.md](PRIVACY.md).

## Development

Requires Node.js 22+ and Python 3. The extension has no build step: load `extension/` with **Load unpacked**.

```sh
npm ci                 # dependencies and the pre-push hook
npm run check          # lint + unit tests
npm run verify         # everything, including browser and speech model tests
npm run package        # build dist/Tonvela-Chrome-v<version>.zip
```

Browser tests play audible audio and need `npx playwright install chromium` plus a speech fixture from `tools/create-speech-fixture.ps1` (Windows). Before each push, the hook runs lint and unit tests, and the browser tests when `extension/` changed and they are set up.

**Contributing:** open a pull request against `main` and describe user-facing changes under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md). Don't change version numbers; they are set when a release is published.

```
extension/   the extension itself (what ships)
tests/       unit tests
tools/       pre-push checks, browser and speech model tests, packager, README media
docs/media/  README GIFs
```

## License

[MIT](LICENSE). Bundled third-party components (GTCRN, gtcrn-wasm, pffft) keep their own licenses; see [THIRD_PARTY_NOTICES.txt](extension/THIRD_PARTY_NOTICES.txt).
