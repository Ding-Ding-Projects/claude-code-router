import { createHash, randomUUID } from "node:crypto";
import { DomainError, ProjectDomainService } from "../../project-domain/src/index";
import { nowIso, type MigrationReceipt, type ProjectFile } from "../../project-domain/src/model";

export const MIGRATION_FORMAT = "claude-design-desktop-import-v1";
export const SOURCE_COMMIT = "4a3c267e7e22f6636a02542554309cd49cd41e9d";
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_ENTRY_BYTES = 50_000_000;
const MAX_TOTAL_BYTES = 2_000_000_000;
const FORBIDDEN_ENTRY = /(^|\/)(request-logs?|headers?|responses?|proxy|cached-assets?|browser-state|gateway|oauth|telemetry|credentials?)(\/|\.|$)/i;

export type ArchiveEntry = { name: string; bytes: Uint8Array; symlink?: boolean; reparsePoint?: boolean };
export type ImportManifest = {
  format: typeof MIGRATION_FORMAT;
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
export type MigrationArchive = { entries: AsyncIterable<ArchiveEntry> | Iterable<ArchiveEntry>; manifest: ImportManifest };
export type MigrationPreflight = {
  format: typeof MIGRATION_FORMAT;
  sourceFingerprint: string;
  manifest: ImportManifest;
  projects: Array<{ legacyId: string; name: string; ownerKey: string | null; fileCount: number }>;
  members: string[];
  excluded: Array<{ name: string; reason: string }>;
  errors: string[];
  totalBytes: number;
};
export type OwnerMapping = Record<string, string | null>;

export async function inspectMigrationArchive(archive: MigrationArchive): Promise<MigrationPreflight> {
  const entries = await collectAndValidateEntries(archive);
  const errors = [...entries.errors];
  const projects: MigrationPreflight["projects"] = [];
  const members = new Set<string>();
  const excluded: MigrationPreflight["excluded"] = entries.excluded;
  const projectById = new Map<string, { legacyId: string; name: string; ownerKey: string | null; fileCount: number }>();
  for (const entry of entries.safeEntries) {
    const parts = entry.name.split("/");
    if (parts[0] !== "projects" || parts.length < 3) continue;
    const legacyId = parts[1];
    const row = projectById.get(legacyId) || { legacyId, name: legacyId, ownerKey: null, fileCount: 0 };
    if (parts[2] === "project.json") {
      try {
        const project = JSON.parse(Buffer.from(entry.bytes).toString("utf8")) as { name?: unknown; ownerKey?: unknown; members?: unknown };
        if (typeof project.name === "string") row.name = project.name;
        if (typeof project.ownerKey === "string") { row.ownerKey = project.ownerKey; members.add(project.ownerKey); }
        if (Array.isArray(project.members)) for (const member of project.members) if (typeof member === "string") members.add(member);
      } catch { errors.push(`Invalid JSON in ${entry.name}.`); }
    } else if (parts[2] === "files") {
      row.fileCount += 1;
    }
    projectById.set(legacyId, row);
  }
  projects.push(...projectById.values());
  if (archive.manifest.format !== MIGRATION_FORMAT) errors.push(`Unsupported archive format: ${archive.manifest.format}.`);
  if (archive.manifest.schemaVersion !== 1) errors.push(`Unsupported archive schema version: ${archive.manifest.schemaVersion}.`);
  return { format: MIGRATION_FORMAT, sourceFingerprint: fingerprint(archive.manifest), manifest: archive.manifest, projects, members: [...members], excluded, errors, totalBytes: entries.totalBytes };
}

export async function importMigrationArchive(
  service: ProjectDomainService,
  archive: MigrationArchive,
  mapping: OwnerMapping,
  options: { idempotencyKey: string; allowUnresolvedOwners?: boolean }
): Promise<MigrationReceipt> {
  const preflight = await inspectMigrationArchive(archive);
  if (preflight.errors.length) throw new DomainError("MIGRATION_INVALID", preflight.errors.join(" "));
  if (options.idempotencyKey !== archive.manifest.idempotencyKey) throw new DomainError("MIGRATION_IDEMPOTENCY_KEY", "The idempotency key does not match the manifest.");
  const entries = (await collectAndValidateEntries(archive)).safeEntries;
  const sourceFingerprint = preflight.sourceFingerprint;
  const existing = (await service.databaseState()).receipts.find((receipt) => receipt.idempotencyKey === options.idempotencyKey);
  if (existing) {
    if (existing.sourceFingerprint !== sourceFingerprint) throw new DomainError("MIGRATION_IDEMPOTENCY_CONFLICT", "The idempotency key was used for another archive.");
    return existing;
  }

  const accounts = await service.listAccounts();
  const resolveOwner = (key: string | null): string | null => {
    const slot = key ? mapping[key] : null;
    if (slot && accounts.some((account) => account.slotId === slot)) return slot;
    return null;
  };
  const unresolved = preflight.projects.filter((project) => !resolveOwner(project.ownerKey));
  if (unresolved.length && !options.allowUnresolvedOwners) throw new DomainError("MIGRATION_OWNER_MAPPING", `Missing account mapping for ${unresolved.length} project owner(s).`);

  const projectIdMap: Record<string, string> = {};
  let fileCount = 0;
  for (const project of preflight.projects) {
    const ownerSlotId = resolveOwner(project.ownerKey);
    if (!ownerSlotId) continue;
    const requestedId = safeLegacyId(project.legacyId);
    let id = requestedId;
    if ((await service.listProjects(ownerSlotId, true)).some((candidate) => candidate.id === id)) id = `import_${randomUUID()}`;
    const created = await service.createProject({ id, name: project.name, ownerSlotId, description: "Imported project" });
    projectIdMap[project.legacyId] = created.id;
    for (const entry of entries) {
      const prefix = `projects/${project.legacyId}/files/`;
      if (!entry.name.startsWith(prefix)) continue;
      const relativePath = entry.name.slice(prefix.length);
      if (!relativePath) continue;
      const content = Buffer.from(entry.bytes).toString("utf8");
      await service.writeFile({ projectId: created.id, actorSlotId: ownerSlotId, path: relativePath, content, contentType: "text/plain" });
      fileCount += 1;
    }
  }
  const receipt: MigrationReceipt = {
    idempotencyKey: options.idempotencyKey,
    sourceFingerprint,
    sourceProductVersion: archive.manifest.sourceProductVersion,
    sourceCommit: archive.manifest.sourceCommit,
    importedAt: nowIso(),
    projectCount: Object.keys(projectIdMap).length,
    fileCount,
    unresolvedOwnerCount: unresolved.length,
    projectIdMap,
    excludedCounts: archive.manifest.exclusionCounts
  };
  await service.addMigrationReceipt(receipt);
  return receipt;
}

async function collectAndValidateEntries(archive: MigrationArchive): Promise<{ safeEntries: ArchiveEntry[]; excluded: MigrationPreflight["excluded"]; errors: string[]; totalBytes: number }> {
  const safeEntries: ArchiveEntry[] = [];
  const excluded: MigrationPreflight["excluded"] = [];
  const errors: string[] = [];
  const names = new Set<string>();
  let totalBytes = 0;
  for await (const entry of archive.entries) {
    const name = entry.name.replaceAll("\\", "/");
    if (!name || name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.split("/").some((part) => part === ".." || part === "")) {
      errors.push(`Unsafe archive path: ${entry.name}.`); continue;
    }
    if (names.has(name)) { errors.push(`Duplicate archive path: ${name}.`); continue; }
    names.add(name);
    if (entry.symlink || entry.reparsePoint) { errors.push(`Links are not accepted: ${name}.`); continue; }
    if (entry.bytes.byteLength > MAX_ENTRY_BYTES) { errors.push(`Archive entry is too large: ${name}.`); continue; }
    totalBytes += entry.bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) { errors.push("Archive exceeds the total byte limit."); continue; }
    if (FORBIDDEN_ENTRY.test(name)) { excluded.push({ name, reason: "secret, browser, gateway, request-log, cache, or telemetry data is never imported" }); continue; }
    if (name === "manifest.json" && entry.bytes.byteLength > MAX_MANIFEST_BYTES) errors.push("The manifest is too large.");
    safeEntries.push({ ...entry, name });
  }
  return { safeEntries, excluded, errors, totalBytes };
}

function fingerprint(manifest: ImportManifest): string {
  return createHash("sha256").update(JSON.stringify({ format: manifest.format, schemaVersion: manifest.schemaVersion, sourceDatabaseSha256: manifest.sourceDatabaseSha256, idempotencyKey: manifest.idempotencyKey, fileHashes: manifest.fileHashes })).digest("hex");
}

function safeLegacyId(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^[-.]+/, "").slice(0, 100);
  return cleaned || `import_${randomUUID()}`;
}
