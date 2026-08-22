# Roadmap

A living checklist for Claude Code Router. Finished items get ticked **only after they are implemented and verified** — an unticked item with work in flight stays unticked until its verification lands.

**Legend**

- `- [ ]` not complete (may be implemented but unverified — the note beside it says which).
- `- [x]` implemented, verified, and merged to the default branch.

## In flight — landing via review

These three items are implemented on feature branches currently in code review. They are deliberately **not** ticked: none has been verified against an integrated build yet. Ticking happens only after each item's verification checks run green post-merge. Details and planned checks live in their articles.

- [ ] **Material Design 3 rewrite of the management UI** — M3 token system under `packages/ui/src/styles/m3` (`--md-sys-*` color roles in light + dark, type scale, shape, elevation, motion), `ThemeProvider` with `data-md-theme` attribute and `localStorage` persistence, and converted home/tray/browser surfaces. *Implemented on `feat/m3-tokens`, `feat/m3-home-app`, `feat/m3-tray-browser`; in review, pending verification.* → [docs/features/material-design-3-ui.md](docs/features/material-design-3-ui.md)
- [ ] **`ultracode` reasoning-effort tier** — new top tier above `ultra`/`xhigh`/`max`; gateway model-catalog exposure gated to capable models; upstream transform passes named effort through and maps numeric thinking budgets to the model's maximum; surfaced with en + zh-Hant labels in the Claude Code desktop and management UI pickers. *Implemented on `feat/ultracode-effort-core` and `feat/ultracode-effort-ui`; in review, pending verification.* → [docs/features/reasoning-effort-ultracode.md](docs/features/reasoning-effort-ultracode.md)
- [ ] **Organization banner** — persisted `organizationBanner` config (`enabled`, `text` ≤ 200 chars, optional https `imageUrl` ≤ 500 chars) with settings inputs, M3-styled header strip on Home, fully hidden when disabled. *Implemented on `feat/org-banner`; in review, pending verification.* → [docs/features/organization-banner.md](docs/features/organization-banner.md)

## Recently completed

From merged history on the default branch:

- [x] Preserve provider account meters during import.
- [x] Fix Claude Code local agent auth provider hook regression, with a dedicated regression test.
- [x] Responses-API session affinity fix.

## Next up

Proposals and follow-ups — scope may change before implementation:

- [ ] Convert the remaining management surfaces (providers, routing, logs, settings detail pages) onto the M3 token system, following home/tray/browser.
- [ ] Persist per-provider reasoning-effort defaults in agent profiles so `ultracode` can be pinned per provider rather than per request.
- [ ] Document provider-by-provider maximum thinking budgets alongside the `ultracode` mapping table.
- [ ] Mirror the three new feature articles into the published docs site (`ccrdesk.top`) in both English and Chinese.
- [ ] Add a zh-Hant mirror of the README Features section once the three features land.

## Deliberately not doing

Nothing here yet. Items consciously rejected will be recorded with the reason instead of being silently dropped.
