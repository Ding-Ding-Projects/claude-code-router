# Roadmap

Checklist for the current release train and repository maintenance.

**Legend:** `- [x]` is complete and verified. `- [ ]` remains open.

## Repository closeout

- [x] Inventory the primary checkout, linked checkouts, local refs, remote refs, and stashes.
- [x] Fetch both configured remotes without writing to `upstream`.
- [x] Confirm the primary checkout and every inspected linked checkout have clean indexes.
- [x] Confirm no unmerged index entries or conflict markers remain.
- [x] Verify that every inspected linked checkout and retained local ref is an ancestor of `origin/main`.
- [x] Create and verify the external 7z archive before any removal decision.
- [x] Refresh `HANDOFF.md` with exact commits, archive evidence, retained items, and exclusions.
- [x] Leave active, user-owned, load-bearing, unmerged, undewed, or ownership-uncertain items in place and documented.
- [x] Leave unrelated release work untouched.

## Current release train

- [ ] Claude Design one-release migration bridge: verify the built artifact and integrate only after its owner confirms readiness.
  - Read-only `claude-design-desktop-import-v1` ZIP export with provenance, record counts, per-file SHA-256 values, deterministic idempotency key, and strict sensitive-data exclusions.
  - Explicit Extensions UI export card for legacy profile or plugin data users, with no automatic disable, deletion, or uninstall.
  - Focused migration tests cover selected records, archive contents, provenance, and traversal rejection.
  - Docs: [docs/features/claude-design-migration.md](docs/features/claude-design-migration.md)

- [ ] Material Design 3 rewrite of the management UI: complete built-artifact verification for the integrated surface.
  - Token system under `packages/ui/src/styles/m3`.
  - Light, dark, and system theme persistence.
  - Home, tray, and browser surfaces converted to the token layer.
  - Docs: [docs/features/material-design-3-ui.md](docs/features/material-design-3-ui.md)

- [ ] Ultracode reasoning effort: complete provider and UI verification.
  - Gateway model catalog support.
  - Upstream request transform and provider budget mapping.
  - Claude Code desktop and management UI labels.
  - Docs: [docs/features/reasoning-effort-ultracode.md](docs/features/reasoning-effort-ultracode.md)

- [ ] Organization banner: complete round-trip and built-artifact verification.
  - Persisted `organizationBanner` configuration.
  - Settings validation and home header rendering.
  - Docs: [docs/features/organization-banner.md](docs/features/organization-banner.md)

## Next

- [ ] Confirm the six site lanes and the design-handoff checkout are no longer active before considering any removal.
- [ ] Clear the external Actions billing blocker, then verify the first release run and its Squirrel artifacts.
- [ ] Enable Pages and verify the deployed URL and absolute OG tags anonymously.
- [ ] Promote feature articles into the documentation content collection and mirror the required language set.
- [ ] Close the management UI language coverage gap with the planned additional language modes.
