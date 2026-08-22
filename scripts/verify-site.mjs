#!/usr/bin/env node
/**
 * Node-based smoke verification for the static site (no browser opened).
 *
 * Checks the BUILT output in dist/ plus the source modules:
 *  1. build manifest exists and the configured base path was injected;
 *  2. every relative href/src in every built HTML resolves to an emitted file;
 *  3. every ES module imports cleanly in Node (syntax + export surface);
 *  4. every i18n key referenced by HTML and by the settings registry exists
 *     in the dictionary (missing keys would render as raw key strings);
 *  5. every registry tab has its static pane + tab stub in settings.html;
 *  6. the documented wave-2 slot ids exist;
 *  7. localStorage is only ever touched through store.js (one persistence
 *     layer, namespaced ccr-site.*);
 *  8. the rainbow sentinel never appears inside any swatch/preset palette.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(repoRoot, 'dist');
const siteSrc = path.join(repoRoot, 'site');
const problems = [];
const ok = (name) => console.log(`  ok  ${name}`);
const fail = (name, detail) => {
  problems.push(`${name}: ${detail}`);
  console.error(`FAIL  ${name}: ${detail}`);
};

/* 1. manifest -------------------------------------------------------------- */
const manifestPath = path.join(dist, 'build-manifest.json');
if (!fs.existsSync(manifestPath)) fail('manifest', 'dist/build-manifest.json missing — run scripts/build-site.mjs first');
else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.basePath !== '/claude-code-router/') fail('base-path', `got "${manifest.basePath}"`);
  else ok(`manifest base path ${manifest.basePath} (${manifest.fileCount} files)`);
}

/* 2. built HTML references resolve ---------------------------------------- */
const emitted = new Set();
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else emitted.add(path.relative(dist, p).split(path.sep).join('/'));
  }
})(dist);
let refCount = 0;
for (const file of emitted) {
  if (!file.endsWith('.html')) continue;
  const html = fs.readFileSync(path.join(dist, file), 'utf8');
  if (!html.includes(`<base href="/claude-code-router/">`)) fail('base-tag', file);
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith('mailto:')) {
      fail('remote-ref', `${file} -> ${ref}`);
      continue;
    }
    if (ref.startsWith('/')) continue; // absolute site URL (e.g. og:) — not an asset ref
    const clean = ref.split('?')[0].split('#')[0];
    const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(file), clean));
    const resolved = normalized === '.' || normalized === './' ? 'index.html' : normalized;
    refCount++;
    if (!emitted.has(resolved)) fail('broken-ref', `${file} -> ${ref} (resolved ${resolved})`);
  }
}
ok(`all ${refCount} built HTML asset references resolve`);

/* 3. modules import cleanly ------------------------------------------------ */
const jsDir = path.join(siteSrc, 'assets', 'js');
const modules = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
for (const m of modules) {
  try {
    await import(pathToFileURL(path.join(jsDir, m)).href);
  } catch (err) {
    fail('module-import', `${m}: ${err.message}`);
  }
}
ok(`${modules.length} ES modules import cleanly in Node`);

/* 4. i18n key audit --------------------------------------------------------- */
const i18n = await import(pathToFileURL(path.join(jsDir, 'i18n.js')).href);
const DICT = i18n.DICT;
const used = new Set();
const collectKey = (k) => k && used.add(k);
for (const file of ['index.html', 'settings.html']) {
  const html = fs.readFileSync(path.join(siteSrc, file), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-html|-placeholder|-aria-label|-title)?="([^"]+)"/g)) collectKey(m[1]);
}
const regMod = await import(pathToFileURL(path.join(jsDir, 'settings-registry.js')).href);
const stub = new Proxy(
  {},
  {
    get(_t, k) {
      if (k === 'siteVersion') return '0.0.0';
      if (k === 'TARGETS') return [];
      return () => {};
    },
  },
);
const registryRows = regMod.registry(stub);
for (const r of registryRows) {
  collectKey(r.labelKey);
  collectKey(r.descKey);
  collectKey(r.actionLabelKey);
  if (r.labels) {
    collectKey(r.labels.minKey);
    collectKey(r.labels.maxKey);
  }
  for (const [, key] of r.options ?? []) {
    // Dictionary keys look like dotted identifiers; raw option labels do not.
    if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9.]+)+$/.test(key)) collectKey(key);
  }
}
for (const tab of regMod.TABS) collectKey(tab.labelKey);
const missing = [...used].filter((k) => !(k in DICT));
if (missing.length) fail('i18n-keys', `missing from dictionary: ${missing.join(', ')}`);
else ok(`all ${used.size} referenced i18n keys exist in the dictionary`);

/* 5. settings panes + tabs -------------------------------------------------- */
const settingsHtml = fs.readFileSync(path.join(siteSrc, 'settings.html'), 'utf8');
for (const tab of regMod.TABS) {
  if (!settingsHtml.includes(`id="spane-${tab.id}"`)) fail('settings-pane', `#spane-${tab.id} missing`);
  if (!settingsHtml.includes(`id="stab-${tab.id}"`)) fail('settings-tab', `#stab-${tab.id} missing`);
}
ok(`all ${regMod.TABS.length} settings sections have static pane + tab stub`);

/* 6. wave-2 slots ------------------------------------------------------------ */
const slots = {
  'index.html': ['docs-article-slot', 'changelog-slot', 'download-slot'],
  'settings.html': ['lock-layer-slot', 'authenticator-slot', 'history-slot', 'scheduled-slot'],
};
for (const [file, ids] of Object.entries(slots)) {
  const html = fs.readFileSync(path.join(siteSrc, file), 'utf8');
  for (const id of ids) if (!html.includes(`id="${id}"`)) fail('slot', `#${id} missing from ${file}`);
}
ok('all 7 documented wave-2 slot ids present');

/* 7. single persistence layer ------------------------------------------------ */
const STORAGE_API = /(?:localStorage|sessionStorage)\s*(?:\.|\[)/;
for (const m of modules) {
  let src = fs.readFileSync(path.join(jsDir, m), 'utf8');
  if (m === 'store.js') continue;
  if (m === 'app.js') {
    // app.js may use sessionStorage ONLY for the cross-page teleport handoff.
    const lines = src.split(String.fromCharCode(10));
    src = lines.filter((l) => !l.includes('ccr.teleportSetting')).join(String.fromCharCode(10));
  }
  if (STORAGE_API.test(src)) fail('persistence', `${m} touches storage directly instead of store.js`);
}
ok('storage APIs only used through the ccr-site.* persistence layer');

/* 8. rainbow sentinel isolation ---------------------------------------------- */
const colorSrc = fs.readFileSync(path.join(jsDir, 'color.js'), 'utf8');
const presetsMatch = colorSrc.match(/const presets = \[([^\]]*)\]/);
if (!presetsMatch) fail('rainbow', 'preset swatch list not found');
else if (presetsMatch[1].includes('rainbow')) fail('rainbow', 'sentinel leaked into the swatch palette');
else ok('rainbow sentinel is a marker only — never inside the swatch palette');

console.log('');
if (problems.length) {
  console.error(`verify-site: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('verify-site: all checks passed');
