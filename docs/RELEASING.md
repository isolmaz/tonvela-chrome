# Releasing to the Chrome Web Store

Store: <https://chromewebstore.google.com/detail/hionjhaedpahfidncfeainedjcdkfecn>

Every push to `main` runs CI. Only a version bump that you approve reaches the store.

## New version

1. Run `npm run verify` locally (CI skips the browser and speech model tests).
2. Bump the version: `npm version 1.3.4 --no-git-tag-version`, `extension/manifest.json` → `version`, and the first line of `extension/INSTALL.txt`.
3. Rename `## Unreleased` in `CHANGELOG.md` (or add a section) to `## 1.3.4 — <date>`. The release notes come from this section; without it the release stops.
4. Push to `main`.
5. Open the link in the approval email (or [Actions → Release](https://github.com/isolmaz/tonvela-chrome/actions/workflows/release.yml) → the **Waiting** run) → **Review deployments** → **chrome-web-store** → **Approve and deploy**. Not ready? **Reject**; the next push to `main` asks again.
6. When the **publish** job finishes, the version is in review and the `v1.3.4` GitHub release exists.

## Review

- The previous version stays live during review; the new one goes live by itself when review passes.
- No new version can be submitted until review ends.
- If rejected: fix, bump the version again, push.

## Status

| What | Where |
|---|---|
| Live version | Store page → **Details → Version** |
| Version in review | [Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Items** |
| Submitted packages | [GitHub Releases](https://github.com/isolmaz/tonvela-chrome/releases) |
| Publish runs | [Actions → Release](https://github.com/isolmaz/tonvela-chrome/actions/workflows/release.yml) |

## Troubleshooting

| Error | Fix |
|---|---|
| `CHANGELOG.md has no '## X ' section` | Add the section and push. |
| `package.json and manifest versions differ` | Bump every file in step 2. |
| `X is PENDING_REVIEW…` | Wait for review or cancel it in the Dashboard, then **Re-run**. |
| `invalid_grant`, `401`, `403` | Check the service account under Dashboard → **Settings → Service account** and that its key is valid. |

## Key

Secrets live in the `chrome-web-store` environment (`main` only): `CWS_SERVICE_ACCOUNT_KEY`, `CWS_PUBLISHER_ID`. The key is shared with WhyIBlockedX.

To rotate: Cloud Console → service account → **Keys → Add key → JSON**, then in both repos
`gh secret set CWS_SERVICE_ACCOUNT_KEY --env chrome-web-store -R isolmaz/<repo> < new.json`; delete the old key and the JSON file.
