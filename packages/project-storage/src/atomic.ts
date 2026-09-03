import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

export type AtomicWriteOptions = { mode?: number; renameAttempts?: number; retryDelayMs?: number };

/** Write and replace a file without exposing a partial destination. */
export async function writeFileAtomic(
  destination: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const attempts = Math.max(1, Math.min(options.renameAttempts ?? 8, 20));
  const delayMs = Math.max(1, Math.min(options.retryDelayMs ?? 35, 250));
  await mkdir(path.dirname(destination), { recursive: true });
  const tempPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.${randomBytes(8).toString("hex")}.tmp`
  );
  let written = false;
  try {
    await writeFile(tempPath, data, { mode: options.mode ?? 0o600, flag: "wx" });
    written = true;
    if (options.mode !== undefined) await chmod(tempPath, options.mode);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await rename(tempPath, destination);
        written = false;
        return;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException).code;
        if (!TRANSIENT_RENAME_CODES.has(code || "") || attempt === attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  } finally {
    if (written) await unlink(tempPath).catch(() => undefined);
  }
}

