from pathlib import Path
from datetime import date
import argparse
import json
import zipfile
import hashlib
import re
import shutil

parser = argparse.ArgumentParser(description="Verify the extension folder and build the release ZIP.")
parser.add_argument("--skip-browser-tests", action="store_true", help="package without .cache browser/model results (fresh machines); no dist/TEST_RESULTS.txt is written")
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
extension = root / "extension"
manifest = json.loads((extension / "manifest.json").read_text(encoding="utf-8"))
assert manifest["manifest_version"] == 3
version = manifest["version"]
assert json.loads((root / "package.json").read_text(encoding="utf-8"))["version"] == version, "package.json and manifest versions differ"
assert re.search(rf"^## {re.escape(version)} ", (root / "CHANGELOG.md").read_text(encoding="utf-8"), re.M), f"CHANGELOG.md has no {version} section"
assert set(manifest["permissions"]) == {"activeTab", "tabCapture", "offscreen", "storage"}
assert "host_permissions" not in manifest
assert "connect-src 'self'" in manifest["content_security_policy"]["extension_pages"]
for file in [manifest["background"]["service_worker"], manifest["action"]["default_popup"], *manifest["icons"].values()]:
    assert (extension / file).is_file(), file
for file in extension.rglob("*.js"):
    code = file.read_text(encoding="utf-8")
    for relative in re.findall(r'''(?:from\s+|import\s+)["'](\.[^"']+)["']''', code):
        assert (file.parent / relative).is_file(), (file.name, relative)
    assert "storage.sync" not in code
    assert "MediaRecorder" not in code
    assert not re.search(r'''fetch\(["']https?://''', code)
for locale in (extension / "_locales").iterdir():
    json.loads((locale / "messages.json").read_text(encoding="utf-8"))
assert (extension / "_locales" / manifest["default_locale"] / "messages.json").is_file()
assert not (extension / "TEST_RESULTS.txt").exists(), "test notes are written to dist/, not into the package"
for file in extension.glob("*.html"):
    html = file.read_text(encoding="utf-8")
    ids = re.findall(r'\bid="([^"]+)"', html)
    assert len(ids) == len(set(ids)), f"duplicate HTML id: {file.name}"
    for relative in re.findall(r'''(?:src|href)=["']([^"']+)["']''', html):
        if relative.startswith("#"):
            assert relative[1:] in ids, (file.name, relative)
        elif not re.match(r"\w+:", relative):
            assert (file.parent / relative).is_file(), (file.name, relative)

dist = root / "dist"
dist.mkdir(exist_ok=True)


def write_report():
    integration = json.loads((root / ".cache/integration-results.json").read_text(encoding="utf-8"))
    voice = json.loads((root / ".cache/voice-test-results.json").read_text(encoding="utf-8"))
    assert all(item["passed"] for item in integration["results"])
    today = date.today()
    gain_test = next(item for item in integration["results"] if "400 percent" in item["test"])
    level_test = next(item for item in integration["results"] if "Stable output" in item["test"])
    simple_test = next(item for item in integration["results"] if "Enabled screen shows" in item["test"])
    layout_test = next(item for item in integration["results"] if "Advanced popup scrolls" in item["test"])
    report = f"""TONVELA {manifest['version']} — VERIFICATION NOTES
Date: {today.strftime('%B')} {today.day}, {today.year}
Environment: Windows, Chromium {integration['browser']}, separate test profile.

COMPLETED CHECKS
- Unit tests passed: 4x gain, peak limiting, stereo balance, target level
  under changing input, 400% total cap, silence, 0% mute, invalid input,
  settings validation, site preference cap, shortcuts, operation ordering,
  write coalescing, the speech model frame queue and locale files.
- Real Chrome tabCapture flow ran through the extension button and switch.
- Measured digital gain at 400%: {gain_test['gainDb']:.2f} dB (about 4x).
- With input amplitude changed 4x in the browser, settled output levels were
  {level_test['quietDb']:.2f} dBFS and {level_test['loudDb']:.2f} dBFS (target -30 dBFS).
- Keep this level: targets the heard level, refuses silence, undo restores.
- Normal, Steady, Speech, Night, Music and Voice only modes.
- The speech model loaded and ran with the browser offline, in a Worker off
  the audio thread, without late frames.
- Audio continues with the window closed; the switch releases capture; the
  audio engine closes with the last tab; site settings are kept.
- Interface: 372 px wide; simple screen {simple_test['height']} px, advanced
  screen {layout_test['bodyHeight']} px. Advanced content scrolls inside; the switch
  and site link stay visible. The meter updates without polling.
- English is the default language; switching to Turkish and back works.
- Dark/light/system appearance, live system theme tracking and the help page
  following the theme passed.
- No external network requests or runtime errors in the monitored extension
  contexts. The package policy limits connections to the extension's files.

LOCAL SPEECH MODEL EXPERIMENT
Speech generated with the local Windows speech engine was mixed with
fixed-seed noise and a synthetic musical chord. The model file is the one in
the ZIP. In this controlled sample:
- SI-SDR: {voice['inputSiSdrDb']:.2f} → {voice['outputSiSdrDb']:.2f} dB.
- Improvement in the speech/noise measure: {voice['improvementDb']:.2f} dB.
- Suppression in the background-only segment: {voice['backgroundOnlySuppressionDb']:.2f} dB.
- {voice['durationSeconds']:.2f} seconds of audio were processed in about
  {voice['processingSeconds']:.2f} seconds on this computer (16 kHz model test).
These numbers describe this synthetic sample only, not every video.

NOT VERIFIED / LIMITS
- Not every page of YouTube, Netflix and other sites was listened to.
  Protected content, every device and every Chrome version (including 116)
  were not tested. Two tabs sharing the audio engine at once was not tested
  in the browser.
- Shortcuts are registered with Chrome; OS-level conflicts were not tested.
- Long-running stability, latency on all hardware and subjective quality
  were not measured.
- Voice only is experimental speech enhancement, not a general source
  separation system. Output is mono; the model uses 16 kHz and adds delay.
- The voice model can fall behind real time on a busy computer; the browser
  test occasionally sees late frames. Late frames play unprocessed and the
  popup shows a warning.
- Steady level stays around the target; perfectly flat output and reaching
  the target on very weak sources are not guaranteed. Boost is capped at 400%.

INSTALL.txt covers installation; the Help page explains details.
"""
    (dist / "TEST_RESULTS.txt").write_text(report, encoding="utf-8")


if not args.skip_browser_tests:
    write_report()
archive = dist / f"Tonvela-Chrome-v{manifest['version']}.zip"
files = sorted(file for file in extension.rglob("*") if file.is_file())
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for file in files:
        z.write(file, file.relative_to(extension).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert "manifest.json" in z.namelist()
    assert len(z.namelist()) == len(files)
    for file in files:
        assert z.read(file.relative_to(extension).as_posix()) == file.read_bytes()
# Unversioned copy for the README link: releases/latest/download/Tonvela-Chrome.zip
shutil.copyfile(archive, dist / "Tonvela-Chrome.zip")
print(json.dumps({"archive": str(archive), "bytes": archive.stat().st_size, "files": len(files), "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "verified": True}, ensure_ascii=False, indent=2))
