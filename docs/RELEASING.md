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
3. In `CHANGELOG.md`, rename `## Unreleased` (or add a section) to `## 1.3.4 — October 8, 2026`. That section becomes the release notes; without it the release stops.
4. Commit (`Tonvela 1.3.4`) and push to `main`.
5. GitHub emails you for approval. You approve it yourself:
   1. Open the link in the email, or the top **Waiting** run under [Actions → Release](https://github.com/isolmaz/tonvela-chrome/actions/workflows/release.yml).
   2. The yellow box says *"chrome-web-store needs approval to start deploying changes"*. Click **Review deployments**.
   3. Tick **chrome-web-store** and click **Approve and deploy**.
   - Not ready to ship? **Reject**. Nothing is uploaded, and the next push to `main` asks again.
6. About a minute later the **publish** job finishes: the **Chrome Web Store** step shows `Submitted 1.3.4 for review: PENDING_REVIEW` and the `v1.3.4` GitHub release exists.

To retry, open Actions → **Release** → **Run workflow** on `main`; it asks for approval too. A version that is already published or in review is not uploaded again; only the missing GitHub release is created.

## After submission

- The Developer Dashboard shows the version as pending review. **The previous version stays live meanwhile**; users keep using it.
- When review passes, the new version goes live by itself and Chrome updates users within hours. Nothing to do.
- While a version is in review, another one can't be submitted for the same item; the publish job stops with a `PENDING_REVIEW` error (see Troubleshooting).
- **If Google rejects it**, the previous version stays live and the reason arrives by email and in the Dashboard. The `v1.3.4` GitHub release already exists, so the same version is not submitted again: fix the problem, bump the version (`1.3.5`), add it to the CHANGELOG and push.

## Troubleshooting

| Error | Fix |
|---|---|
| `CHANGELOG.md has no '## X ' section` | Add the `## X — date` section and push. |
| `package.json and manifest versions differ` | Bump all the files in step 2. |
| `X is PENDING_REVIEW; wait for it or cancel it…` | The previous version is still in review. Wait, or cancel the submission in the Dashboard, then **Re-run** the job. |
| `invalid_grant`, `401` or `403` | Check that `github-publisher@cws-publish-510912.iam.gserviceaccount.com` is still listed under Dashboard → **Settings → Service account**, and that its key wasn't deleted. |
| The store rejects the version as not newer | Make the version higher than the published one. |

## Setup (done once)

None of this is repeated per release; it only matters when rotating the key or changing accounts.

- Google Cloud project `cws-publish-510912`: Chrome Web Store API enabled, service account `github-publisher` (no roles).
- Developer Dashboard → **Settings → Service account**: the email above is added.
- GitHub → **Settings → Environments → `chrome-web-store`**: `main` only, required reviewer `isolmaz`. Secrets: `CWS_SERVICE_ACCOUNT_KEY` (the service account's JSON key) and `CWS_PUBLISHER_ID`.
- Rotating the key: Cloud Console → service account → **Keys → Add key → JSON**, then
  `gh secret set CWS_SERVICE_ACCOUNT_KEY --env chrome-web-store -R isolmaz/tonvela-chrome < new.json`.
  WhyIBlockedX uses the same key, so update it there too. Then delete the old key in Cloud Console and the JSON file from your machine.
