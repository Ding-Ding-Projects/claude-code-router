import { lstat } from "node:fs/promises";
import path from "node:path";

export class UnsafeProjectPathError extends Error {
  readonly code = "UNSAFE_PROJECT_PATH";
}

/** Resolve a project-relative path without allowing device, absolute, or link escapes. */
export async function safeProjectPath(root: string, relativePath: string): Promise<string> {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new UnsafeProjectPathError("A project path is required.");
  }
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath) || /^\\\\/.test(relativePath)) {
    throw new UnsafeProjectPathError("Absolute and device paths are not allowed.");
  }
  const normalizedInput = relativePath.replaceAll("\\", "/");
  const parts = normalizedInput.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) {
    throw new UnsafeProjectPathError("Traversal, empty segments, and NUL bytes are not allowed.");
  }
  const rootAbsolute = path.resolve(root);
  const candidate = path.resolve(rootAbsolute, ...parts);
  const rootPrefix = rootAbsolute.endsWith(path.sep) ? rootAbsolute : `${rootAbsolute}${path.sep}`;
  if (candidate !== rootAbsolute && !candidate.startsWith(rootPrefix)) {
    throw new UnsafeProjectPathError("The path escapes the project workspace.");
  }

  // Walk the lexical path before any resolution.  Existing symlinks and
  // reparse-point-like links are rejected instead of being followed.
  let current = rootAbsolute;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new UnsafeProjectPathError("Symlinks and reparse points are not allowed.");
      }
    } catch (error) {
      if (error instanceof UnsafeProjectPathError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      break;
    }
  }
  return candidate;
}

export function assertSafeProjectIdentifier(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new UnsafeProjectPathError(`${label} contains unsupported characters.`);
  }
  return value;
}

