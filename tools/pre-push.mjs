// Checks before every push (.githooks/pre-push, installed by `npm ci`). Lint and
// unit tests always run. When the pushed commits change extension/, the browser
// and speech model tests and the packager run too, if this machine is set up for
// them (Playwright Chromium and .cache/test-speech.wav); otherwise they are
// skipped with a note. A failure stops the push; `git push --no-verify` skips all.
//   node tools/pre-push.mjs            from the hook; reads pushed refs on stdin
//   node tools/pre-push.mjs --all      run every check now (npm run verify)
//   node tools/pre-push.mjs --install  point git at .githooks (npm install runs it)
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";

const mode = process.argv[2];
const run = command => { console.log(`\n> ${command}`); execSync(command, { stdio: "inherit" }); };
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const python = process.platform === "win32" ? "python" : "python3";
const ZERO = /^0+$/;

function browserReady() {
  try {
    const { chromium } = createRequire(import.meta.url)("playwright");
    return fs.existsSync(chromium.executablePath()) && fs.existsSync(".cache/test-speech.wav");
  } catch { return false; }
}

function check(full) {
  run("npm run check");
  if (!full) return;
  if (!browserReady()) {
    console.log("\nSkipping browser and speech model tests: run `npx playwright install chromium` and tools/create-speech-fixture.ps1 to enable them.");
    run(`${python} tools/package.py --skip-browser-tests`);
    return;
  }
  run("npm run test:browser");
  run("npm run test:voice");
  run(`${python} tools/package.py`);
}

// Files changed by a push: against the remote's old commit, or against main for a new branch.
function changedFiles(local, remote) {
  let base = ZERO.test(remote) ? "" : remote;
  try { if (base) git("cat-file", "-e", `${base}^{commit}`); } catch { base = ""; }
  if (!base) { try { base = git("merge-base", local, "origin/main"); } catch { return null; } }
  return git("diff", "--name-only", base, local).split("\n").filter(Boolean);
}

if (mode === "--install") {
  try { git("config", "core.hooksPath", ".githooks"); } catch { /* not a git checkout */ }
} else if (mode === "--all") {
  check(true);
} else {
  // Each line: <local ref> <local sha> <remote ref> <remote sha>
  const pushes = fs.readFileSync(0, "utf8").split("\n").map(line => line.trim().split(" ")).filter(([, local]) => local && !ZERO.test(local));
  if (!pushes.length) process.exit(0);
  const head = git("rev-parse", "HEAD");
  if (pushes.some(([, local]) => local !== head) || git("status", "--porcelain")) {
    console.error("Checks run on your working tree: push the checked-out branch with no uncommitted changes (or skip with --no-verify).");
    process.exit(1);
  }
  const full = pushes.some(([, local, , remote]) => {
    const files = changedFiles(local, remote);
    return !files || files.some(file => file.startsWith("extension/"));
  });
  console.log(full ? "extension/ changed: running every check." : "Running lint and unit tests.");
  check(full);
}
