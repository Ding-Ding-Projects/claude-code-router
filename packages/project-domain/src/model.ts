export type AccountSlotState = "signedOut" | "signingIn" | "ready" | "refreshing" | "offline" | "unavailable" | "error";
export type ProjectRole = "owner" | "editor" | "commenter" | "viewer";
export type ProjectRecord = { id: string; name: string; description: string; ownerSlotId: string; createdAt: string; updatedAt: string; version: number; archivedAt: string | null; settings: Record<string, unknown> };
export type ProjectSummary = ProjectRecord & { role: ProjectRole };
export type AccountSlotRecord = { slotId: string; label: string; email: string | null; planType: string | null; state: AccountSlotState; lastVerifiedAt: string | null; appServerVersion: string | null; createdAt: string; updatedAt: string };
export type ProjectGrant = { projectId: string; slotId: string; role: Exclude<ProjectRole, "owner">; createdAt: string; updatedAt: string };
export type ProjectFile = { projectId: string; path: string; content: string; contentType: string; byteLength: number; version: number; updatedAt: string; deletedAt: string | null };
export type DesignSystemRecord = { id: string; projectId: string | null; name: string; description: string; tokens: Record<string, unknown>; version: number; createdAt: string; updatedAt: string };
export type ChatRecord = { id: string; projectId: string; title: string; createdAt: string; updatedAt: string; version: number; archivedAt: string | null };
export type ChatMessage = { id: string; chatId: string; role: "user" | "assistant" | "system"; content: string; createdAt: string; metadata: Record<string, unknown> };
export type AccountThreadBinding = { projectId: string; chatId: string; slotId: string; threadId: string; transcriptInjected: boolean; createdAt: string; updatedAt: string };
export type CommentRecord = { id: string; projectId: string; filePath: string | null; anchor: { start: number; end: number } | null; authorSlotId: string; body: string; createdAt: string; updatedAt: string; resolvedAt: string | null };
export type CommentReply = { id: string; commentId: string; authorSlotId: string; body: string; createdAt: string };
export type PreviewRecord = { id: string; projectId: string; filePath: string; url: string; contentHash: string; createdAt: string; expiresAt: string };
export type BackgroundOperation = { id: string; kind: string; status: "queued" | "running" | "completed" | "failed" | "cancelled"; projectId: string | null; progress: number; message: string; createdAt: string; updatedAt: string; error: string | null };
export type AppSetting = { key: string; value: unknown; version: number; updatedAt: string };
export type MigrationReceipt = { idempotencyKey: string; sourceFingerprint: string; sourceProductVersion: string; sourceCommit: string; importedAt: string; projectCount: number; fileCount: number; unresolvedOwnerCount: number; projectIdMap: Record<string, string>; excludedCounts: Record<string, number> };
export type HistoryRevision = { id: string; projectId: string | null; action: string; summary: string; commit: string | null; createdAt: string; metadata: Record<string, unknown> };
export type ProjectSnapshot = { project: ProjectSummary; files: ProjectFile[]; designSystems: DesignSystemRecord[]; chats: ChatRecord[]; messages: ChatMessage[]; comments: CommentRecord[]; replies: CommentReply[]; previews: PreviewRecord[] };
export type DatabaseState = { schemaVersion: number; accounts: AccountSlotRecord[]; projects: ProjectRecord[]; grants: ProjectGrant[]; files: ProjectFile[]; designSystems: DesignSystemRecord[]; chats: ChatRecord[]; messages: ChatMessage[]; threadBindings: AccountThreadBinding[]; comments: CommentRecord[]; replies: CommentReply[]; previews: PreviewRecord[]; settings: AppSetting[]; operations: BackgroundOperation[]; receipts: MigrationReceipt[]; history: HistoryRevision[] };
export const EMPTY_DATABASE_STATE: DatabaseState = { schemaVersion: 1, accounts: [], projects: [], grants: [], files: [], designSystems: [], chats: [], messages: [], threadBindings: [], comments: [], replies: [], previews: [], settings: [], operations: [], receipts: [], history: [] };
export function cloneDatabaseState(value: DatabaseState): DatabaseState { return structuredClone(value); }
export function nowIso(): string { return new Date().toISOString(); }
export function newId(prefix: string): string { const randomUuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID; return `${prefix}_${randomUuid ? randomUuid.call((globalThis as any).crypto) : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`; }

