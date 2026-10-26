# Privacy Policy

_Last updated: October 27, 2026_

Tonvela is a Chrome extension that processes the audio of a browser tab on your device. This policy describes what it does with data.

## What Tonvela does not do

- It does not send audio, measurements, settings or any other data to a server. The extension makes no network requests outside its own bundled files.
- It does not record or save audio, and it never listens to the microphone.
- It has no accounts, analytics, advertising or tracking, and it does not sell or share data.

## What stays in your browser

Tonvela keeps these preferences in `chrome.storage.local` on your device, without cloud sync:

- Listening preferences that apply to every processed tab: output device, mono sound, left / right balance and hearing protection.
- Appearance, language and whether to remember settings for each site.
- With "Remember settings for each site" on, the volume, mode and target level for up to 100 sites, keyed by domain name only. Full page addresses and browsing history are never stored. Turning the option off deletes the saved sites.

Short-lived error messages for a tab are kept in `chrome.storage.session` and cleared when the tab closes or the browser restarts. Uninstalling the extension removes all of this data.

## Permissions

- `activeTab` and `tabCapture`: read the audio of the tab where you use Tonvela.
- `offscreen`: keep processing the audio after the popup closes.
- `storage`: save the preferences described above.
- Microphone (optional, asked only if you choose to show device names): Chrome shows output device names only after microphone access is allowed once. Tonvela opens a page that asks for it, closes the microphone immediately and only reads the device names. You can withdraw it in Chrome's site settings for the extension.

## Contact

Questions about this policy: open an issue at <https://github.com/isolmaz/tonvela-chrome/issues>.
