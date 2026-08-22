# Dependency manifest

Committed record of every binary dependency `download-dependencies.bat`
installs, with its pin and its authoritative digest source, so a human can
audit what a build puts on a machine without running the script. The script
reports the versions it finds against this manifest on every run.

This manifest pins **majors, best-effort**: the script refuses to continue on
an older major, warns honestly on a newer one, and names this file so the pin
stays maintained rather than silently drifting.

## Node.js

| Field | Value |
| --- | --- |
| Required | Node.js 22 LTS or newer (pinned major: **22**) |
| Winget package id | `OpenJS.NodeJS.LTS` |
| Canonical upstream | https://nodejs.org/en/download |
| SHA256 source | Official per-release digests: `https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt` (and the matching `SHASUMS256.txt.sig`) |
| Winget-side integrity | The winget catalog verifies each installer's hash before handoff; the URLs above are the upstream authority for manual verification |
| Install flags | `--silent --accept-source-agreements --accept-package-agreements` so a silent run never shows an installer wizard |
| Elevation note | The Node LTS installer is machine-scope, so a non-elevated silent run can fail with access denied; `build.bat` / `build-installer.bat` pre-elevate for interactive runs, and a silent run reports the failure exactly instead of prompting |

The script refreshes the current process `PATH` after install (`%ProgramFiles%\nodejs`,
`%LOCALAPPDATA%\Programs\nodejs`) because winget only updates `PATH` for
future shells.

## Workspace packages (npm)

| Field | Value |
| --- | --- |
| Install command | `npm ci --no-audit --no-fund` |
| Version source | `package-lock.json` (committed, exact pins) |
| Canonical registry | https://registry.npmjs.org |
| Native builds | `better-sqlite3` builds or downloads a prebuilt binding through its own install script; no other postinstall surprises are introduced |

## Never installed by this script

- Code-signing certificates, keys, or any signing material (permanently out of
  scope for this project).
- Secrets, tokens, or credentials of any kind.
- Anything from a mirror, fork, or an ad-hoc URL: every source above is the
  ecosystem's canonical upstream.
