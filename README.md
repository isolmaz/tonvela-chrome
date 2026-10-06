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
<td width="33%" align="center"><img src="docs/media/turn-on.gif" alt="Turning Tonvela on: the switch reveals the volume controls and a live meter"></td>
<td width="33%" align="center"><img src="docs/media/level.gif" alt="Boosting to 400%, turning on Keep volume steady, then Keep this level with undo"></td>
<td width="33%" align="center"><img src="docs/media/settings.gif" alt="Advanced settings: listening modes, light theme and Turkish interface"></td>
</tr>
<tr>
<td align="center"><b>1. Turn it on</b><br>Flip the switch on a video tab. The meter shows what you hear.</td>
<td align="center"><b>2. Boost and level</b><br>Up to 400%. <i>Keep volume steady</i> evens out loud and quiet parts; <i>Keep this level</i> locks in what you hear now.</td>
<td align="center"><b>3. Fine-tune</b><br>Six listening modes, target level, per-site memory, theme and language.</td>
</tr>
</table>

## Features

- **Up to 400% volume** with a look-ahead peak limiter.
- **Keep volume steady:** quiet parts come up, loud parts come down.
- **Keep this level:** the level you're hearing becomes the target, with undo.
- **Six modes:** Normal, Steady, Speech, Night, Music and experimental **Voice only** (on-device [GTCRN](https://github.com/Xiaobin-Rong/gtcrn) speech model, mono, ~50 ms delay).
- **Shortcuts:** <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> opens Tonvela, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> change volume.
- **English or Turkish**, dark / light / system theme.

## Install

1. Download and extract [`Tonvela-Chrome.zip`](https://github.com/isolmaz/tonvela-chrome/releases/latest/download/Tonvela-Chrome.zip).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder.
4. On a video tab, open Tonvela and flip the switch.

## Privacy

Audio is processed in your browser and never leaves it. No servers, accounts, analytics, recording or microphone. Preferences stay in `chrome.storage.local`. Details: [PRIVACY.md](PRIVACY.md).

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
