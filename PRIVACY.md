# Privacy Policy

_Last updated: October 6, 2026_

Tonvela is a Chrome extension that processes the audio of a browser tab on your device. This policy describes what it does with data.

## What Tonvela does not do

- It does not send audio, measurements, settings or any other data to a server. The extension makes no network requests outside its own bundled files.
- It does not record or save audio, and it does not use the microphone.
- It has no accounts, analytics, advertising or tracking, and it does not sell or share data.

## What stays in your browser

Tonvela keeps these preferences in `chrome.storage.local` on your device, without cloud sync:

- Your last audio settings (volume, mode, leveling, target level), appearance and language.
- With "Remember settings for this site" on, the settings for up to 100 sites, keyed by domain name only. Full page addresses and browsing history are never stored.

Short-lived error messages for a tab are kept in `chrome.storage.session` and cleared when the tab closes or the browser restarts. Uninstalling the extension removes all of this data.

## Permissions

- `activeTab` and `tabCapture`: read the audio of the tab where you turn Tonvela on.
- `offscreen`: keep processing the audio after the popup closes.
- `storage`: save the preferences described above.

## Contact

Questions about this policy: open an issue at <https://github.com/isolmaz/tonvela-chrome/issues>.
