#!/usr/bin/env node
/**
 * Tiny build/copier for the static site under site/.
 *
 * Contract:
 * - Copies site/** into dist/ (dist IS the publishable root).
 * - Honors a configurable base path (default /claude-code-router/) by injecting
 *   <base href="..."> and <meta name="ccr-base-path" ...> into every HTML file,
 *   replacing the <!--build:base--> marker when present (inserting after <head>
 *   otherwise). All runtime asset/link references are relative, so they resolve
 *   correctly under any base.
 * - Zero network policy guard: fails the build if any emitted HTML/CSS/JS
 *   references an absolute http(s) resource in an href/src/@import/url(...)
 *   position. Comments mentioning URLs do not trip this; attribute-shaped
 *   references do.
 * - Emits dist/build-manifest.json with the base path and file inventory.
 *
 * Usage:
 *   node scripts/build-site.mjs [--base /claude-code-router/] [--out dist]
 * Env: SITE_BASE_PATH, SITE_OUT_DIR
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argBase = (() => {
  const i = process.argv.indexOf('--base');
  return i !== -1 ? process.argv[i + 1] : undefined;
})();
const argOut = (() => {
  const i = process.argv.indexOf('--out');
  return i !== -1 ? process.argv[i + 1] : undefined;
})();

const BASE_PATH = String(argBase ?? process.env.SITE_BASE_PATH ?? '/claude-code-router/');
if (!BASE_PATH.startsWith('/') || !BASE_PATH.endsWith('/')) {
  console.error(`[build-site] base path must look like "/foo/" (got "${BASE_PATH}")`);
  process.exit(1);
}
const SRC = path.join(repoRoot, 'site');
const OUT = path.resolve(repoRoot, argOut ?? process.env.SITE_OUT_DIR ?? 'dist');

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// Remove previous output but never anything outside OUT.
fs.rmSync(OUT, { recursive: true, force: true });
ensureDir(OUT);

const files = walk(SRC);
const manifestFiles = [];
const networkHits = [];

// Attribute-shaped network reference detector (not comment-aware by design:
// any real fetchable reference must be bundled locally, even inside a comment
// we would rather not ship).
const NETWORK_RE =
  /(?:href|src)\s*=\s*["']https?:\/\/|@import\s+url\(\s*["']?https?:\/\/|url\(\s*["']?https?:\/\//i;

for (const abs of files) {
  const rel = path.relative(SRC, abs).split(path.sep).join('/');
  const dest = path.join(OUT, rel.split('/').join(path.sep));
  ensureDir(path.dirname(dest));
  let buf = fs.readFileSync(abs);

  if (rel.endsWith('.html')) {
    let html = buf.toString('utf8');
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version ?? '0.0.0';
    const injectTag = `<base href="${BASE_PATH}">\n  <meta name="ccr-base-path" content="${BASE_PATH}">\n  <meta name="ccr-site-version" content="${pkgVersion}">`;
    if (html.includes('<!--build:base-->')) {
      html = html.replace('<!--build:base-->', injectTag);
    } else {
      html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n  ${injectTag}`);
    }
    buf = Buffer.from(html, 'utf8');
  }

  const text = buf.toString('utf8');
  if (/\.(html|css|js|mjs)$/.test(rel)) {
    const m = text.match(NETWORK_RE);
    if (m) networkHits.push({ file: rel, match: m[0] });
  }

  fs.writeFileSync(dest, buf);
  manifestFiles.push({
    path: rel,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  });
}

const manifest = {
  generator: 'scripts/build-site.mjs',
  basePath: BASE_PATH,
  fileCount: manifestFiles.length,
  files: manifestFiles.sort((a, b) => a.path.localeCompare(b.path)),
};
fs.writeFileSync(
  path.join(OUT, 'build-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

if (networkHits.length) {
  console.error('[build-site] FAIL: remote/CDN references are forbidden at runtime:');
  for (const h of networkHits) console.error(`  ${h.file}: ${h.match}`);
  process.exit(1);
}

console.log(
  `[build-site] OK: ${manifest.fileCount} files -> ${path.relative(repoRoot, OUT)} (base "${BASE_PATH}")`,
);
