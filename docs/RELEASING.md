# Releasing to the Chrome Web Store

Tonvela on the store: <https://chromewebstore.google.com/detail/hionjhaedpahfidncfeainedjcdkfecn>

Nothing reaches the store without an explicit approval:

| Change on `main` | What happens |
|---|---|
| Version unchanged | CI only. Nothing is sent to the store. |
| Version bumped, no `v<version>` GitHub release yet | After CI passes, the publish job **waits for approval**. Approve it and the ZIP is uploaded, submitted for review and released on GitHub as `v<version>`. Reject it and nothing is uploaded. |

The version goes live by itself once Google's review passes, which can take from a few hours to a few days.

## Where to see the status

| What | Where |
|---|---|
| Version users get | Store page → **Details → Version** |
| Version in review | [Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Items → Tonvela** |
| Versions sent to the store | [GitHub Releases](https://github.com/isolmaz/tonvela-chrome/releases): each `v<version>` holds the exact ZIP that was submitted |
| Pending approval or last attempt | [Actions → Release](https://github.com/isolmaz/tonvela-chrome/actions/workflows/release.yml): the **Chrome Web Store** step prints the published and submitted versions |

## Cutting a release

1. Get the changes onto `main` and run `npm run verify` locally: CI does not run the browser and speech model tests.
2. Bump the version everywhere it appears:
   - `npm version 1.3.4 --no-git-tag-version` (`package.json`, `package-lock.json`)
   - `extension/manifest.json` → `version`
   - first line of `extension/INSTALL.txt`
3. In `CHANGELOG.md`, rename `## Unreleased` to `## 1.3.4 — October 8, 2026`. That section becomes the release notes; without it the release stops.
4. Commit (`Tonvela 1.3.4`) and push to `main`.
5. GitHub asks for approval by email or notification, and the run shows **Waiting** in Actions. Open **Review deployments** → `chrome-web-store` → **Approve and deploy**.
   - Not ready to ship? **Reject**. Nothing is uploaded, and the next push to `main` asks again.
6. When the job finishes, the **Chrome Web Store** step shows `Submitted 1.3.4 for review: PENDING_REVIEW`.

To retry, open Actions → **Release** → **Run workflow** on `main`; it asks for approval too. A version that is already published or in review is not uploaded again; only the missing GitHub release is created.

## Troubleshooting

| Error | Fix |
|---|---|
| `CHANGELOG.md has no '## X ' section` | Add the `## X — date` section and push. |
| `package.json and manifest versions differ` | Bump all the files in step 2. |
| `X is PENDING_REVIEW; wait for it or cancel it…` | The previous version is still in review. Wait, or cancel the submission in the Dashboard, then **Re-run** the job. |
| `invalid_grant`, `401` or `403` | Check that `github-publisher@cws-publish-510912.iam.gserviceaccount.com` is still listed under Dashboard → **Settings → Service account**, and that its key wasn't deleted. |
| The store rejects the version as not newer | Make the version higher than the published one. |

## Setup (done once)

- Google Cloud project `cws-publish-510912`: Chrome Web Store API enabled, service account `github-publisher` (no roles).
- Developer Dashboard → **Settings → Service account**: the email above is added.
- GitHub → **Settings → Environments → `chrome-web-store`**: `main` only, required reviewer `isolmaz`. Secrets: `CWS_SERVICE_ACCOUNT_KEY` (the service account's JSON key) and `CWS_PUBLISHER_ID`.
- Rotating the key: Cloud Console → service account → **Keys → Add key → JSON**, then
  `gh secret set CWS_SERVICE_ACCOUNT_KEY --env chrome-web-store -R isolmaz/tonvela-chrome < new.json`.
  WhyIBlockedX uses the same key, so update it there too. Then delete the old key in Cloud Console and the JSON file from your machine.
