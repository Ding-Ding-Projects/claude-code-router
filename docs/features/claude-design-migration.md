# Claude Design migration archive

The desktop bridge includes an explicit, user-started export path for moving local Claude Design work into Claude Design Desktop. The export is a versioned `claude-design-desktop-import-v1` ZIP archive and does not disable, uninstall, or delete the existing plugin.

## What is included

The export reads the legacy plugin SQLite store in read-only mode and includes the selected project records, templates, design systems, project files, conversations, comments, and project thumbnails. Each binary file is accompanied by its archive path, byte count, and SHA-256 digest in the manifest.

The manifest records the schema version, source product version, source commit, source database SHA-256, export timestamp, deterministic idempotency key, selected record counts, and explicit exclusions. The archive also contains `records/selection.json`, `records/files.jsonl`, and `EXCLUSIONS.json` for inspection before import.

## What is excluded

Request logs, request headers, request bodies, response bodies, cached hosted assets, proxy responses, browser state, gateway configuration, gateway keys, OAuth data, mock identity, entitlements, telemetry, and unrelated plugin state are excluded. The source database remains unchanged after export.

## Safety and recovery

The export is atomic. It writes a unique temporary file and renames it into place with bounded retries for transient file sharing errors. Archive paths are relative, reject absolute paths and traversal, and are validated before any output is written. Oversized files, invalid base64, duplicate archive entries, excessive record counts, and oversized archives are rejected.

The export destination is selected through the native save dialog. A cancelled dialog leaves the legacy configuration and data untouched. Re-running an export with the same source and selection produces the same idempotency key, allowing a future importer to avoid duplicate work. Import and verification remain explicit follow-up actions in Claude Design Desktop.

## Verification

Focused coverage exercises selected record counts, manifest provenance, digest generation, ZIP entries, exclusion boundaries, and traversal rejection. The export implementation is `packages/electron/src/main/claude-design-migration.ts` and its tests are `packages/electron/test/unit/claude-design-migration.test.ts`.

Suggested articles: [Claude Design setup and configuration](/en/configuration/agents/claude-design/), [Material Design 3 management UI](./material-design-3-ui), and [Organization banner](./organization-banner).
