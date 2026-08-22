#!/usr/bin/env node
/**
 * capture-ui.mjs — genuine headless captures of the REAL built management UI.
 *
 * What this script does (no mockups, no source previews, no hand-edited images):
 *
 *   1. Ensures the local Electron binary exists (self-heals from the
 *      %LOCALAPPDATA%/electron/Cache zip when `npm ci` left it unextracted,
 *      verifying SHA-256 against the electron package's own checksums.json).
 *   2. Launches the BUILT app (packages/electron/dist) on this machine with a
 *      throwaway profile: --user-data-dir plus CCR_INTERNAL_APP_DATA_DIR both
 *      pointed at temp directories, so nothing touches real user config.
 *      Intended to be run with its window landing on a named off-screen
 *      desktop via the lowlevel headless route; the script itself only needs
 *      the app's --remote-debugging-port to drive it.
 *   3. Drives the running renderer over the Chrome DevTools protocol
 *      (WebSocket without an Origin header), finishing onboarding and flipping
 *      the theme through the app's own bridge API (window.ccr.*), clicking the
 *      real sidebar buttons for Providers and Settings.
 *   4. Saves PNGs into docs/captures/ and composes social-preview.png at the
 *     repo root (1280x640) around one of the real captures using local
 *     System.Drawing via a temp PowerShell script — no new dependencies.
 *
 * Usage:
 *   node scripts/capture-ui.mjs [--port 9223] [--out docs/captures]
 *       Full flow: heal the binary, launch the built app with a throwaway
 *       profile, drive it, save captures, compose the social preview.
 *   node scripts/capture-ui.mjs --attach 9223 [--out docs/captures]
 *       Attach mode: the app was already launched elsewhere (e.g. on a named
 *       off-screen desktop through the lowlevel headless route); drive THAT
 *       instance over its debugging port and leave the process untouched.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = readFlag("--out") ?? "docs/captures";
const outAbs = path.isAbsolute(outDir) ? outDir : path.join(repoRoot, outDir);
const cdpPort = Number(readFlag("--port") ?? 9223);

/* ---------------------------------------------------------------- helpers */

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function log(message) {
  console.log(`[capture-ui] ${message}`);
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Parses width/height out of a PNG buffer (IHDR big-endian at offset 16). */
function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error("not a PNG");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function assertNonBlank(buffer, label) {
  const { width, height } = pngDimensions(buffer);
  if (buffer.length < 20_000) {
    throw new Error(`${label}: PNG suspiciously small (${buffer.length} bytes); likely blank`);
  }
  log(`${label}: ${width}x${height}, ${(buffer.length / 1024).toFixed(0)} KiB`);
  return { width, height };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeoutMs = 60_000, intervalMs = 250, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

/* -------------------------------------------------- electron self-healing */

function ensureElectronBinary() {
  const electronDir = path.join(repoRoot, "node_modules", "electron");
  const distDir = path.join(electronDir, "dist");
  const exe = path.join(distDir, "electron.exe");
  if (existsSync(exe)) {
    log(`electron binary present: ${exe}`);
    return exe;
  }

  const { version } = JSON.parse(readFileSync(path.join(electronDir, "package.json"), "utf8"));
  const zipName = `electron-v${version}-win32-x64.zip`;
  const cacheRoot = path.join(process.env.LOCALAPPDATA ?? "", "electron", "Cache");
  const cachedZip = findCachedZip(cacheRoot, zipName);
  if (!cachedZip) {
    throw new Error(
      `${zipName} not found under ${cacheRoot}; run "node node_modules/electron/install.js" or npm ci once online`
    );
  }
  verifyChecksum(electronDir, zipName, cachedZip);

  log(`extracting ${cachedZip} -> ${distDir}`);
  mkdirSync(distDir, { recursive: true });
  runPowerShell(`
    Expand-Archive -LiteralPath '${cachedZip}' -DestinationPath '${distDir}' -Force | Out-Null
  `);
  // The @electron/get cache hit exits before extraction on some Node versions,
  // so judge success by the binary existing, never by install.js exit code.
  if (!existsSync(exe)) {
    throw new Error(`extraction did not produce ${exe}`);
  }
  writeFileSync(path.join(electronDir, "path.txt"), "electron.exe\n");
  log(`electron binary healed from cache`);
  return exe;
}

function findCachedZip(cacheRoot, zipName) {
  if (!existsSync(cacheRoot)) return undefined;
  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    const child = path.join(cacheRoot, entry.name);
    if (entry.isDirectory()) {
      const nested = path.join(child, zipName);
      if (existsSync(nested) && statSync(nested).isFile()) return nested;
      for (const deeper of readdirSync(child, { withFileTypes: true })) {
        if (deeper.isFile() && deeper.name === zipName) return path.join(child, deeper.name);
      }
    } else if (entry.name === zipName) {
      return child;
    }
  }
  return undefined;
}

function verifyChecksum(electronDir, zipName, zipPath) {
  const checksumsPath = path.join(electronDir, "checksums.json");
  if (!existsSync(checksumsPath)) {
    log("checksums.json missing in electron package; skipping digest verification");
    return;
  }
  const checksums = JSON.parse(readFileSync(checksumsPath, "utf8"));
  const expected =
    typeof checksums[zipName] === "string"
      ? checksums[zipName]
      : checksums?.[zipName]?.sha256 ?? checksums?.SHASUMS256?.[zipName];
  if (!expected) {
    throw new Error(`checksum for ${zipName} missing from checksums.json`);
  }
  const actual = sha256File(zipPath);
  if (actual !== expected.replace(/^sha256-/i, "").toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${zipPath}\n  expected ${expected}\n  actual   ${actual}`);
  }
  log(`verified SHA-256 of cached ${zipName}`);
}

function runPowerShell(script) {
  const ps1 = path.join(tmpdir(), `ccr-capture-${Date.now()}.ps1`);
  writeFileSync(ps1, script.trim() + "\n", "utf8");
  try {
    const result = spawn.sync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
    if (result.status !== 0) {
      throw new Error(`powershell exited ${result.status}: ${result.stderr}`);
    }
    return result.stdout;
  } finally {
    rmSync(ps1, { force: true });
  }
}

/* ----------------------------------------------------------- CDP client */

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    // No Origin header is sent by Node's WebSocket client — the equivalent of
    // CDP's suppress_origin, which Chromium requires for non-browser clients.
    this.socket = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("websocket error")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(payload);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP call timed out: ${method}`));
        }
      }, 30_000);
    });
  }

  /** Synchronous-expression evaluate; deliberately no awaitPromise (it can
   *  hang the DevTools session on some hosts). Long work is kicked off in the
   *  page and polled through window.__cap* flags instead. */
  async eval(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true
    });
    if (exceptionDetails) {
      throw new Error(`evaluate failed: ${exceptionDetails.text} ${JSON.stringify(exceptionDetails.exception ?? {})}`);
    }
    return result.value;
  }

  async screenshot() {
    const { data } = await this.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: false });
    return Buffer.from(data, "base64");
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // already gone
    }
  }
}

async function findHomeTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  const targets = await response.json();
  const pages = targets.filter((target) => target.type === "page");
  const home = pages.filter((target) => target.url.includes("/renderer/pages/home/index.html"));
  if (home.length !== 1) {
    throw new Error(
      `expected exactly one home page target, saw ${home.length}; pages=${JSON.stringify(pages.map((p) => p.url))}`
    );
  }
  if (pages.length > 1) {
    log(`note: additional page targets present: ${pages.filter((p) => !p.url.includes("home")).map((p) => p.url).join(", ")}`);
  }
  return home[0];
}

/* ------------------------------------------------------------- main flow */

async function main() {
  const attachMode = process.argv.includes("--attach");
  let electronExe;
  let scratch;
  let child;
  let stderrTail = "";
  let cleanedUp = false;

  if (!attachMode) {
    electronExe = ensureElectronBinary();
    scratch = mkdtempSync(path.join(tmpdir(), "ccr-captures-"));
    const profileDir = path.join(scratch, "profile");
    const dataDir = path.join(scratch, "appdata");
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  }
  mkdirSync(outAbs, { recursive: true });

  if (!attachMode) {
    const profileDir = path.join(scratch, "profile");
    const dataDir = path.join(scratch, "appdata");
    const args = [
      repoRoot,
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      "--guest",
      "--disable-sync",
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages",
      "--no-first-run",
      "--no-default-browser-check"
    ];
    log(`launching built app on CDP port ${cdpPort} (throwaway profile ${profileDir})`);
    child = spawn(electronExe, args, {
      cwd: repoRoot,
      env: { ...process.env, CCR_INTERNAL_APP_DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
    });
  }

  try {
    const target = await waitFor(() => findHomeTarget(cdpPort), {
      timeoutMs: 90_000,
      label: "home page CDP target"
    }).catch((error) => {
      throw new Error(`app did not expose home target: ${error.message}\nstderr:\n${stderrTail}`);
    });
    log(`connected target: ${target.url}`);

    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");

    await waitFor(async () => cdp.eval("document.readyState === 'complete' && !!window.ccr && !!document.body && document.body.innerText.length > 40"), {
      timeoutMs: 60_000,
      label: "renderer ready"
    });

    /* Finish onboarding through the app's own bridge, then reload so the
       overview surface renders. Kick off async work, poll a sync flag. */
    cdp.eval("window.ccr.setOnboardingFinished().then(() => { window.__capOnb = 'ok'; }).catch((e) => { window.__capOnb = 'err:' + e; }); void 0");
    await waitFor(async () => (await cdp.eval("window.__capOnb")) === "ok", { timeoutMs: 30_000, label: "onboarding marked finished" });
    cdp.eval("location.reload(); void 0");
    await sleep(1500);
    await waitFor(async () => cdp.eval("!!window.ccr && document.querySelector('nav') !== null"), {
      timeoutMs: 60_000,
      label: "overview navigation rendered"
    });

    const save = (name, buffer) => {
      const file = path.join(outAbs, name);
      writeFileSync(file, buffer);
      return file;
    };

    /* Home — light (fresh system default resolves light on the capture host). */
    await waitFor(async () => (await cdp.eval("document.documentElement.getAttribute('data-md-theme')")) === "light", {
      timeoutMs: 15_000,
      label: "light theme applied"
    }).catch(() => log("theme attribute was not 'light'; capturing as-is"));
    await sleep(1200); // settle fonts/layout after first paint
    assertNonBlank(save("home-light.png", await cdp.screenshot()), "home-light.png");

    /* Home — dark via the app's own preference bridge. */
    cdp.eval("window.ccr.setThemePreference('dark').then(() => { window.__capTheme = 'ok'; }).catch((e) => { window.__capTheme = 'err:' + e; }); void 0");
    await waitFor(
      async () =>
        (await cdp.eval("document.documentElement.getAttribute('data-md-theme')")) === "dark",
      { timeoutMs: 20_000, label: "dark theme applied" }
    );
    await sleep(900);
    assertNonBlank(save("home-dark.png", await cdp.screenshot()), "home-dark.png");

    /* Providers view via the real sidebar button click. */
    const providersClick = await cdp.eval(
      `(() => {
         const wanted = ['providers'];
         const buttons = [...document.querySelectorAll('button')];
         const hit = buttons.find((b) => {
           const text = (b.textContent || '').trim().toLowerCase();
           return wanted.some((w) => text === w || text.startsWith(w));
         });
         if (!hit) return 'not-found';
         hit.click();
         return 'clicked';
       })()`
    );
    if (providersClick !== "clicked") throw new Error(`providers nav button not found (${providersClick})`);
    await waitFor(async () => cdp.eval("(document.querySelector('main')?.innerText || '').toLowerCase().includes('provider')"), {
      timeoutMs: 20_000,
      label: "providers view rendered"
    });
    await sleep(900);
    assertNonBlank(save("providers-light.png", await cdp.screenshot()), "providers-light.png");

    /* Settings dialog via the sidebar footer settings button. */
    const settingsClick = await cdp.eval(
      `(() => {
         const buttons = [...document.querySelectorAll('button')];
         const hit = buttons.find((b) => /setting/i.test(b.title || '') || /^settings?$/i.test((b.textContent || '').trim()));
         if (!hit) return 'not-found';
         hit.click();
         return 'clicked';
       })()`
    );
    if (settingsClick !== "clicked") throw new Error(`settings button not found (${settingsClick})`);
    await waitFor(async () => cdp.eval("!!document.querySelector('[role=\"dialog\"]')"), {
      timeoutMs: 20_000,
      label: "settings dialog opened"
    });
    await sleep(900);
    assertNonBlank(save("settings-dialog-dark.png", await cdp.screenshot()), "settings-dialog-dark.png");

    cdp.close();
    log("captures complete");

    if (!attachMode) {
      cleanedUp = true;
      await cleanupApp(child, scratch);
    }
    await composeSocialPreview(path.join(outAbs, "home-dark.png"));
    return { attachMode };
  } catch (error) {
    console.error(`[capture-ui] FAILED: ${error.message}`);
    if (stderrTail.trim()) console.error(`[capture-ui] app stderr tail:\n${stderrTail}`);
    throw error;
  } finally {
    if (!attachMode && !cleanedUp) {
      await cleanupApp(child, scratch);
    }
  }
}

async function cleanupApp(child, scratch) {
  if (child.pid && !child.killed) {
    // Kill the whole process tree; Electron keeps helper children alive.
    spawn.sync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
  await sleep(1000);
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    log(`warn: could not remove scratch dir ${scratch}: ${error.message}`);
  }
}

/* ------------------------------------------------- social preview compose */

export function buildSocialPreviewScript({ sourcePng, destPng }) {
  // Runs locally through System.Drawing; embeds the REAL captured UI, never a
  // gradient-with-words. Palette mirrors packages/ui/src/styles/m3/tokens.css
  // (dark scheme): background #101414, primary #7ed6cc, outline #3f4947.
  return `
Add-Type -AssemblyName System.Drawing
$bg    = [System.Drawing.ColorTranslator]::FromHtml('#101414')
$panel = [System.Drawing.ColorTranslator]::FromHtml('#181c1c')
$prim  = [System.Drawing.ColorTranslator]::FromHtml('#7ed6cc')
$text  = [System.Drawing.ColorTranslator]::FromHtml('#dee4e3')
$muted = [System.Drawing.ColorTranslator]::FromHtml('#bec9c7')
$line  = [System.Drawing.ColorTranslator]::FromHtml('#3f4947')

$canvas = New-Object System.Drawing.Bitmap 1280, 640
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$brushBg = New-Object System.Drawing.SolidBrush $bg
$g.FillRectangle($brushBg, 0, 0, 1280, 640)

# accent bar
$brushPrim = New-Object System.Drawing.SolidBrush $prim
$g.FillRectangle($brushPrim, 56, 84, 10, 210)

$titleFont = New-Object System.Drawing.Font('Segoe UI', 44, [System.Drawing.FontStyle]::Bold)
$subFont   = New-Object System.Drawing.Font('Segoe UI', 19)
$bodyFont  = New-Object System.Drawing.Font('Segoe UI', 15)
$smallFont = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Italic)

$brushText = New-Object System.Drawing.SolidBrush $text
$brushMuted = New-Object System.Drawing.SolidBrush $muted
$g.DrawString('Claude Code Router', $titleFont, $brushText, 86, 88)
$g.DrawString('Local gateway for Claude Code and Codex.', $subFont, $brushMuted, 88, 168)
$g.DrawString('Providers, routing, usage and logs in one Material 3 desktop UI.', $bodyFont, $brushMuted, 88, 212)

# embedded real capture panel
$shot = [System.Drawing.Image]::FromFile('${sourcePng.replace(/\\/g, "\\\\")}')
$panelRect = New-Object System.Drawing.Rectangle 430, 96, 792, 470
$brushPanel = New-Object System.Drawing.SolidBrush $panel
$g.FillRectangle($brushPanel, $panelRect)
$innerW = 768; $innerH = 446
$scale = [Math]::Min($innerW / $shot.Width, $innerH / $shot.Height)
$drawW = [int]($shot.Width * $scale); $drawH = [int]($shot.Height * $scale)
$dx = $panelRect.X + (($innerW - $drawW) / 2); $dy = $panelRect.Y + (($innerH - $drawH) / 2)
$g.DrawImage($shot, $dx, $dy, $drawW, $drawH)
$pen = New-Object System.Drawing.Pen $line, 2
$g.DrawRectangle($pen, $panelRect)
$shot.Dispose()

$g.DrawString('Real capture of the built management interface', $smallFont, $brushMuted, 436, 574)
$g.Dispose()
$canvas.Save('${destPng.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose()
Write-Output 'composed'
`;
}

async function composeSocialPreview(homeDarkPath) {
  const destPng = path.join(repoRoot, "social-preview.png");
  const ps1 = path.join(tmpdir(), `ccr-social-${Date.now()}.ps1`);
  writeFileSync(ps1, buildSocialPreviewScript({ sourcePng: homeDarkPath, destPng }), "utf8");
  try {
    const result = spawn.sync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }
    );
    if (result.status !== 0 || !result.stdout.includes("composed")) {
      throw new Error(`social preview compose failed (${result.status}): ${result.stderr || result.stdout}`);
    }
  } finally {
    rmSync(ps1, { force: true });
  }
  const dims = pngDimensions(readFileSync(destPng));
  if (dims.width !== 1280 || dims.height !== 640) {
    throw new Error(`social-preview.png must be exactly 1280x640, got ${dims.width}x${dims.height}`);
  }
  copyFileSync(destPng, path.join(outAbs, "social-preview.png")); // capture-folder copy for reference
  log(`social-preview.png composed at ${destPng} (1280x640)`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { ensureElectronBinary, composeSocialPreview, pngDimensions };
