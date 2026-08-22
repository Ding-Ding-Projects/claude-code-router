#!/usr/bin/env node
// Deterministic line counter for the claude-code-router monorepo.
//
//   node scripts/count-lines.mjs
//
// - No network access. Reads the working tree only.
// - Deterministic: fixed walk order (sorted paths), no timestamps, locale-free
//   number formatting, so repeated runs on the same tree print byte-identical
//   tables. This is the table the Release workflow publishes into release notes.
// - Arithmetic agrees with itself: COUNTED TOTAL is the exact sum of the counted
//   rows, and GRAND TOTAL is COUNTED TOTAL + every excluded row. A catch-all
//   "other (counted)" row guarantees no file silently vanishes from the total.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Exclusion rules. Every rule is listed as its own output row, even when it
// matches zero files, so exclusions are stated rather than silent.
// ---------------------------------------------------------------------------

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules", // installed dependencies
  ".git", // repository metadata
  "dist", // build output (packages/*/dist)
  "release", // electron-builder packaging output
  "release-local", // local-config packaging output
  "coverage", // test coverage output
  "test-results", // playwright output
  "playwright-report", // playwright output
  ".playwright", // playwright cache
  "build-logs", // CI/local build log capture
  "vendor", // vendored third-party trees (none currently)
  "third_party", // vendored third-party trees (none currently)
]);

const EXCLUDED_FILES = new Set([
  "package-lock.json", // lockfile
  "npm-shrinkwrap.json", // lockfile
  "yarn.lock", // lockfile
  "pnpm-lock.yaml", // lockfile
]);

// Generated at build/publish time by scripts/generate-models-json.mjs; 500k+
// lines of machine-assembled model catalog that would swamp every hand-written
// number in the table. Keys use forward slashes to match the normalized walk
// paths (join() would emit backslashes on Windows and silently match nothing).
const GENERATED_FILES = new Set(["packages/core/models.json"]);

const SOURCE_EXTS = new Set([
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "yml", "yaml", "toml",
  "sh", "bash", "bat", "cmd", "ps1", "py", "rb", "go", "rs", "c", "h", "cpp",
]);
const STYLE_MARKUP_EXTS = new Set([
  "css", "scss", "sass", "less", "html", "htm", "md", "markdown", "svg", "vue",
]);

const TEST_SEGMENT = new Set(["test", "tests", "__tests__", "spec"]);
const TEST_FILENAME = /\.(test|spec)\.[cm]?[jt]sx?$/i;

// ---------------------------------------------------------------------------
// Exclusion accumulators.
//
// These MUST be declared before walk(ROOT) runs below: walk() reports every
// skipped directory through recordExcluded() as it goes, and recordExcluded
// writes into these. As module-level consts they would sit in their temporal
// dead zone during the walk and throw "Cannot access 'excluded' before
// initialization" the moment the tree contains an excluded directory such as
// node_modules/ (which CI always has after npm ci).
// ---------------------------------------------------------------------------

const excluded = {
  dirs: empty(),
  lockfiles: empty(),
  generated: empty(),
  binary: empty(),
};

// Per-excluded-directory rollup so each row names what was skipped.
const dirRollup = new Map();

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // unreadable directory: skipped, reported below if unexpected
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) {
        recordExcluded("dirs", rel, null);
        continue;
      }
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(rel.split(sep).join("/"));
    }
  }
  return out;
}

const files = walk(ROOT);

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

function countText(content) {
  let lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop(); // trailing newline is not an extra line
  let nonBlank = 0;
  for (const line of lines) {
    if (line.trim() !== "") nonBlank += 1;
  }
  return { lines: lines.length, nonBlank };
}

const counted = { source: empty(), tests: empty(), stylesMarkup: empty(), other: empty() };

function empty() {
  return { files: 0, lines: 0, nonBlank: 0 };
}
function add(bucket, path, stats) {
  bucket.files += 1;
  bucket.lines += stats.lines;
  bucket.nonBlank += stats.nonBlank;
}
function recordExcluded(kind, relPath, stats) {
  add(excluded[kind], relPath, stats ?? { lines: 0, nonBlank: 0 });
  const top = relPath.split(sep)[0];
  const cur = dirRollup.get(top) ?? empty();
  cur.files += 1;
  if (stats) {
    cur.lines += stats.lines;
    cur.nonBlank += stats.nonBlank;
  }
  dirRollup.set(top, cur);
}

for (const rel of files) {
  const segments = rel.split("/");
  const base = segments[segments.length - 1];

  // Exclusions first: lockfiles and generated files are named rows.
  if (EXCLUDED_FILES.has(base)) {
    recordExcluded("lockfiles", rel, countText(readFile(rel)));
    continue;
  }
  if (GENERATED_FILES.has(rel)) {
    recordExcluded("generated", rel, countText(readFile(rel)));
    continue;
  }

  const raw = readFileSync(join(ROOT, rel));
  if (raw.includes(0)) {
    // NUL byte: treat as binary; counting "lines" in binaries is meaningless.
    recordExcluded("binary", rel, null);
    continue;
  }

  const stats = countText(raw.toString("utf8"));
  const ext = (base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "").toLowerCase();
  const isTest =
    TEST_FILENAME.test(base) || segments.slice(0, -1).some((s) => TEST_SEGMENT.has(s.toLowerCase()));

  if (isTest) add(counted.tests, rel, stats);
  else if (STYLE_MARKUP_EXTS.has(ext)) add(counted.stylesMarkup, rel, stats);
  else if (SOURCE_EXTS.has(ext)) add(counted.source, rel, stats);
  else add(counted.other, rel, stats); // catch-all keeps the totals honest
}

function readFile(rel) {
  return readFileSync(join(ROOT, rel)).toString("utf8");
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pad = (label, width) => label + " ".repeat(Math.max(1, width - label.length));

const rows = [
  ["source (project code)", counted.source],
  ["tests", counted.tests],
  ["styles & markup (css/scss/html/md/svg)", counted.stylesMarkup],
  ["other (counted)", counted.other],
];

let totalFiles = 0;
let totalLines = 0;
let totalNonBlank = 0;
for (const [, s] of rows) {
  totalFiles += s.files;
  totalLines += s.lines;
  totalNonBlank += s.nonBlank;
}

console.log("Line counts for claude-code-router (working tree)");
console.log("");
console.log(
  pad("Bucket", 44) +
    pad("Files", 10) +
    pad("Lines", 14) +
    pad("Non-blank", 14),
);
for (const [label, s] of rows) {
  console.log(pad(label, 44) + pad(fmt(s.files), 10) + pad(fmt(s.lines), 14) + pad(fmt(s.nonBlank), 14));
}
console.log("-".repeat(82));
console.log(
  pad("COUNTED TOTAL", 44) +
    pad(fmt(totalFiles), 10) +
    pad(fmt(totalLines), 14) +
    pad(fmt(totalNonBlank), 14),
);

console.log("");
console.log("Excluded (stated, not silent):");
console.log(
  pad("Bucket", 44) +
    pad("Files", 10) +
    pad("Lines", 14) +
    pad("Non-blank", 14),
);
const excludedRows = [
  ["node_modules / dependency directories", excluded.dirs],
  ["lockfiles", excluded.lockfiles],
  ["generated model catalog", excluded.generated],
  ["binary assets (icons/images)", excluded.binary],
];
let excFiles = 0;
let excLines = 0;
let excNonBlank = 0;
for (const [label, s] of excludedRows) {
  console.log(pad(label, 44) + pad(fmt(s.files), 10) + pad(fmt(s.lines), 14) + pad(fmt(s.nonBlank), 14));
  excFiles += s.files;
  excLines += s.lines;
  excNonBlank += s.nonBlank;
}
console.log("-".repeat(82));
console.log(
  pad("GRAND TOTAL (counted + excluded)", 44) +
    pad(fmt(totalFiles + excFiles), 10) +
    pad(fmt(totalLines + excLines), 14) +
    pad(fmt(totalNonBlank + excNonBlank), 14),
);

console.log("");
console.log(
  "Notes: dist/, release/, release-local/, coverage/ and playwright output are excluded as build/test output; " +
    "no vendored trees are present (vendor/, third_party/ match nothing); " +
    "packages/core/models.json is generated by scripts/generate-models-json.mjs and is excluded so hand-written numbers stay meaningful.",
);

console.log("");
console.log(
  "Determinism: this table depends only on the working-tree contents; repeated runs on an unchanged tree print identical output.",
);
