# Changelog

## Unreleased

- New, simpler popup: a large volume number, a volume bar, 100% / 200% / 400% buttons, a Listening mode list and **Back to original sound**. Settings move to their own screen.
- No on/off switch: changing the sound starts Tonvela on the tab, and Back to original sound releases it.
- **Output device:** play the tabs Tonvela processes on a chosen speaker or headset. Device names appear after allowing microphone access once on a separate page; the microphone is closed right away.
- **Mono sound** and **left / right balance**.
- **Hearing protection:** a peak ceiling of Off, Light (−3 dB), Medium (−6 dB) or Strict (−12 dB) at any volume.
- **Remember settings for each site** replaces per-site saving; turning it off deletes saved sites. Remembered sites store only volume, mode and target.
- Spanish, Brazilian Portuguese and Arabic (right to left), with help pages. Until a language is chosen, Tonvela follows Chrome's language. The theme follows the system by default.
- Store names: "Tonvela - Volume Booster" and localized names per language.
- Fixes: the Voice only worker could fall behind and add delay; the badge, saved state and active state could disagree after a failed start; the badge used the wrong language; a quick language change could show the earlier language; errors were stored in the language of the moment; raw Chrome errors could reach the popup.
- INSTALL.txt points to the GitHub repository for source and releases.

## 1.3.2 — October 6, 2026

- Quick volume buttons follow the interface language (`100%` in English, `%100` in Turkish).
- Local files show "Local file" / "Yerel dosya" instead of an internal key.
- A failed language change no longer leaves the language picker out of sync.
- Added a privacy policy (`PRIVACY.md`).
- README with GIFs of the main flows, also in Turkish (`README.tr.md`).

## 1.3.1 — September 27, 2026

- Removed the website and every link to it until the Chrome Web Store listing exists; the popup has no external links.
- Added the MIT license.

## 1.3.0 — September 27, 2026

- Denge is now **Tonvela**.
- English is the default language everywhere; Turkish is available under Advanced settings → Language. The choice applies to the popup, help page and badge text, independent of Chrome's language.
- English website at the root, Turkish under `/tr/`, with a language switch.
- Smoother popup: meter snapshots redraw only what changed, and the meter animates with a GPU transform instead of width.
- GitHub Actions workflows removed; checks run locally with `npm run check`, releases are uploaded manually.
- Docs, changelog and test report (`docs/TEST_RESULTS.txt`) in English; Turkish-only documents removed.

## 1.2.0 — September 27, 2026

- The voice-only model (GTCRN) runs in a Worker instead of the audio thread; a 3-frame buffer adds ~50 ms delay. Late frames play unprocessed and the popup shows a warning.
- All tabs share one AudioContext.
- The popup gets meter snapshots over a runtime port instead of polling every 300 ms.
- Preference writes are coalesced during slider drags (400 ms).
- Undo after "Keep this level".
- English interface (`_locales`), English help and INSTALL.txt.
- Test notes are no longer inside the package; the ZIP left the repository and ships via GitHub Releases.
- ESLint, GitHub Actions CI and tag-driven releases; `package.py --skip-browser-tests`.
- Unit tests for background logic, the voice frame queue and locale files.

## 1.1.0 — September 4, 2026

- On/off switch at the top and a simple start screen while off.
- Volume, leveling and keep-this-level controls on the main screen.
- Collapsible advanced section for modes, target level, site preferences, shortcuts and reset.
- Dark by default, with light and system themes; the help page follows the same choice.
- Scrolling advanced settings; the switch and footer links stay visible.
- Last audio preferences are kept after closing and reopening; the advanced section starts closed.
- Website link and updated install/help text.
- Static dark website with download, changelog, about and privacy pages.

## 1.0.0 — September 4, 2026

- Volume boost up to 400% with peak limiting.
- Automatic leveling and targeting the level you hear.
- Normal, Steady, Speech, Night, Music and experimental Voice only modes.
- Fully local GTCRN speech model, per-tab processing and site preferences.
