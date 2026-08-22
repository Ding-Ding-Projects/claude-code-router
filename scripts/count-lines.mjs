#!/usr/bin/env node
/**
 * Committed line counter for claude-code-router.
 *
 * Deterministic, offline (no network), pure Node.js. Walks the repository from
 * the script's own directory and prints a fixed-format table:
 *
 *   - project rows: source, tests, styles/markup, documentation, config & data
 *   - per row: file count, total lines, non-blank lines
 *   - excluded rows listed explicitly (dependency tree, build output, lockfiles,
 *     vendored trees, VCS internals, binary assets) with the exclusion reason
 *   - project total and grand total side by side
 *
 * The dependency tree (node_modules) is enumerated for file counts only; its
 * line counts are deliberately not read, so the script stays fast. Every other
 * excluded category is actually read and counted, so the grand total is a real
 * sum of counted lines plus an explicitly uncounted row.
 *
 * Usage: node scripts/count-lines.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Classification tables
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".mts", ".cts", ".ts", ".tsx", ".jsx",
  ".py", ".sh", ".bat", ".cmd", ".ps1", ".rb", ".go", ".rs", ".java",
]);

const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less", ".html", ".htm", ".svg", ".vue"]);
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".adoc"]);
const CONFIG_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".xml", ".plist"]);

const TEST_DIR_SEGMENTS = new Set([
  "tests", "test", "__tests__", "__mocks__", "e2e", "spec",
]);

const TEST_FILE_PATTERNS = [
  /\.test\.[cm]?[jt]sx?$/i,
  /\.spec\.[cm]?[jt]sx?$/i,
  /-test\.[cm]?[jt]sx?$/i,
  /^test-.*\.[cm]?[jt]sx?$/i,
];

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".tiff",
  ".ico", ".icns", ".exe", ".dll", ".node", ".wasm", ".zip", ".gz", ".tgz",
  ".7z", ".tar", ".br", ".pdf", ".mp3", ".mp4", ".mov", ".wav", ".ogg",
  ".ttf", ".otf", ".woff", ".woff2", ".eot", ".db", ".sqlite", ".sqlite3",
  ".dylib", ".so", ".bin", ".dat", ".jar", ".class",
]);

const LOCKFILE_NAMES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
  "composer.lock", "Gemfile.lock", "Cargo.lock", "poetry.lock", "uv.lock",
]);

const BUILD_OUTPUT_DIR_SEGMENTS = new Set([
  "node_modules", "dist", "build-output", "release", "release-local",
  "coverage", ".nyc_output", "playwright-report", "test-results",
  "blob-report", "out", ".next", ".nuxt", ".vite", ".turbo", ".cache",
  ".parcel-cache", ".tmp", "tmp", ".test-dist", "target",
]);

const VENDORED_DIR_SEGMENTS = new Set([
  "vendor", "vendored", "third_party", "third-party", "cdn", "external",
]);

const VCS_DIR_NAMES = new Set([".git", ".hg", ".svn"]);

// ---------------------------------------------------------------------------
// Row model
// ---------------------------------------------------------------------------

function newRow(label, note) {
  return { label, files: 0, lines: 0, nonBlank: 0, counted: true, note: note ?? "" };
}

const rows = {
  source: newRow("Application source"),
  tests: newRow("Tests & benchmarks"),
  styles: newRow("Styles & markup"),
  docs: newRow("Documentation"),
  config: newRow("Configuration & data"),
  generated: newRow("Generated data (kept separate)"),
};

// Generated files large enough to move the totals are broken out into their own
// row instead of being folded into hand-written configuration.
const GENERATED_FILE_PATHS = new Set(["packages/core/models.json"]);

const excluded = {
  nodeModules: newRow("Excluded: dependency tree (node_modules)", "files enumerated; line contents not read (third-party code, would dominate every figure)"),
  buildOutput: newRow("Excluded: build output & tool caches", "generated artifacts, not hand-written source"),
  lockfiles: newRow("Excluded: lockfiles", "generated from manifests, not hand-written"),
  vendored: newRow("Excluded: vendored / third-party trees", "imported external code, not this project's source"),
  vcs: newRow("Excluded: VCS internals (.git)", "repository metadata"),
  binary: newRow("Excluded: binary & media assets", "not text; line counts meaningless"),
};

// ---------------------------------------------------------------------------
// Filesystem walk (sorted, deterministic; symlinks never followed)
// ---------------------------------------------------------------------------

function classify(relativePath, extension) {
  const segments = relativePath.split(/[\\/]/);
  const base = segments[segments.length - 1];
  const lowerSegments = segments.slice(0, -1).map((segment) => segment.toLowerCase());

  if (lowerSegments.some((segment) => TEST_DIR_SEGMENTS.has(segment))) return rows.tests;
  if (TEST_FILE_PATTERNS.some((pattern) => pattern.test(base))) return rows.tests;
  if (base.toLowerCase() === "benchmarks" || lowerSegments.includes("benchmarks")) return rows.tests;

  if (STYLE_EXTENSIONS.has(extension)) return rows.styles;
  if (DOC_EXTENSIONS.has(extension)) return rows.docs;
  if (CONFIG_EXTENSIONS.has(extension)) return rows.config;
  if (SOURCE_EXTENSIONS.has(extension)) return rows.source;

  // Unknown text-ish extension: bucket by top-level area so nothing is dropped
  // from the totals without a visible home.
  if (lowerSegments.includes("docs") || lowerSegments.includes("blog")) return rows.docs;
  return rows.config;
}

function walk(dir, relativeBase, visit) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const lowerName = entry.name.toLowerCase();
      if (VCS_DIR_NAMES.has(lowerName)) {
        excluded.vcs.files += 1;
        continue;
      }
      if (BUILD_OUTPUT_DIR_SEGMENTS.has(lowerName)) {
        const isNodeModules = lowerName === "node_modules";
        const row = isNodeModules ? excluded.nodeModules : excluded.buildOutput;
        row.files += countFilesBelow(absolutePath);
        if (!isNodeModules) countTreeLines(absolutePath, row);
        continue;
      }
      if (VENDORED_DIR_SEGMENTS.has(lowerName)) {
        excluded.vendored.files += countFilesBelow(absolutePath);
        countTreeLines(absolutePath, excluded.vendored);
        continue;
      }
      walk(absolutePath, relativePath, visit);
      continue;
    }
    if (!entry.isFile()) continue;
    visit(relativePath, absolutePath);
  }
}

function countFilesBelow(dir) {
  let count = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (VCS_DIR_NAMES.has(entry.name.toLowerCase())) {
        count += 1;
        continue;
      }
      count += countFilesBelow(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

function countTreeLines(dir, row) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (VCS_DIR_NAMES.has(entry.name.toLowerCase())) continue;
      countTreeLines(child, row);
    } else if (entry.isFile()) {
      countFileLines(child, row);
    }
  }
}

function countFileLines(absolutePath, row) {
  const extension = path.extname(absolutePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) {
    row.files += 1;
    return;
  }
  let content;
  try {
    content = fs.readFileSync(absolutePath, "utf8");
  } catch {
    row.files += 1;
    return;
  }
  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  row.files += 1;
  row.lines += lines.length;
  let nonBlank = 0;
  for (const line of lines) {
    if (line.trim().length > 0) nonBlank += 1;
  }
  row.nonBlank += nonBlank;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  walk(ROOT, "", (relativePath, absolutePath) => {
    const base = path.basename(relativePath);
    if (LOCKFILE_NAMES.has(base)) {
      excluded.lockfiles.files += 1;
      countFileLines(absolutePath, excluded.lockfiles);
      return;
    }
    if (GENERATED_FILE_PATHS.has(relativePath.split(path.sep).join("/"))) {
      countFileLines(absolutePath, rows.generated);
      return;
    }
    const extension = path.extname(base).toLowerCase();
    if (BINARY_EXTENSIONS.has(extension)) {
      excluded.binary.files += 1;
      return;
    }
    const row = classify(relativePath, extension);
    countFileLines(absolutePath, row);
  });

  const includedRows = [rows.source, rows.tests, rows.styles, rows.docs, rows.config];
  const excludedRows = [
    excluded.nodeModules, excluded.buildOutput, excluded.lockfiles,
    excluded.vendored, excluded.vcs, excluded.binary,
  ];

  const pad = (value, width) => String(value).padStart(width);
  const header = `${"Category".padEnd(46)} ${"Files".padStart(8)} ${"Lines".padStart(12)} ${"Non-blank".padStart(12)}`;
  const rule = "-".repeat(header.length);

  console.log("claude-code-router line count");
  console.log(`Measured at: repository working tree rooted at ${path.basename(ROOT)}`);
  console.log("Method: deterministic filesystem walk; sorted traversal; no network.");
  console.log("");
  console.log(header);
  console.log(rule);
  for (const row of includedRows) {
    console.log(
      `${row.label.padEnd(46)} ${pad(row.files, 8)} ${pad(row.lines, 12)} ${pad(row.nonBlank, 12)}`
    );
  }

  let projectFiles = 0;
  let projectLines = 0;
  let projectNonBlank = 0;
  for (const row of includedRows) {
    projectFiles += row.files;
    projectLines += row.lines;
    projectNonBlank += row.nonBlank;
  }
  console.log(rule);
  console.log(
    `${"PROJECT TOTAL (included rows)".padEnd(46)} ${pad(projectFiles, 8)} ${pad(projectLines, 12)} ${pad(projectNonBlank, 12)}`
  );

  console.log("");
  console.log("Excluded from the project total (each listed explicitly):");
  console.log(header);
  console.log(rule);
  let grandLines = projectLines;
  let grandNonBlank = projectNonBlank;
  let grandFiles = projectFiles;
  for (const row of excludedRows) {
    const linesCell = row.counted ? pad(row.lines, 12) : "not counted".padStart(12);
    const nonBlankCell = row.counted ? pad(row.nonBlank, 12) : "not counted".padStart(12);
    console.log(`${row.label.padEnd(46)} ${pad(row.files, 8)} ${linesCell} ${nonBlankCell}`);
    grandFiles += row.files;
    if (row.counted) {
      grandLines += row.lines;
      grandNonBlank += row.nonBlank;
    }
    if (row.note) console.log(`${`  (${row.note})`}`);
  }
  console.log(rule);
  console.log(
    `${"GRAND TOTAL (project + counted exclusions)".padEnd(46)} ${pad(grandFiles, 8)} ${pad(grandLines, 12)} ${pad(grandNonBlank, 12)}`
  );
  console.log("");
  console.log(
    "Notes: node_modules line contents are intentionally not read (see exclusion note above); " +
    "every other excluded row is fully counted and included in the grand total. " +
    "Reproduce with: node scripts/count-lines.mjs"
  );
}

main();
