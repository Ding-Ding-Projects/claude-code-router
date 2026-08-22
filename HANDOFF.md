# Handoff — release documentation set

**Date:** 2026-08-22
**Branch:** `docs/release-docs` (based on `main` @ `1347c86`)
**Lane:** documentation only. This branch changes **no** files under `packages/**` and none under `.github/**`.

## Scope

This branch ships the release-documentation set for three features another fleet of agents is landing in parallel:

1. **Material Design 3 rewrite of the management UI** — token system under `packages/ui/src/styles/m3` (`--md-sys-*` color roles in light + dark, type scale, shape, elevation, motion), a `ThemeProvider` applying `data-md-theme` with `localStorage` persistence, and converted home/tray/browser surfaces.
2. **`ultracode` reasoning-effort tier** — new top tier above `ultra`/`xhigh`/`max`; gateway model-catalog exposure gated to capable models; upstream transform passes named effort through and maps numeric thinking budgets to the model's maximum; en + zh-Hant labels in the Claude Code desktop and management UI pickers.
3. **Organization banner** — persisted `organizationBanner` config (`enabled`, `text` ≤ 200 chars, optional https `imageUrl` ≤ 500 chars), settings inputs, M3-styled header strip on Home, hidden when disabled.

The articles document the **agreed target state** for these features. Where the final implementation deviates (see "Reconciliation needed" below), the implementation wins and the article gets updated.

## Files in this branch

| File | Change |
| --- | --- |
| `README.md` | Added a Features section covering all three items plus a docs index table |
| `docs/features/material-design-3-ui.md` | New feature article |
| `docs/features/reasoning-effort-ultracode.md` | New feature article |
| `docs/features/organization-banner.md` | New feature article |
| `ROADMAP.md` | New: checklist with the three features unticked (in review) plus future items |
| `CHANGELOG.md` | New: `Unreleased` section listing the three features |
| `HANDOFF.md` | New: this file |

## Branches in flight (other lanes)

These branches carry the implementations this documentation describes. They are **not part of this branch** and were not touched here.

| Branch(es) | Feature |
| --- | --- |
| `feat/m3-tokens`, `feat/m3-home-app`, `feat/m3-tray-browser` | Material Design 3 UI (token system; home surface; tray/browser surfaces) |
| `feat/ultracode-effort-core`, `feat/ultracode-effort-ui` | `ultracode` tier (gateway/catalog/transform core; picker UI) |
| `feat/org-banner` | Organization banner |

## Verification state

**Honest position: the implementations are in code review and are not yet verified.** Nothing in this branch should be read as a claim that any of the three features has been run green end-to-end.

What **has** been done on this branch:

- All cross-links between the new documents resolve to files that exist on this branch (checked programmatically — every relative `.md` link in the changed files was resolved against the tree).
- Markdown reviewed by eye for structure, heading hierarchy, table formatting, and checklist syntax.

What has **not** been done yet:

- The per-feature checks listed in each article's Verification section have not been run against an integrated build.
- The features themselves have not been merged or verified.

### Reconciliation needed after merge

Details deliberately left to be confirmed against the final implementation, then folded into the articles:

- The exact `localStorage` key used by the `ThemeProvider`.
- The exact English and zh-Hant display label strings for the `ultracode` tier.
- The provider-by-provider numeric thinking-budget values the `ultracode` mapping resolves to.
- Whether unsupported-model behavior for an explicit `ultracode` request is rejection, downgrade, or pass-through-as-configured.

If implementation diverges from the target description anywhere else, update the article in the same change rather than leaving stale prose behind.

## Next steps

1. Merge the six feature branches listed above into the default branch.
2. Run each article's Verification section against the integrated build; record results.
3. Reconcile the four open details in "Reconciliation needed" and amend the articles.
4. Tick the three roadmap items only after their verification runs green.
5. Fold `CHANGELOG.md`'s Unreleased entries into the next release's notes when tagging.
6. Follow-up lanes (also on the roadmap): mirror the articles onto ccrdesk.top in en + zh, convert remaining management surfaces to M3, add a zh-Hant README Features mirror.
