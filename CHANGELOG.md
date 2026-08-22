# Changelog

All notable changes to Claude Code Router are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to semantic versioning. Released versions appear here when they ship; the `Unreleased` section accumulates work that is implemented but not yet part of a tagged release.

## [Unreleased]

> These entries describe work that is **in code review on feature branches** and recorded here ahead of the next release so the change set is visible early. Entries may be amended during integration; verification state is tracked honestly in [HANDOFF.md](HANDOFF.md) and each item stays unticked in [ROADMAP.md](ROADMAP.md) until its checks run green against an integrated build.

### Added

- **Material Design 3 management UI** — new token system under `packages/ui/src/styles/m3` publishing color roles for light and dark schemes as `--md-sys-*` custom properties, plus type scale, shape, elevation, and motion tokens; a `ThemeProvider` that applies the selected scheme through a `data-md-theme` attribute, persists it in `localStorage`, and restores it before first paint; home, tray, and browser surfaces converted to render entirely from M3 tokens. → [Feature article](docs/features/material-design-3-ui.md)
- **`ultracode` reasoning-effort tier** — a new top tier above `ultra`/`xhigh`/`max`. Exposed through the gateway model catalog only for capable models; the upstream request transform passes named efforts through unchanged and maps numeric thinking budgets to the target model's maximum budget; surfaced in the Claude Code desktop model picker and the management UI picker with English and Traditional Chinese (zh-Hant) labels. → [Feature article](docs/features/reasoning-effort-ultracode.md)
- **Organization banner** — new persisted config block `organizationBanner` (`enabled` boolean, `text` up to 200 characters, optional https `imageUrl` up to 500 characters) in `~/.claude-code-router/config.json`, editable through settings inputs with inline validation, rendered as an M3-styled header strip on Home, and fully hidden when disabled or absent. → [Feature article](docs/features/organization-banner.md)

### Documentation

- New feature deep-dive articles under [`docs/features/`](docs/features/) covering behavior, configuration, failure modes, security notes, and verification for each item above.
- README gains a Features section and docs index pointing at the new articles.
- ROADMAP.md and HANDOFF.md introduced as living status documents.

## [3.0.21]

Release published before this changelog file existed. See the [GitHub releases page](https://github.com/musistudio/claude-code-router/releases) for notes on tagged versions prior to this file's introduction.
