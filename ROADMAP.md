# Roadmap

Checklist for the current release train and beyond.

**Legend:** `- [x]` implemented, merged, and verified · `- [ ]` open. Items marked
*landing via review* are implemented on branches currently in review; they stay
unticked until they merge and their verification steps actually run — a written feature
is not a shipped one.

## Current release train

- [ ] **Material Design 3 rewrite of the management UI** *(landing via review — `feat/m3-tokens`, `feat/m3-home-app`, `feat/m3-tray-browser`)*
  - Token system under `packages/ui/src/styles/m3`: color roles light + dark via `--md-sys-*` custom properties, type scale, shape, elevation, motion.
  - `ThemeProvider` applying `data-md-theme` with `localStorage` persistence (light / dark / system).
  - Home, tray, and browser surfaces converted to the token layer.
  - Docs: [docs/features/material-design-3-ui.md](docs/features/material-design-3-ui.md)
- [ ] **Ultracode reasoning effort** *(landing via review — `feat/ultracode-effort-core`, `feat/ultracode-effort-ui`)*
  - New top tier above `ultra`/`xhigh`/`max`, exposed through the gateway model catalog for capable models.
  - Upstream request transform: named effort passed through; maximum thinking budget where the provider takes a numeric value.
  - Surfaced in the Claude Code desktop model picker and the management UI picker with en + zh-Hant labels.
  - Docs: [docs/features/reasoning-effort-ultracode.md](docs/features/reasoning-effort-ultracode.md)
- [ ] **Organization banner** *(landing via review — `feat/org-banner`)*
  - Persisted config `organizationBanner { enabled, text <=200 chars, optional https imageUrl <=500 chars }`.
  - Settings inputs with inline validation; M3-styled header strip on home; hidden entirely when disabled.
  - Docs: [docs/features/organization-banner.md](docs/features/organization-banner.md)

## Next

- [ ] Run verification against the built artifact for all three features above and tick them only when it passes (theme captures light/dark, transform output checks, banner round trip).
- [ ] Convert the remaining management surfaces to the Material Design 3 token layer after home/tray/browser land.
- [ ] Promote the new `docs/features/*.md` articles into the documentation site content collection so they render at ccrdesk.top.
- [ ] Mirror the three feature articles into the zh-Hant documentation set.
- [ ] Per-model tuning notes for `ultracode` (which providers map it to which maximum budgets) documented per provider preset.
- [ ] Organization banner: preview in settings before save.
