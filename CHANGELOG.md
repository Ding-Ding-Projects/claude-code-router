# Changelog

All notable changes to Claude Code Router are documented in this file. New entries are
added under **Unreleased** and move into a version heading when that version ships.

## [Unreleased]

### Added

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
  and [`docs/features/organization-banner.md`](docs/features/organization-banner.md).

> Note: the three features above are landing via branches currently in review. They are
> listed here as added work; behavior is documented as the target state until
> verification against the built artifact completes (see `ROADMAP.md`).
