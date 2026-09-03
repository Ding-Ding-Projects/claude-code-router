import { execFile } from "node:child_process";
import { mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { newId, nowIso, type HistoryRevision } from "../../project-domain/src/model";

const execFileAsync = promisify(execFile);
const SECRET_KEY = /(secret|token|password|passwd|credential|authorization|cookie|api[_-]?key|private[_-]?key|otp|totp|pin)/i;

export class LocalGitHistory {
  constructor(private readonly root: string) {}

  async record(projectId: string, workspace: string, action: string, summary: string, metadata: Record<string, unknown> = {}): Promise<HistoryRevision> {
    const repo = path.join(this.root, "projects", `${projectId}.git`);
    const snapshot = path.join(this.root, "snapshots", projectId);
    await mkdir(snapshot, { recursive: true });
    await mkdir(repo, { recursive: true });
    try {
      await execFileAsync("git", ["--git-dir", repo, "rev-parse", "--git-dir"]);
    } catch {
      await execFileAsync("git", ["init", "--bare", repo]);
    }
    await cp(workspace, snapshot, { recursive: true, force: true, filter: (source) => !source.includes(`${path.sep}.git${path.sep}`) });
    const eventPath = path.join(snapshot, ".project-history-event.json");
    await writeFile(eventPath, JSON.stringify({ action, summary, metadata: redact(metadata), createdAt: nowIso() }), { encoding: "utf8" });
    const env = {
      ...process.env,
      GIT_DIR: repo,
      GIT_WORK_TREE: snapshot,
      GIT_AUTHOR_NAME: "Claude Fable 5.1",
      GIT_AUTHOR_EMAIL: "noreply@anthropic.com",
      GIT_COMMITTER_NAME: "Claude Fable 5.1",
      GIT_COMMITTER_EMAIL: "noreply@anthropic.com"
    };
    await execFileAsync("git", ["add", "-A"], { env });
    const message = `${summary}\n\n${action} recorded locally; the snapshot remains append-only.\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`;
    let commit: string | null = null;
    try {
      await execFileAsync("git", ["-c", "user.name=Claude Fable 5.1", "-c", "user.email=noreply@anthropic.com", "commit", "-m", message], { env });
      const result = await execFileAsync("git", ["rev-parse", "HEAD"], { env });
      commit = result.stdout.trim();
    } catch (error) {
      const text = `${(error as Error).message || error}`;
      if (!text.includes("nothing to commit")) throw error;
    }
    return { id: newId("history"), projectId, action, summary, commit, createdAt: nowIso(), metadata: redact(metadata) };
  }
}

function redact(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    if (Array.isArray(item)) result[key] = item.map((entry) => entry && typeof entry === "object" ? redact(entry as Record<string, unknown>) : entry);
    else if (item && typeof item === "object") result[key] = redact(item as Record<string, unknown>);
    else result[key] = item;
  }
  return result;
}

