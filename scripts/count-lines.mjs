#!/usr/bin/env node
// Deterministic line counter for the claude-code-router monorepo.
//
//   node scripts/count-lines.mjs
//
// - No network access. The count tables read the working tree only; the
//   authorship attribution section additionally reads local git history.
// - Deterministic: fixed walk order (sorted paths), no timestamps, locale-free
//   number formatting, so repeated runs on the same tree print byte-identical
//   count tables. This is the table the Release workflow publishes into
//   release notes.
// - Arithmetic agrees with itself: COUNTED TOTAL is the exact sum of the counted
//   rows, and GRAND TOTAL is COUNTED TOTAL + every excluded row. A catch-all
//   "other (counted)" row guarantees no file silently vanishes from the total.

import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

// Nested checkout copies. A linked worktree living under .claude/worktrees/
// is a full second copy of this repository, not part of the project's source;
// walking into it would count every line twice. Paths use forward slashes to
// match the normalized walk paths.
const EXCLUDED_SUBTREES = [".claude/worktrees"];

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
  nested: empty(),
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
    const relNorm = rel.split(sep).join("/");
    if (entry.isDirectory()) {
      if (EXCLUDED_SUBTREES.some((subtree) => relNorm === subtree || relNorm.startsWith(subtree + "/"))) {
        recordExcluded("nested", relNorm, null);
        continue;
      }
      if (EXCLUDED_DIR_NAMES.has(entry.name)) {
        recordExcluded("dirs", rel, null);
        continue;
      }
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(relNorm);
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

// rel path -> line count, for every file in a counted bucket. Declared before
// the counting loop fills it; the attribution section reads it afterwards.
const fileLines = new Map();

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

  // Remember per-file line counts: the attribution section blames exactly the
  // counted files and its totals must reconcile with COUNTED TOTAL.
  fileLines.set(rel, stats.lines);

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
  ["nested checkout copies (.claude/worktrees)", excluded.nested],
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
    "nested checkout copies under .claude/worktrees/ are excluded so a linked worktree is never counted twice; " +
    "no vendored trees are present (vendor/, third_party/ match nothing); " +
    "packages/core/models.json is generated by scripts/generate-models-json.mjs and is excluded so hand-written numbers stay meaningful.",
);

console.log("");
console.log(
  "Determinism: the count tables depend only on the working-tree contents; repeated runs on an unchanged tree print identical output. " +
    "The authorship attribution below additionally reads repository history, so it can differ across checkouts of the same commit.",
);

// ---------------------------------------------------------------------------
// Authorship attribution: surviving lines per author, beside the totals.
// ---------------------------------------------------------------------------

// A commit counts as agent-written when its AUTHOR email is an automation
// identity or its message carries the Claude Fable 5 co-author trailer.
const AGENT_AUTHOR_EMAILS = new Set(["noreply@anthropic.com"]);
const AGENT_TRAILER = /co-authored-by:\s*claude fable 5\b/i;
const ZERO_SHA = "0".repeat(40);

function printAttribution() {
  console.log("");
  console.log("Authorship attribution (surviving working-tree lines per author):");
  let isShallow;
  try {
    isShallow =
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim() === "true";
  } catch {
    console.log("  Unavailable: git is missing from PATH or this directory is not a git checkout.");
    return;
  }
  if (isShallow) {
    console.log("  Skipped: this clone is SHALLOW and git blame needs full history.");
    console.log("  Run 'git fetch --unshallow' and re-run to report the agent/human split.");
    return;
  }

  // One pass over history classifies every commit; blame then only maps lines.
  let agentCommits;
  try {
    agentCommits = collectAgentCommits();
  } catch (error) {
    console.log(`  Unavailable: could not read repository history (${error.message.split("\n")[0]}).`);
    return;
  }

  const tally = { agent: 0, human: 0, uncommitted: 0, unblamable: 0 };
  for (const [rel, lineCount] of fileLines) {
    const owners = blameFinalLineOwners(rel);
    if (!owners) {
      // Not in history yet (fresh scratch/log file, repo metadata file) or
      // vanished mid-run: named here so the totals still reconcile.
      tally.unblamable += lineCount;
      continue;
    }
    for (let i = 1; i <= lineCount; i += 1) {
      const sha = owners[i];
      if (!sha || sha === ZERO_SHA) tally.uncommitted += 1;
      else if (agentCommits.has(sha)) tally.agent += 1;
      else tally.human += 1;
    }
  }

  console.log(
    pad("Bucket", 44) + pad("Lines", 14),
  );
  console.log(
    pad("agent-written (automation author or Claude Fable 5 trailer)", 44) +
      pad(fmt(tally.agent), 14),
  );
  console.log(pad("human-written", 44) + pad(fmt(tally.human), 14));
  console.log(pad("uncommitted (not yet in history)", 44) + pad(fmt(tally.uncommitted), 14));
  console.log(
    pad("counted but unattributable (absent from history)", 44) +
      pad(fmt(tally.unblamable), 14),
  );
  const attributedTotal = tally.agent + tally.human + tally.uncommitted + tally.unblamable;
  console.log("-".repeat(58));
  console.log(pad("ATTRIBUTED TOTAL", 44) + pad(fmt(attributedTotal), 14));
  if (attributedTotal !== totalLines) {
    console.log(
      `WARNING: attributed total ${attributedTotal} does not match COUNTED TOTAL ${totalLines}; ` +
        "a file changed between counting and blaming - re-run before publishing these numbers.",
    );
  }
}

function collectAgentCommits() {
  // %x1e separates records, %x1f separates fields; both are control chars no
  // ordinary subject/body contains.
  const rawLog = execFileSync("git", ["log", "--format=%x1e%H%x1f%aE%x1f%B"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  const agentCommits = new Set();
  for (const record of rawLog.split("\x1e")) {
    if (!record.trim()) continue;
    const newlineAt = record.indexOf("\n");
    const head = newlineAt === -1 ? record : record.slice(0, newlineAt);
    const body = newlineAt === -1 ? "" : record.slice(newlineAt + 1);
    const [sha, email] = head.split("\x1f");
    if (!sha) continue;
    const isAgent =
      AGENT_AUTHOR_EMAILS.has((email || "").trim().toLowerCase()) || AGENT_TRAILER.test(body);
    if (isAgent) agentCommits.add(sha.trim());
  }
  return agentCommits;
}

function blameFinalLineOwners(rel) {
  let out;
  try {
    out = execFileSync("git", ["blame", "--line-porcelain", "--", rel], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // A counted file that is not in history yet (scratch file, repo
      // metadata) makes git blame exit non-zero with a "fatal:" on stderr;
      // swallow that here - the file is reported in the unattributable row.
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const owners = [];
  let currentSha = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("\t")) continue; // content line
    const headerMatch = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(line);
    if (headerMatch) {
      currentSha = headerMatch[1];
      const finalLine = parseInt(headerMatch[3], 10);
      const span = headerMatch[4] === undefined ? 1 : parseInt(headerMatch[4], 10);
      for (let i = 0; i < span; i += 1) owners[finalLine + i] = currentSha;
      continue;
    }
  }
  return owners;
}

printAttribution();

