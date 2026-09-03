import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./atomic";
import {
  cloneDatabaseState,
  EMPTY_DATABASE_STATE,
  type DatabaseState
} from "../../project-domain/src/model";

export const DATABASE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS account_slots (slot_id TEXT PRIMARY KEY, label TEXT NOT NULL, email TEXT, plan_type TEXT, state TEXT NOT NULL, last_verified_at TEXT, app_server_version TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, owner_slot_id TEXT NOT NULL REFERENCES account_slots(slot_id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL, archived_at TEXT, settings_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_grants (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, slot_id TEXT NOT NULL REFERENCES account_slots(slot_id) ON DELETE CASCADE, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id, slot_id));
CREATE TABLE IF NOT EXISTS project_files (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, path TEXT NOT NULL, content TEXT NOT NULL, content_type TEXT NOT NULL, byte_length INTEGER NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, PRIMARY KEY(project_id, path));
CREATE TABLE IF NOT EXISTS design_systems (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL, tokens_json TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL, archived_at TEXT);
CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS account_thread_bindings (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, slot_id TEXT NOT NULL REFERENCES account_slots(slot_id), thread_id TEXT NOT NULL, transcript_injected INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id, chat_id, slot_id));
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, file_path TEXT, anchor_json TEXT, author_slot_id TEXT NOT NULL REFERENCES account_slots(slot_id), body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS migration_receipts (idempotency_key TEXT PRIMARY KEY, source_fingerprint TEXT NOT NULL, imported_at TEXT NOT NULL, payload_json TEXT NOT NULL);
`;

export type StateMutation = (state: DatabaseState) => void | Promise<void>;

export class ProjectDatabase {
  readonly metadataPath: string;
  readonly walPath: string;
  private state: DatabaseState = cloneDatabaseState(EMPTY_DATABASE_STATE);
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly dataRoot: string) {
    this.metadataPath = path.join(dataRoot, "metadata.json");
    this.walPath = path.join(dataRoot, "metadata.wal");
  }

  async open(): Promise<void> {
    if (this.loaded) return;
    await mkdir(this.dataRoot, { recursive: true });
    const metadata = await this.readJson(this.metadataPath);
    const journal = await this.readJson(this.walPath);
    if (journal && typeof journal === "object" && "state" in journal) {
      this.state = journal.state as DatabaseState;
      await writeFileAtomic(this.metadataPath, JSON.stringify(this.state));
      await writeFileAtomic(this.walPath, "");
    } else if (metadata && typeof metadata === "object") {
      this.state = { ...cloneDatabaseState(EMPTY_DATABASE_STATE), ...(metadata as DatabaseState) };
    }
    this.loaded = true;
  }

  async read(): Promise<DatabaseState> {
    await this.open();
    return cloneDatabaseState(this.state);
  }

  async transaction(mutation: StateMutation): Promise<DatabaseState> {
    await this.open();
    let resolveDone!: () => void;
    const prior = this.queue;
    this.queue = new Promise<void>((resolve) => { resolveDone = resolve; });
    await prior;
    try {
      const next = cloneDatabaseState(this.state);
      await mutation(next);
      await writeFileAtomic(this.walPath, JSON.stringify({ version: 1, state: next }));
      await writeFileAtomic(this.metadataPath, JSON.stringify(next));
      await writeFileAtomic(this.walPath, "");
      this.state = next;
      return cloneDatabaseState(next);
    } finally {
      resolveDone();
    }
  }

  private async readJson(file: string): Promise<unknown> {
    try {
      const content = await readFile(file, "utf8");
      if (!content.trim()) return undefined;
      return JSON.parse(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}

