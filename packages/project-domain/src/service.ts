import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertSafeProjectIdentifier,
  LocalGitHistory,
  ProjectDatabase,
  safeProjectPath,
  writeFileAtomic
} from "../../project-storage/src/index";
import {
  newId,
  nowIso,
  type AccountSlotRecord,
  type AccountSlotState,
  type AccountThreadBinding,
  type AppSetting,
  type BackgroundOperation,
  type ChatMessage,
  type ChatRecord,
  type CommentRecord,
  type CommentReply,
  type DatabaseState,
  type DesignSystemRecord,
  type MigrationReceipt,
  type PreviewRecord,
  type ProjectFile,
  type ProjectGrant,
  type ProjectRecord,
  type ProjectRole,
  type ProjectSnapshot,
  type ProjectSummary
} from "./model";

export class DomainError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export type CreateProjectInput = { id?: string; name: string; description?: string; ownerSlotId: string; settings?: Record<string, unknown> };
export type UpdateProjectInput = { projectId: string; actorSlotId: string; expectedVersion: number; name?: string; description?: string; settings?: Record<string, unknown> };
export type WriteFileInput = { projectId: string; actorSlotId: string; path: string; content: string; contentType?: string; expectedVersion?: number };
export type CopyFileInput = { projectId: string; actorSlotId: string; sourcePath: string; destinationPath: string; expectedVersion?: number };
export type DeleteFileInput = { projectId: string; actorSlotId: string; path: string; expectedVersion?: number };

const ROLE_ORDER: Record<ProjectRole, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
const WRITE_ROLES = new Set<ProjectRole>(["owner", "editor"]);
const COMMENT_ROLES = new Set<ProjectRole>(["owner", "editor", "commenter"]);

export class ProjectDomainService {
  readonly projectsRoot: string;
  private readonly db: ProjectDatabase;
  private readonly history: LocalGitHistory;

  constructor(readonly dataRoot: string) {
    this.projectsRoot = path.join(dataRoot, "projects");
    this.db = new ProjectDatabase(dataRoot);
    this.history = new LocalGitHistory(path.join(dataRoot, "history"));
  }

  async open(): Promise<void> {
    await mkdir(this.projectsRoot, { recursive: true });
    await this.db.open();
  }

  async listAccounts(): Promise<AccountSlotRecord[]> {
    return (await this.db.read()).accounts;
  }

  /** Snapshot used by migration preflight and external adapters. */
  async databaseState(): Promise<DatabaseState> {
    return this.db.read();
  }

  async upsertAccount(input: { slotId?: string; label: string; email?: string | null; planType?: string | null; state?: AccountSlotState; appServerVersion?: string | null }): Promise<AccountSlotRecord> {
    const label = boundedText(input.label, "label", 120);
    const slotId = input.slotId ? assertSafeProjectIdentifier(input.slotId, "slotId") : newId("slot");
    const timestamp = nowIso();
    let account!: AccountSlotRecord;
    await this.db.transaction((state) => {
      const existing = state.accounts.find((candidate) => candidate.slotId === slotId);
      account = existing || {
        slotId, label, email: null, planType: null, state: "signedOut", lastVerifiedAt: null,
        appServerVersion: null, createdAt: timestamp, updatedAt: timestamp
      };
      account = {
        ...account,
        label,
        email: input.email === undefined ? account.email : nullableText(input.email, "email", 320),
        planType: input.planType === undefined ? account.planType : nullableText(input.planType, "planType", 80),
        state: input.state || account.state,
        appServerVersion: input.appServerVersion === undefined ? account.appServerVersion : nullableText(input.appServerVersion, "appServerVersion", 80),
        updatedAt: timestamp
      };
      if (!existing) state.accounts.push(account);
      else state.accounts[state.accounts.indexOf(existing)] = account;
    });
    return account;
  }

  async updateAccountState(slotId: string, state: AccountSlotState, verified = false): Promise<AccountSlotRecord> {
    let account!: AccountSlotRecord;
    await this.db.transaction((db) => {
      const existing = db.accounts.find((candidate) => candidate.slotId === slotId);
      if (!existing) throw new DomainError("ACCOUNT_NOT_FOUND", "The account slot does not exist.");
      account = { ...existing, state, lastVerifiedAt: verified ? nowIso() : existing.lastVerifiedAt, updatedAt: nowIso() };
      db.accounts[db.accounts.indexOf(existing)] = account;
    });
    return account;
  }

  async listProjects(slotId: string, includeArchived = false): Promise<ProjectSummary[]> {
    const state = await this.db.read();
    return state.projects
      .filter((project) => includeArchived || !project.archivedAt)
      .map((project) => ({ project, role: roleFor(state, project, slotId) }))
      .filter((entry): entry is { project: ProjectRecord; role: ProjectRole } => entry.role !== undefined)
      .map(({ project, role }) => ({ ...project, role }));
  }

  async createProject(input: CreateProjectInput): Promise<ProjectSummary> {
    const name = boundedText(input.name, "name", 200);
    const description = boundedText(input.description || "", "description", 10_000);
    assertAccountId(input.ownerSlotId);
    const id = input.id ? assertSafeProjectIdentifier(input.id, "project id") : newId("project");
    const timestamp = nowIso();
    const project: ProjectRecord = { id, name, description, ownerSlotId: input.ownerSlotId, createdAt: timestamp, updatedAt: timestamp, version: 1, archivedAt: null, settings: input.settings || {} };
    await this.db.transaction((state) => {
      if (state.accounts.every((account) => account.slotId !== input.ownerSlotId)) throw new DomainError("ACCOUNT_NOT_FOUND", "The owner account slot does not exist.");
      if (state.projects.some((candidate) => candidate.id === id)) throw new DomainError("PROJECT_EXISTS", "The project id is already in use.");
      state.projects.push(project);
    });
    await mkdir(this.workspacePath(id), { recursive: true });
    await this.recordHistory(project, "created", `Created project ${name}`);
    return { ...project, role: "owner" };
  }

  async getProject(projectId: string, slotId: string): Promise<ProjectSnapshot> {
    const state = await this.db.read();
    const project = this.requireProject(state, projectId, slotId, "viewer");
    return {
      project: { ...project, role: roleFor(state, project, slotId)! },
      files: state.files.filter((file) => file.projectId === projectId && !file.deletedAt),
      designSystems: state.designSystems.filter((record) => record.projectId === projectId || record.projectId === null),
      chats: state.chats.filter((chat) => chat.projectId === projectId && !chat.archivedAt),
      messages: state.messages.filter((message) => state.chats.some((chat) => chat.id === message.chatId && chat.projectId === projectId)),
      comments: state.comments.filter((comment) => comment.projectId === projectId),
      replies: state.replies.filter((reply) => state.comments.some((comment) => comment.id === reply.commentId && comment.projectId === projectId)),
      previews: state.previews.filter((preview) => preview.projectId === projectId && new Date(preview.expiresAt).getTime() > Date.now())
    };
  }

  async updateProject(input: UpdateProjectInput): Promise<ProjectSummary> {
    let updated!: ProjectRecord;
    await this.db.transaction((state) => {
      const project = this.requireProject(state, input.projectId, input.actorSlotId, "editor");
      if (project.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", `Project version ${project.version} does not match expected version ${input.expectedVersion}.`);
      updated = { ...project, name: input.name === undefined ? project.name : boundedText(input.name, "name", 200), description: input.description === undefined ? project.description : boundedText(input.description, "description", 10_000), settings: input.settings === undefined ? project.settings : input.settings, version: project.version + 1, updatedAt: nowIso() };
      state.projects[state.projects.indexOf(project)] = updated;
    });
    await this.recordHistory(updated, "updated", `Updated project ${updated.name}`);
    return { ...updated, role: (await this.role(updated.id, input.actorSlotId))! };
  }

  async setGrant(input: { projectId: string; actorSlotId: string; slotId: string; role: Exclude<ProjectRole, "owner"> }): Promise<ProjectGrant> {
    let grant!: ProjectGrant;
    await this.db.transaction((state) => {
      const project = this.requireProject(state, input.projectId, input.actorSlotId, "owner");
      if (!state.accounts.some((account) => account.slotId === input.slotId)) throw new DomainError("ACCOUNT_NOT_FOUND", "The grantee account slot does not exist.");
      if (input.slotId === project.ownerSlotId) throw new DomainError("INVALID_GRANT", "The owner does not need a grant.");
      const timestamp = nowIso();
      const current = state.grants.find((candidate) => candidate.projectId === input.projectId && candidate.slotId === input.slotId);
      grant = current ? { ...current, role: input.role, updatedAt: timestamp } : { projectId: input.projectId, slotId: input.slotId, role: input.role, createdAt: timestamp, updatedAt: timestamp };
      if (current) state.grants[state.grants.indexOf(current)] = grant; else state.grants.push(grant);
    });
    return grant;
  }

  async revokeGrant(projectId: string, actorSlotId: string, slotId: string): Promise<void> {
    await this.db.transaction((state) => {
      this.requireProject(state, projectId, actorSlotId, "owner");
      state.grants = state.grants.filter((grant) => !(grant.projectId === projectId && grant.slotId === slotId));
    });
  }

  async transferOwnership(projectId: string, actorSlotId: string, destinationSlotId: string): Promise<ProjectSummary> {
    let project!: ProjectRecord;
    await this.db.transaction((state) => {
      project = this.requireProject(state, projectId, actorSlotId, "owner");
      if (!state.accounts.some((account) => account.slotId === destinationSlotId)) throw new DomainError("ACCOUNT_NOT_FOUND", "The destination account slot does not exist.");
      if (destinationSlotId === project.ownerSlotId) return;
      const oldOwner = project.ownerSlotId;
      project = { ...project, ownerSlotId: destinationSlotId, version: project.version + 1, updatedAt: nowIso() };
      state.projects[state.projects.findIndex((candidate) => candidate.id === projectId)] = project;
      state.grants = state.grants.filter((grant) => !(grant.projectId === projectId && grant.slotId === destinationSlotId));
      state.grants.push({ projectId, slotId: oldOwner, role: "editor", createdAt: nowIso(), updatedAt: nowIso() });
    });
    await this.recordHistory(project, "ownership-transferred", `Transferred project ownership for ${project.name}`);
    return { ...project, role: "editor" };
  }

  async accountRemovalImpact(slotId: string): Promise<{ ownedProjects: ProjectSummary[]; sharedProjects: ProjectSummary[]; canRemove: boolean }> {
    const owned = (await this.listProjects(slotId, true)).filter((project) => project.ownerSlotId === slotId);
    const shared = (await this.listProjects(slotId, true)).filter((project) => project.ownerSlotId !== slotId);
    return { ownedProjects: owned, sharedProjects: shared, canRemove: owned.length === 0 };
  }

  async removeAccount(slotId: string): Promise<void> {
    const impact = await this.accountRemovalImpact(slotId);
    if (!impact.canRemove) throw new DomainError("ACCOUNT_OWNS_PROJECTS", "Transfer or delete owned projects before removing this account slot.");
    await this.db.transaction((state) => {
      state.accounts = state.accounts.filter((account) => account.slotId !== slotId);
      state.grants = state.grants.filter((grant) => grant.slotId !== slotId);
      state.threadBindings = state.threadBindings.filter((binding) => binding.slotId !== slotId);
    });
  }

  async listFiles(projectId: string, actorSlotId: string): Promise<ProjectFile[]> {
    const state = await this.db.read();
    this.requireProject(state, projectId, actorSlotId, "viewer");
    return state.files.filter((file) => file.projectId === projectId && !file.deletedAt);
  }

  async readFile(projectId: string, actorSlotId: string, filePath: string): Promise<ProjectFile> {
    const state = await this.db.read();
    this.requireProject(state, projectId, actorSlotId, "viewer");
    const file = state.files.find((candidate) => candidate.projectId === projectId && candidate.path === filePath && !candidate.deletedAt);
    if (!file) throw new DomainError("FILE_NOT_FOUND", "The project file does not exist.");
    const safePath = await safeProjectPath(this.workspacePath(projectId), filePath);
    const content = await readFile(safePath, "utf8");
    if (content !== file.content) throw new DomainError("FILE_DRIFT", "The workspace file differs from its indexed record.");
    return file;
  }

  async writeFile(input: WriteFileInput): Promise<ProjectFile> {
    let record!: ProjectFile;
    await this.db.transaction(async (state) => {
      const project = this.requireProject(state, input.projectId, input.actorSlotId, "editor");
      const safePath = await safeProjectPath(this.workspacePath(project.id), input.path);
      const content = boundedText(input.content, "content", 10_000_000);
      const existing = state.files.find((candidate) => candidate.projectId === project.id && candidate.path === input.path);
      if (input.expectedVersion !== undefined && existing && existing.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", "The file changed before this write.");
      record = { projectId: project.id, path: input.path, content, contentType: input.contentType || "text/plain", byteLength: Buffer.byteLength(content), version: (existing?.version || 0) + 1, updatedAt: nowIso(), deletedAt: null };
      await writeFileAtomic(safePath, content);
      if (existing) state.files[state.files.indexOf(existing)] = record; else state.files.push(record);
      bumpProject(state, project.id);
    });
    await this.recordHistory((await this.db.read()).projects.find((project) => project.id === input.projectId)!, "file-updated", `Updated ${input.path}`);
    return record;
  }

  async copyFile(input: CopyFileInput): Promise<ProjectFile> {
    const source = await this.readFile(input.projectId, input.actorSlotId, input.sourcePath);
    return this.writeFile({ projectId: input.projectId, actorSlotId: input.actorSlotId, path: input.destinationPath, content: source.content, contentType: source.contentType, expectedVersion: input.expectedVersion });
  }

  async deleteFile(input: DeleteFileInput): Promise<void> {
    await this.db.transaction(async (state) => {
      const project = this.requireProject(state, input.projectId, input.actorSlotId, "editor");
      const file = state.files.find((candidate) => candidate.projectId === project.id && candidate.path === input.path && !candidate.deletedAt);
      if (!file) throw new DomainError("FILE_NOT_FOUND", "The project file does not exist.");
      if (input.expectedVersion !== undefined && file.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", "The file changed before deletion.");
      await safeProjectPath(this.workspacePath(project.id), input.path);
      file.deletedAt = nowIso(); file.version += 1; file.updatedAt = nowIso();
      await rm(path.join(this.workspacePath(project.id), input.path), { force: true });
      bumpProject(state, project.id);
    });
  }

  async putDesignSystem(input: { projectId: string | null; actorSlotId: string; id?: string; name: string; description?: string; tokens: Record<string, unknown>; expectedVersion?: number }): Promise<DesignSystemRecord> {
    let result!: DesignSystemRecord;
    await this.db.transaction((state) => {
      if (input.projectId) this.requireProject(state, input.projectId, input.actorSlotId, "editor");
      else if (!state.accounts.some((account) => account.slotId === input.actorSlotId)) throw new DomainError("ACCOUNT_NOT_FOUND", "The account slot does not exist.");
      const current = input.id ? state.designSystems.find((record) => record.id === input.id) : undefined;
      if (current && input.expectedVersion !== undefined && current.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", "The design system changed before this write.");
      result = current ? { ...current, name: boundedText(input.name, "name", 200), description: boundedText(input.description || "", "description", 10_000), tokens: input.tokens, version: current.version + 1, updatedAt: nowIso() } : { id: input.id || newId("design"), projectId: input.projectId, name: boundedText(input.name, "name", 200), description: boundedText(input.description || "", "description", 10_000), tokens: input.tokens, version: 1, createdAt: nowIso(), updatedAt: nowIso() };
      if (current) state.designSystems[state.designSystems.indexOf(current)] = result; else state.designSystems.push(result);
    });
    return result;
  }

  async createChat(projectId: string, actorSlotId: string, title: string): Promise<ChatRecord> {
    let chat!: ChatRecord;
    await this.db.transaction((state) => {
      this.requireProject(state, projectId, actorSlotId, "viewer");
      chat = { id: newId("chat"), projectId, title: boundedText(title, "title", 200), createdAt: nowIso(), updatedAt: nowIso(), version: 1, archivedAt: null };
      state.chats.push(chat);
    });
    return chat;
  }

  async appendMessage(input: { chatId: string; actorSlotId: string; role: ChatMessage["role"]; content: string; metadata?: Record<string, unknown> }): Promise<ChatMessage> {
    let message!: ChatMessage;
    await this.db.transaction((state) => {
      const chat = state.chats.find((candidate) => candidate.id === input.chatId);
      if (!chat) throw new DomainError("CHAT_NOT_FOUND", "The chat does not exist.");
      const project = this.requireProject(state, chat.projectId, input.actorSlotId, input.role === "assistant" ? "viewer" : "commenter");
      if (input.role === "user" && !WRITE_ROLES.has(roleFor(state, project, input.actorSlotId)!)) throw new DomainError("FORBIDDEN", "This account cannot send messages.");
      message = { id: newId("message"), chatId: chat.id, role: input.role, content: boundedText(input.content, "content", 2_000_000), createdAt: nowIso(), metadata: input.metadata || {} };
      state.messages.push(message); chat.updatedAt = nowIso(); chat.version += 1;
    });
    return message;
  }

  async bindThread(binding: Omit<AccountThreadBinding, "createdAt" | "updatedAt">): Promise<AccountThreadBinding> {
    let result!: AccountThreadBinding;
    await this.db.transaction((state) => {
      this.requireProject(state, binding.projectId, binding.slotId, "viewer");
      const current = state.threadBindings.find((candidate) => candidate.projectId === binding.projectId && candidate.chatId === binding.chatId && candidate.slotId === binding.slotId);
      result = { ...binding, createdAt: current?.createdAt || nowIso(), updatedAt: nowIso() };
      if (current) state.threadBindings[state.threadBindings.indexOf(current)] = result; else state.threadBindings.push(result);
    });
    return result;
  }

  async addComment(input: { projectId: string; actorSlotId: string; filePath?: string | null; anchor?: { start: number; end: number } | null; body: string }): Promise<CommentRecord> {
    let result!: CommentRecord;
    await this.db.transaction((state) => {
      this.requireProject(state, input.projectId, input.actorSlotId, "commenter");
      result = { id: newId("comment"), projectId: input.projectId, filePath: input.filePath || null, anchor: input.anchor || null, authorSlotId: input.actorSlotId, body: boundedText(input.body, "body", 100_000), createdAt: nowIso(), updatedAt: nowIso(), resolvedAt: null };
      state.comments.push(result);
    });
    return result;
  }

  async replyToComment(commentId: string, actorSlotId: string, body: string): Promise<CommentReply> {
    let result!: CommentReply;
    await this.db.transaction((state) => {
      const comment = state.comments.find((candidate) => candidate.id === commentId);
      if (!comment) throw new DomainError("COMMENT_NOT_FOUND", "The comment does not exist.");
      this.requireProject(state, comment.projectId, actorSlotId, "commenter");
      result = { id: newId("reply"), commentId, authorSlotId: actorSlotId, body: boundedText(body, "body", 100_000), createdAt: nowIso() };
      state.replies.push(result);
    });
    return result;
  }

  async createPreview(input: { projectId: string; actorSlotId: string; filePath: string; ttlMs?: number }): Promise<PreviewRecord> {
    const file = await this.readFile(input.projectId, input.actorSlotId, input.filePath);
    const createdAt = nowIso();
    const result: PreviewRecord = { id: newId("preview"), projectId: input.projectId, filePath: input.filePath, url: `claude-design-desktop://preview/${encodeURIComponent(input.projectId)}/${encodeURIComponent(input.filePath)}`, contentHash: createHash("sha256").update(file.content).digest("hex"), createdAt, expiresAt: new Date(Date.now() + Math.max(1_000, Math.min(input.ttlMs || 300_000, 86_400_000))).toISOString() };
    await this.db.transaction((state) => state.previews.push(result));
    return result;
  }

  async archiveProject(projectId: string, actorSlotId: string): Promise<ProjectSummary> {
    let project!: ProjectRecord;
    await this.db.transaction((state) => {
      project = this.requireProject(state, projectId, actorSlotId, "owner");
      project = { ...project, archivedAt: nowIso(), version: project.version + 1, updatedAt: nowIso() };
      state.projects[state.projects.findIndex((candidate) => candidate.id === projectId)] = project;
    });
    await this.recordHistory(project, "archived", `Archived project ${project.name}`);
    return { ...project, role: "owner" };
  }

  async deleteProject(projectId: string, actorSlotId: string): Promise<void> {
    let project!: ProjectRecord;
    await this.db.transaction((state) => {
      project = this.requireProject(state, projectId, actorSlotId, "owner");
      state.projects = state.projects.filter((candidate) => candidate.id !== projectId);
      state.grants = state.grants.filter((grant) => grant.projectId !== projectId);
      state.files = state.files.filter((file) => file.projectId !== projectId);
      state.designSystems = state.designSystems.filter((record) => record.projectId !== projectId);
      state.chats = state.chats.filter((chat) => chat.projectId !== projectId);
      state.comments = state.comments.filter((comment) => comment.projectId !== projectId);
      state.previews = state.previews.filter((preview) => preview.projectId !== projectId);
    });
    await this.recordHistory(project, "deleted", `Deleted project ${project.name}`);
    await rm(this.workspacePath(projectId), { recursive: true, force: true });
  }

  async upsertSetting(key: string, value: unknown): Promise<AppSetting> {
    let result!: AppSetting;
    await this.db.transaction((state) => {
      const current = state.settings.find((setting) => setting.key === key);
      result = { key: boundedText(key, "key", 200), value, version: (current?.version || 0) + 1, updatedAt: nowIso() };
      if (current) state.settings[state.settings.indexOf(current)] = result; else state.settings.push(result);
    });
    return result;
  }

  async upsertOperation(input: Omit<BackgroundOperation, "createdAt" | "updatedAt">): Promise<BackgroundOperation> {
    let result!: BackgroundOperation;
    await this.db.transaction((state) => {
      const current = state.operations.find((operation) => operation.id === input.id);
      result = { ...input, message: boundedText(input.message, "message", 10_000), createdAt: current?.createdAt || nowIso(), updatedAt: nowIso() };
      if (current) state.operations[state.operations.indexOf(current)] = result; else state.operations.push(result);
    });
    return result;
  }

  async addMigrationReceipt(receipt: MigrationReceipt): Promise<void> {
    await this.db.transaction((state) => {
      if (state.receipts.some((candidate) => candidate.idempotencyKey === receipt.idempotencyKey && candidate.sourceFingerprint === receipt.sourceFingerprint)) return;
      if (state.receipts.some((candidate) => candidate.idempotencyKey === receipt.idempotencyKey)) throw new DomainError("MIGRATION_IDEMPOTENCY_CONFLICT", "The idempotency key was used for a different source.");
      state.receipts.push(receipt);
    });
  }

  async role(projectId: string, slotId: string): Promise<ProjectRole | undefined> {
    const state = await this.db.read();
    const project = state.projects.find((candidate) => candidate.id === projectId);
    return project ? roleFor(state, project, slotId) : undefined;
  }

  private requireProject(state: DatabaseState, projectId: string, slotId: string, minimum: ProjectRole): ProjectRecord {
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", "The project does not exist.");
    const role = roleFor(state, project, slotId);
    if (!role || ROLE_ORDER[role] < ROLE_ORDER[minimum]) throw new DomainError("FORBIDDEN", `Account slot lacks the ${minimum} project role.`);
    return project;
  }

  private workspacePath(projectId: string): string {
    assertSafeProjectIdentifier(projectId, "project id");
    return path.join(this.projectsRoot, projectId, "workspace");
  }

  private async recordHistory(project: ProjectRecord, action: string, summary: string): Promise<void> {
    const revision = await this.history.record(project.id, this.workspacePath(project.id), action, summary, { projectId: project.id, version: project.version });
    await this.db.transaction((state) => state.history.push(revision));
  }
}

function roleFor(state: DatabaseState, project: ProjectRecord, slotId: string): ProjectRole | undefined {
  if (project.ownerSlotId === slotId) return "owner";
  return state.grants.find((grant) => grant.projectId === project.id && grant.slotId === slotId)?.role;
}

function bumpProject(state: DatabaseState, projectId: string): void {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  if (project) { project.version += 1; project.updatedAt = nowIso(); }
}

function assertAccountId(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new DomainError("INVALID_ACCOUNT", "The account slot id is invalid.");
}

function boundedText(value: string, label: string, maxBytes: number): string {
  if (typeof value !== "string" || !value.trim() && label !== "description" && label !== "content") throw new DomainError("INVALID_INPUT", `${label} is required.`);
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new DomainError("VALUE_TOO_LARGE", `${label} exceeds the ${maxBytes}-byte limit.`);
  return value;
}

function nullableText(value: string | null, label: string, maxBytes: number): string | null {
  if (value === null) return null;
  return boundedText(value, label, maxBytes);
}
