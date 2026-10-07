# Changelog

## 1.3.3 — October 7, 2026

- The volume badge and tooltip stay on a tab after it navigates or reloads; Chrome cleared them while the audio kept being processed.
- Tonvela can be turned off on a tab that navigated to a page it can't capture (such as a new-tab or settings page); the switch used to stay greyed out.
- A tab whose audio another extension already captures shows "Another extension is using this tab's audio" instead of the generic can't-capture message.
- Closing a processed tab no longer leaves a stale error entry in session storage.
- INSTALL.txt points to the GitHub repository for source and releases.
- Every push to `main` runs CI; when the version is new, GitHub Actions uploads the ZIP to the Chrome Web Store, submits it for review and creates the GitHub release (`.github/workflows/release.yml`).

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
