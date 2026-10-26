// Uploads a release ZIP to the Chrome Web Store and submits it for review (API v2).
// Run by .github/workflows/release.yml; safe to re-run: a version that is already
// published or in review is not uploaded again.
//   node tools/publish-cws.mjs <zip> <version>
// Environment:
//   CWS_SERVICE_ACCOUNT_KEY  JSON key of a service account added under Account in the Developer Dashboard
//   CWS_PUBLISHER_ID         publisher ID from the Developer Dashboard
//   CWS_EXTENSION_ID         store item ID
import { createSign } from "node:crypto";
import fs from "node:fs";

const API = "https://chromewebstore.googleapis.com";
const [zip, version] = process.argv.slice(2);
const { CWS_SERVICE_ACCOUNT_KEY: key, CWS_PUBLISHER_ID: publisher, CWS_EXTENSION_ID: extension } = process.env;
const item = `publishers/${publisher}/items/${extension}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const versions = revision => (revision?.distributionChannels ?? []).map(channel => channel.crxVersion);
let token = "";

async function call(method, url, body, type) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (type) headers["Content-Type"] = type;
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

// OAuth 2.0 JWT bearer grant with the service account key:
// https://developers.google.com/identity/protocols/oauth2/service-account#httprest
async function accessToken() {
  let account;
  // JSON.parse error messages quote part of the input; never let them echo the key into the log.
  try { account = JSON.parse(key); } catch { throw new Error("CWS_SERVICE_ACCOUNT_KEY is not valid JSON"); }
  const now = Math.floor(Date.now() / 1000);
  const part = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iss: account.client_email, scope: "https://www.googleapis.com/auth/chromewebstore", aud: account.token_uri, iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
  const grant = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` });
  return (await call("POST", account.token_uri, grant)).access_token;
}

async function main() {
  if (!zip || !version || !key || !publisher || !extension) {
    throw new Error("usage: node tools/publish-cws.mjs <zip> <version>, with CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID and CWS_EXTENSION_ID set");
  }
  token = await accessToken();
  const status = () => call("GET", `${API}/v2/${item}:fetchStatus`);

  const { takenDown, publishedItemRevisionStatus: published, submittedItemRevisionStatus: submitted } = await status();
  console.log(`Store: published ${versions(published).join(", ") || "none"}, submitted ${submitted ? `${versions(submitted).join(", ")} (${submitted.state})` : "none"}`);
  if (takenDown) throw new Error("the item has been taken down; see the Developer Dashboard");
  if (versions(published).includes(version)) return console.log(`${version} is already published.`);
  if (submitted && ["PENDING_REVIEW", "STAGED"].includes(submitted.state)) {
    if (versions(submitted).includes(version)) return console.log(`${version} is already submitted (${submitted.state}).`);
    throw new Error(`${versions(submitted).join(", ")} is ${submitted.state}; wait for it or cancel it in the Developer Dashboard, then re-run this workflow`);
  }

  let upload = await call("POST", `${API}/upload/v2/${item}:upload`, fs.readFileSync(zip), "application/zip");
  for (let poll = 0; upload.uploadState === "IN_PROGRESS" && poll < 60; poll++) {
    await sleep(5000);
    upload = { ...upload, uploadState: (await status()).lastAsyncUploadState };
  }
  if (upload.uploadState !== "SUCCEEDED") throw new Error(`upload ended as ${upload.uploadState}: ${JSON.stringify(upload)}`);
  if (upload.crxVersion && upload.crxVersion !== version) throw new Error(`the store read version ${upload.crxVersion} from the ZIP, expected ${version}`);
  console.log(`Uploaded ${zip}.`);

  const result = await call("POST", `${API}/v2/${item}:publish`, JSON.stringify({ publishType: "DEFAULT_PUBLISH" }), "application/json");
  for (const warning of result.warningInfo?.warnings ?? []) console.log(`::warning::${warning.reason}: ${warning.description}`);
  console.log(`Submitted ${version} for review: ${result.state}. It goes live when review passes.`);
}

main().catch(error => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
