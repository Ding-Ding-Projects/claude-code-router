# Changelog

All notable changes to Claude Code Router are documented in this file. New entries are
added under **Unreleased** and move into a version heading when that version ships.

## [Unreleased]

### Added

- **Claude Design migration bridge.** Added an explicit native export for the versioned `claude-design-desktop-import-v1` ZIP archive. The archive includes selected projects, templates, design systems, files, conversations, comments, and thumbnails with provenance, counts, SHA-256 values, and an idempotency key, while excluding request logs, hosted caches, browser state, gateway credentials, OAuth data, mock identity, entitlements, and telemetry. The Extensions view exposes the export only for legacy Claude Design data and never disables or deletes the existing plugin automatically.

- **Material Design 3 management UI.** Token system under `packages/ui/src/styles/m3`
  with light and dark color roles exposed as `--md-sys-*` custom properties plus type
  scale, shape, elevation, and motion tokens; a `ThemeProvider` applying the theme via a
  `data-md-theme` attribute with `localStorage` persistence; home, tray, and browser
  surfaces converted to the token layer.
- **Ultracode reasoning effort.** A new top reasoning-effort tier above
  `ultra`/`xhigh`/`max`, exposed through the gateway model catalog for capable models,
  mapped in the upstream request transform (named effort passed through; maximum
  thinking budget where the provider takes a numeric value), and surfaced in the Claude
  Code desktop model picker and the management UI picker with English and zh-Hant
  labels.
- **Organization banner.** Persisted configuration
  `organizationBanner { enabled, text <=200 chars, optional https imageUrl <=500 chars }`
  with settings inputs and an M3-styled header strip on the management UI home, hidden
  entirely when disabled.

### Documentation

- New feature articles: [`docs/features/material-design-3-ui.md`](docs/features/material-design-3-ui.md),
  [`docs/features/reasoning-effort-ultracode.md`](docs/features/reasoning-effort-ultracode.md),
  [`docs/features/organization-banner.md`](docs/features/organization-banner.md),
  and [`docs/features/claude-design-migration.md`](docs/features/claude-design-migration.md).

> Note: the three features above are landing via branches currently in review. They are
> listed here as added work; behavior is documented as the target state until
> verification against the built artifact completes (see `ROADMAP.md`).
