import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DATADIR } from "@ccr/core/config/constants";
import { createBetterSqliteDatabase, type BetterSqliteDatabase } from "@ccr/core/storage/sqlite-native";

export const CLAUDE_DESIGN_MIGRATION_SCHEMA = "claude-design-desktop-import-v1";
export const CLAUDE_DESIGN_SOURCE_COMMIT = "4a3c267e7e22f6636a02542554309cd49cd41e9d";
export const CLAUDE_DESIGN_PLUGIN_DATA_DIR = path.join(DATADIR, "plugins", "claude-design");
export const CLAUDE_DESIGN_PLUGIN_DB_FILE = path.join(CLAUDE_DESIGN_PLUGIN_DATA_DIR, "claude-design.sqlite");

const MAX_PROJECTS = 2_000;
const MAX_FILES_PER_PROJECT = 10_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 50_000;

export type ClaudeDesignMigrationSelection = {
  projectIds?: string[];
  includeTemplates?: boolean;
  includeDesignSystems?: boolean;
  includeConversations?: boolean;
  includeComments?: boolean;
  includeThumbnails?: boolean;
};

export type ClaudeDesignMigrationCounts = {
  projects: number;
  templates: number;
  designSystems: number;
  files: number;
  conversations: number;
  comments: number;
  thumbnails: number;
  replies: number;
  timestamps: number;
  metadata: number;
};

export type ClaudeDesignMigrationProject = {
  id: string;
  name: string;
  ownerKey: string | null;
  type: "project" | "template";
  fileCount: number;
};

export type ClaudeDesignMigrationPreflight = {
  available: boolean;
  sourceDbFile: string;
  sourceDbSha256?: string;
  counts: ClaudeDesignMigrationCounts;
  selectedProjectIds: string[];
  projects: ClaudeDesignMigrationProject[];
  idempotencyKey?: string;
  exclusions: Record<string, string>;
  issues: string[];
  exclusionCounts: Record<string, number>;
};

export type ClaudeDesignMigrationManifest = {
  format: typeof CLAUDE_DESIGN_MIGRATION_SCHEMA;
  schemaVersion: 1;
  sourceProductVersion: string;
  sourceCommit: string;
  sourceDatabaseSha256: string;
  exportedAt: string;
  idempotencyKey: string;
  recordCounts: Record<string, number>;
  exclusionCounts: Record<string, number>;
  fileHashes: Record<string, string>;
};

export type ClaudeDesignMigrationExportResult = {
  canceled: boolean;
  file?: string;
  manifest?: ClaudeDesignMigrationManifest;
};

export function validateClaudeDesignMigrationSelection(value: unknown): ClaudeDesignMigrationSelection {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Migration selection must be an object.");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["projectIds", "includeTemplates", "includeDesignSystems", "includeConversations", "includeComments", "includeThumbnails"]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`Unknown migration selection field: ${key}.`);
  const result: ClaudeDesignMigrationSelection = {};
  if (record.projectIds !== undefined) {
    if (!Array.isArray(record.projectIds) || record.projectIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9._-]{1,160}$/.test(id.trim()))) throw new Error("Migration projectIds must contain safe project identifiers.");
    result.projectIds = [...new Set(record.projectIds.map((id) => (id as string).trim()))];
  }
  for (const key of ["includeTemplates", "includeDesignSystems", "includeConversations", "includeComments", "includeThumbnails"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "boolean") throw new Error(`Migration selection field ${key} must be boolean.`);
    if (record[key] !== undefined) result[key] = record[key] as boolean;
  }
  return result;
}

type DesignItemRow = {
  collection: string;
  uuid: string;
  created_at: string;
  updated_at: string;
  title: string;
  model: string;
  data_json: string;
  messages_json: string;
};

type DesignFileRow = {
  project_id: string;
  path: string;
  created_at: string;
  updated_at: string;
  content_type: string;
  body_base64: string;
  version: number;
};

const EXCLUDED = {
  requestLogs: "Request logs, request headers, request bodies, and response bodies are never migrated.",
  cachedHostedAssets: "Cached hosted assets and proxy responses are never migrated.",
  browserState: "Browser state and cookies are never migrated.",
  gatewayConfiguration: "Gateway configuration, gateway keys, and provider credentials are never migrated.",
  oauthData: "OAuth data, account identity, entitlements, and mock identity are never migrated.",
  telemetry: "Telemetry and analytics data are never migrated."
} as const;

const EMPTY_EXCLUSION_COUNTS = {
  requestLogs: 0,
  cachedHostedAssets: 0,
  browserState: 0,
  gatewayConfiguration: 0,
  oauthData: 0,
  telemetry: 0
};

export function defaultClaudeDesignMigrationDbFile(): string {
  return CLAUDE_DESIGN_PLUGIN_DB_FILE;
}

export function inspectClaudeDesignMigration(
  selection: ClaudeDesignMigrationSelection = {},
  options: { sourceDbFile?: string; sourceProductVersion?: string; sourceCommit?: string } = {}
): ClaudeDesignMigrationPreflight {
  const sourceDbFile = path.resolve(options.sourceDbFile || defaultClaudeDesignMigrationDbFile());
  if (!existsSync(sourceDbFile) || !statSync(sourceDbFile).isFile()) {
    return {
      available: false,
      counts: emptyCounts(),
      exclusions: { ...EXCLUDED },
      issues: [`Legacy Claude Design database was not found at ${sourceDbFile}.`],
      exclusionCounts: { ...EMPTY_EXCLUSION_COUNTS },
      projects: [],
      selectedProjectIds: normalizeProjectIds(selection.projectIds),
      sourceDbFile
    };
  }

  let database: BetterSqliteDatabase | undefined;
  try {
    database = createBetterSqliteDatabase(sourceDbFile, { fileMustExist: true, readonly: true });
    const snapshot = readSnapshot(database, selection);
    const sourceDbSha256 = sha256(readFileSync(sourceDbFile));
    return {
      available: true,
      counts: snapshot.counts,
      exclusions: { ...EXCLUDED },
      idempotencyKey: createIdempotencyKey(sourceDbSha256, selection),
      issues: [],
      exclusionCounts: snapshot.exclusionCounts,
      projects: snapshot.projectSummaries,
      selectedProjectIds: snapshot.projectIds,
      sourceDbFile,
      sourceDbSha256
    };
  } catch (error) {
    return {
      available: false,
      counts: emptyCounts(),
      exclusions: { ...EXCLUDED },
      issues: [`Legacy Claude Design database could not be inspected: ${formatError(error)}`],
      exclusionCounts: { ...EMPTY_EXCLUSION_COUNTS },
      projects: [],
      selectedProjectIds: normalizeProjectIds(selection.projectIds),
      sourceDbFile
    };
  } finally {
    database?.close();
  }
}

export function exportClaudeDesignMigration(
  targetFile: string,
  selection: ClaudeDesignMigrationSelection = {},
  options: { sourceDbFile?: string; sourceProductVersion?: string; sourceCommit?: string; exportTimestamp?: string } = {}
): ClaudeDesignMigrationExportResult {
  const sourceDbFile = path.resolve(options.sourceDbFile || defaultClaudeDesignMigrationDbFile());
  if (!existsSync(sourceDbFile) || !statSync(sourceDbFile).isFile()) {
    throw new Error(`Legacy Claude Design database was not found at ${sourceDbFile}.`);
  }

  const sourceBytes = readFileSync(sourceDbFile);
  const sourceDbSha256 = sha256(sourceBytes);
  const normalizedSelection = normalizeSelection(selection);
  const idempotencyKey = createIdempotencyKey(sourceDbSha256, normalizedSelection);
  const exportedAt = options.exportTimestamp || new Date().toISOString();
  const sourceProductVersion = options.sourceProductVersion || "unknown";
  const sourceCommit = options.sourceCommit || CLAUDE_DESIGN_SOURCE_COMMIT;

  let database: BetterSqliteDatabase | undefined;
  try {
    database = createBetterSqliteDatabase(sourceDbFile, { fileMustExist: true, readonly: true });
    const snapshot = readSnapshot(database, normalizedSelection);
    const entries: ZipEntry[] = [];
    const fileHashes: Record<string, string> = {};
    const addJson = (archivePath: string, value: unknown): void => addEntry(entries, fileHashes, archivePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));

    for (const row of snapshot.projects) {
      const item = safeItem(row, normalizedSelection.includeConversations);
      const recordPath = projectType(row) === 2
        ? `templates/${encodePathSegment(row.uuid)}/template.json`
        : `projects/${encodePathSegment(row.uuid)}/project.json`;
      addJson(recordPath, item);
      addJson(`projects/${encodePathSegment(row.uuid)}/metadata/timestamps.json`, { createdAt: row.created_at, updatedAt: row.updated_at });
    }
    if (normalizedSelection.includeDesignSystems) {
      for (const row of snapshot.designSystems) addJson(`design-systems/${encodePathSegment(row.uuid)}/design-system.json`, safeItem(row, false));
    }
    if (normalizedSelection.includeComments) {
      for (const row of snapshot.comments) {
        const comment = safeItem(row, false);
        addJson(`projects/${encodePathSegment(itemProjectId(row))}/comments/${encodePathSegment(row.uuid)}.json`, comment);
        const replies = Array.isArray(parseJsonRecord(row.data_json).replies) ? parseJsonRecord(row.data_json).replies : [];
        replies.forEach((reply, index) => addJson(`projects/${encodePathSegment(itemProjectId(row))}/comments/${encodePathSegment(row.uuid)}/replies/${index + 1}.json`, reply));
      }
    }
    if (normalizedSelection.includeConversations) {
      for (const row of snapshot.projects) {
        addJson(`projects/${encodePathSegment(row.uuid)}/conversations/default.json`, { projectId: row.uuid, createdAt: row.created_at, updatedAt: row.updated_at, messages: parseJsonArray(row.messages_json) });
      }
    }
    if (normalizedSelection.includeThumbnails) {
      for (const row of snapshot.thumbnails) {
        const body = decodeBase64(row.data.body_base64, `thumbnail ${row.uuid}`);
        const extension = extensionForContentType(row.data.content_type);
        const archivePath = `projects/${encodePathSegment(row.uuid)}/thumbnails/default${extension}`;
        addEntry(entries, fileHashes, archivePath, body);
        addJson(`projects/${encodePathSegment(row.uuid)}/metadata/thumbnail.json`, {
          projectId: row.uuid,
          contentType: row.data.content_type,
          archivePath
        });
      }
    }
    const fileRecords = snapshot.files.map((row) => {
      const body = decodeBase64(row.body_base64, `file ${row.project_id}/${row.path}`);
      const archivePath = `projects/${encodePathSegment(row.project_id)}/files/${encodePath(row.path)}`;
      addEntry(entries, fileHashes, archivePath, body);
      return { path: row.path, contentType: row.content_type, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, archivePath, sha256: sha256(body), bytes: body.length };
    });
    addEntry(entries, fileHashes, "metadata/files.jsonl", Buffer.from(fileRecords.map((row) => JSON.stringify(row)).join("\n") + (fileRecords.length ? "\n" : ""), "utf8"));

    const manifest: ClaudeDesignMigrationManifest = {
      format: CLAUDE_DESIGN_MIGRATION_SCHEMA,
      schemaVersion: 1,
      sourceProductVersion,
      sourceCommit,
      sourceDatabaseSha256: sourceDbSha256,
      exportedAt,
      idempotencyKey,
      recordCounts: snapshot.counts,
      exclusionCounts: snapshot.exclusionCounts,
      fileHashes
    };
    addJson("manifest.json", manifest);

    if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`Migration archive has too many entries (${entries.length}).`);
    const archive = createZip(entries);
    if (archive.length > MAX_ARCHIVE_BYTES) throw new Error(`Migration archive exceeds the ${MAX_ARCHIVE_BYTES} byte limit.`);
    writeAtomic(targetFile, archive);
    return { canceled: false, file: path.resolve(targetFile), manifest };
  } finally {
    database?.close();
  }
}

function readSnapshot(database: BetterSqliteDatabase, selection: ClaudeDesignMigrationSelection) {
  const rows = database.prepare("SELECT collection, uuid, created_at, updated_at, title, model, data_json, messages_json FROM claude_design_items ORDER BY collection, uuid").all() as DesignItemRow[];
  const requested = normalizeProjectIds(selection.projectIds);
  const projectRows = rows.filter((row) => row.collection === "projects");
  const projectIds = requested.length ? requested.filter((id) => projectRows.some((row) => row.uuid === id)) : projectRows.map((row) => row.uuid);
  if (projectIds.length > MAX_PROJECTS) throw new Error(`Migration selection exceeds the ${MAX_PROJECTS} project limit.`);
  const selected = new Set(projectIds);
  const projects = projectRows.filter((row) => selected.has(row.uuid) && (selection.includeTemplates !== false || projectType(row) !== 2));
  const itemForProject = (collection: string) => rows.filter((row) => row.collection === collection && selected.has(itemProjectId(row)));
  const designSystems = selection.includeDesignSystems !== false ? itemForProject("design_systems") : [];
  const comments = selection.includeComments !== false ? itemForProject("comments") : [];
  const thumbnails = selection.includeThumbnails !== false ? rows.filter((row) => row.collection === "thumbnails" && selected.has(row.uuid)).map((row) => ({ ...row, data: parseJsonRecord(row.data_json) })) : [];
  const files = database.prepare("SELECT project_id, path, created_at, updated_at, content_type, body_base64, version FROM claude_design_files ORDER BY project_id, path").all() as DesignFileRow[];
  const selectedFiles = files.filter((row) => selected.has(row.project_id));
  if (selectedFiles.length > projectIds.length * MAX_FILES_PER_PROJECT) throw new Error(`Migration selection exceeds the ${MAX_FILES_PER_PROJECT} files per-project limit.`);
  for (const file of selectedFiles) {
    const bytes = Buffer.byteLength(file.body_base64 || "", "base64");
    if (bytes > MAX_FILE_BYTES) throw new Error(`Migration file ${file.project_id}/${file.path} exceeds the ${MAX_FILE_BYTES} byte limit.`);
  }
  const projectSummaries = projects.map((row) => {
    const data = parseJsonRecord(row.data_json);
    return {
      id: row.uuid,
      name: row.title,
      ownerKey: typeof data.ownerKey === "string" ? data.ownerKey : typeof data.owner_key === "string" ? data.owner_key : null,
      type: projectType(row) === 2 ? "template" as const : "project" as const,
      fileCount: selectedFiles.filter((file) => file.project_id === row.uuid).length
    };
  });
  const replies = comments.reduce((total, row) => {
    const data = parseJsonRecord(row.data_json);
    return total + (Array.isArray(data.replies) ? data.replies.length : 0);
  }, 0);
  return {
    comments,
    counts: {
      projects: projects.length,
      templates: projects.filter((row) => projectType(row) === 2).length,
      designSystems: designSystems.length,
      files: selectedFiles.length,
      conversations: selection.includeConversations !== false ? projects.filter((row) => parseJsonArray(row.messages_json).length > 0).length : 0,
      comments: comments.length,
      thumbnails: thumbnails.length,
      replies,
      timestamps: projects.length,
      metadata: projects.length
    } satisfies ClaudeDesignMigrationCounts,
    designSystems,
    files: selectedFiles,
    projectIds,
    projects,
    projectSummaries,
    exclusionCounts: countExcluded(database),
    thumbnails
  };
}

function normalizeSelection(selection: ClaudeDesignMigrationSelection): ClaudeDesignMigrationSelection {
  return {
    ...(normalizeProjectIds(selection.projectIds).length ? { projectIds: normalizeProjectIds(selection.projectIds) } : {}),
    includeComments: selection.includeComments !== false,
    includeConversations: selection.includeConversations !== false,
    includeDesignSystems: selection.includeDesignSystems !== false,
    includeTemplates: selection.includeTemplates !== false,
    includeThumbnails: selection.includeThumbnails !== false
  };
}

function normalizeProjectIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && /^[A-Za-z0-9._-]{1,160}$/.test(value.trim())).map((value) => value.trim()))];
}

function itemProjectId(row: DesignItemRow): string {
  const data = parseJsonRecord(row.data_json);
  return typeof data.project_id === "string" ? data.project_id : row.collection === "thumbnails" ? row.uuid : "";
}

function projectType(row: DesignItemRow): number {
  const data = parseJsonRecord(row.data_json);
  return typeof data.type === "number" ? data.type : typeof data.project_type === "number" ? data.project_type : 1;
}

function safeItem(row: DesignItemRow, includeMessages: boolean | undefined): Record<string, unknown> {
  const data = parseJsonRecord(row.data_json);
  const ownerKey = typeof data.ownerKey === "string" ? data.ownerKey : typeof data.owner_key === "string" ? data.owner_key : null;
  const members = Array.isArray(data.members) ? data.members.filter((member): member is string => typeof member === "string") : [];
  return {
    id: row.uuid,
    legacyId: row.uuid,
    name: row.title,
    ownerKey,
    members,
    description: typeof data.description === "string" ? data.description : "",
    type: projectType(row),
    data,
    collection: row.collection,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: includeMessages ? parseJsonArray(row.messages_json) : []
  };
}

function parseJsonRecord(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object expected");
    return parsed as Record<string, any>;
  } catch (error) {
    throw new Error(`Invalid source JSON object: ${formatError(error)}`);
  }
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("array expected");
    return parsed;
  } catch (error) {
    throw new Error(`Invalid source JSON array: ${formatError(error)}`);
  }
}

function decodeBase64(value: string, label: string): Buffer {
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error(`Invalid base64 in ${label}.`);
  const body = Buffer.from(value, "base64");
  if (body.length > MAX_FILE_BYTES) throw new Error(`${label} exceeds the ${MAX_FILE_BYTES} byte limit.`);
  return body;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, "%252F");
}

function encodePath(value: string): string {
  if (/^(?:[A-Za-z]:|[\\/]{1,2})/.test(value)) throw new Error(`Unsafe project file path: ${value}`);
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`Unsafe project file path: ${value}`);
  if (!parts.length || parts.length > 40) throw new Error(`Unsafe project file path: ${value}`);
  return parts.map(encodePathSegment).join("/");
}

function extensionForContentType(value: unknown): string {
  const type = typeof value === "string" ? value.toLowerCase() : "";
  return type.includes("jpeg") ? ".jpg" : type.includes("webp") ? ".webp" : type.includes("gif") ? ".gif" : type.includes("png") ? ".png" : ".bin";
}

function createIdempotencyKey(sourceHash: string, selection: ClaudeDesignMigrationSelection): string {
  return sha256(Buffer.from(`${CLAUDE_DESIGN_MIGRATION_SCHEMA}\n${sourceHash}\n${JSON.stringify(normalizeSelection(selection))}`, "utf8"));
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function emptyCounts(): ClaudeDesignMigrationCounts {
  return { comments: 0, conversations: 0, designSystems: 0, files: 0, projects: 0, templates: 0, thumbnails: 0, replies: 0, timestamps: 0, metadata: 0 };
}

function countExcluded(database: BetterSqliteDatabase): Record<string, number> {
  const count = (table: string): number => {
    const present = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table);
    if (!present) return 0;
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number | bigint };
    return Number(row?.count || 0);
  };
  return {
    ...EMPTY_EXCLUSION_COUNTS,
    requestLogs: count("claude_design_requests"),
    cachedHostedAssets: count("claude_design_assets") + count("claude_design_responses"),
    telemetry: count("events")
  };
}

type ZipEntry = { name: string; body: Buffer };

function addEntry(entries: ZipEntry[], fileHashes: Record<string, string>, name: string, body: Buffer): void {
  if (entries.some((entry) => entry.name === name)) throw new Error(`Duplicate migration archive entry: ${name}`);
  entries.push({ name, body });
  fileHashes[name] = sha256(body);
}

function createZip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(crc32(entry.body), 14);
    header.writeUInt32LE(entry.body.length, 18);
    header.writeUInt32LE(entry.body.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, entry.body);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc32(entry.body), 16);
    centralHeader.writeUInt32LE(entry.body.length, 20);
    centralHeader.writeUInt32LE(entry.body.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += header.length + name.length + entry.body.length;
  }
  const centralBody = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBody.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBody, end]);
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeAtomic(targetFile: string, body: Buffer): void {
  const resolved = path.resolve(targetFile);
  const temp = `${resolved}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, body, { flag: "wx", mode: 0o600 });
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        renameSync(temp, resolved);
        return;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException)?.code;
        if (!code || !["EPERM", "EACCES", "EBUSY"].includes(code)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Migration archive rename failed.");
  } finally {
    try { unlinkSync(temp); } catch { /* already renamed */ }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
