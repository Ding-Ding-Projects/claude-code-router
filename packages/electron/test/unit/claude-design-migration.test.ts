import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBetterSqliteDatabase } from "@ccr/core/storage/sqlite-native";
import {
  CLAUDE_DESIGN_MIGRATION_SCHEMA,
  exportClaudeDesignMigration,
  inspectClaudeDesignMigration
} from "@ccr/electron/main/claude-design-migration";

test("Claude Design migration preflight and export include selected safe records", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ccr-claude-design-migration-"));
  const dbFile = path.join(root, "legacy.sqlite");
  const output = path.join(root, "claude-design-desktop-import-v1.zip");
  const database = createBetterSqliteDatabase(dbFile);
  database.exec(`
    CREATE TABLE claude_design_items (collection TEXT, uuid TEXT, created_at TEXT, updated_at TEXT, title TEXT, model TEXT, data_json TEXT, messages_json TEXT);
    CREATE TABLE claude_design_files (project_id TEXT, path TEXT, created_at TEXT, updated_at TEXT, content_type TEXT, body_base64 TEXT, version INTEGER);
  `);
  const projectData = JSON.stringify({ type: 1, description: "A user project", project_id: "project-1" });
  database.prepare("INSERT INTO claude_design_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "projects", "project-1", "2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z", "Project One", "model", projectData, JSON.stringify([{ role: "user", text: "hello" }])
  );
  database.prepare("INSERT INTO claude_design_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "projects", "project-2", "2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z", "Project Two", "model", JSON.stringify({ type: 1 }), "[]"
  );
  database.prepare("INSERT INTO claude_design_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "design_systems", "ds-1", "2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z", "Design System", "model", JSON.stringify({ project_id: "project-1", tokens: { color: "blue" } }), "[]"
  );
  database.prepare("INSERT INTO claude_design_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "comments", "comment-1", "2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z", "Comment", "model", JSON.stringify({ project_id: "project-1", body: "Looks good" }), "[]"
  );
  const thumbnail = Buffer.from("thumbnail-bytes", "utf8").toString("base64");
  database.prepare("INSERT INTO claude_design_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "thumbnails", "project-1", "2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z", "Thumbnail", "model", JSON.stringify({ project_id: "project-1", body_base64: thumbnail, content_type: "image/png" }), "[]"
  );
  const file = Buffer.from("<main>hello</main>", "utf8");
  database.prepare("INSERT INTO claude_design_files VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "project-1", "index.html", "2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z", "text/html", file.toString("base64"), 1
  );
  database.close();

  try {
    const preflight = inspectClaudeDesignMigration({ projectIds: ["project-1"] }, { sourceDbFile: dbFile });
    assert.equal(preflight.available, true);
    assert.deepEqual(preflight.counts, {
      comments: 1,
      conversations: 1,
      designSystems: 1,
      files: 1,
      projects: 1,
      templates: 0,
      thumbnails: 1
    });
    assert.equal(preflight.idempotencyKey, inspectClaudeDesignMigration({ projectIds: ["project-1"] }, { sourceDbFile: dbFile }).idempotencyKey);

    const result = exportClaudeDesignMigration(output, { projectIds: ["project-1"] }, {
      exportTimestamp: "2026-09-02T00:00:00.000Z",
      sourceDbFile: dbFile,
      sourceProductVersion: "3.0.21"
    });
    assert.equal(result.canceled, false);
    assert.equal(result.file, output);
    assert.equal(result.manifest?.schemaVersion, CLAUDE_DESIGN_MIGRATION_SCHEMA);
    assert.equal(result.manifest?.sourceProductVersion, "3.0.21");
    assert.equal(result.manifest?.sourceDatabaseSha256, createHash("sha256").update(readFileSync(dbFile)).digest("hex"));
    assert.ok(result.manifest?.idempotencyKey);
    assert.equal(existsSync(output), true);
    const entries = readStoredZip(output);
    assert.match(entries.get("manifest.json") || "", /claude-design-desktop-import-v1/);
    assert.match(entries.get("records\/projects\/project-1\.json") || "", /Project One/);
    assert.match(entries.get("records\/conversations\/project-1\.json") || "", /hello/);
    assert.match(entries.get("records\/files\.jsonl") || "", /index\.html/);
    assert.ok(entries.has("files/project-1/index.html"));
    assert.ok(entries.has("thumbnails/project-1.png"));
    assert.equal([...entries.keys()].some((name) => /request|response|asset|oauth|gateway|telemetry/i.test(name)), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("Claude Design migration rejects traversal paths", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ccr-claude-design-migration-path-"));
  const dbFile = path.join(root, "legacy.sqlite");
  const database = createBetterSqliteDatabase(dbFile);
  database.exec("CREATE TABLE claude_design_items (collection TEXT, uuid TEXT, created_at TEXT, updated_at TEXT, title TEXT, model TEXT, data_json TEXT, messages_json TEXT); CREATE TABLE claude_design_files (project_id TEXT, path TEXT, created_at TEXT, updated_at TEXT, content_type TEXT, body_base64 TEXT, version INTEGER);");
  database.prepare("INSERT INTO claude_design_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("projects", "p1", "now", "now", "P1", "m", "{}", "[]");
  database.prepare("INSERT INTO claude_design_files VALUES (?, ?, ?, ?, ?, ?, ?)").run("p1", "../escape.txt", "now", "now", "text/plain", Buffer.from("bad").toString("base64"), 1);
  database.close();
  try {
    assert.throws(() => exportClaudeDesignMigration(path.join(root, "out.zip"), { projectIds: ["p1"] }, { sourceDbFile: dbFile }), /Unsafe project file path/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

function readStoredZip(file: string): Map<string, string> {
  const bytes = readFileSync(file);
  const result = new Map<string, string>();
  let cursor = 0;
  while (cursor + 30 <= bytes.length && bytes.readUInt32LE(cursor) === 0x04034b50) {
    const nameLength = bytes.readUInt16LE(cursor + 26);
    const extraLength = bytes.readUInt16LE(cursor + 28);
    const size = bytes.readUInt32LE(cursor + 22);
    const name = bytes.subarray(cursor + 30, cursor + 30 + nameLength).toString("utf8");
    const bodyStart = cursor + 30 + nameLength + extraLength;
    result.set(name, bytes.subarray(bodyStart, bodyStart + size).toString("utf8"));
    cursor = bodyStart + size;
  }
  return result;
}
