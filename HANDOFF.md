# Handoff — release docs set

Handoff for the documentation lane of the current release train. Written 2026-08-22
from the `docs/release-docs` worktree.

## Scope of this lane

Documentation only. No source changes:

- `README.md` — new **Features** section covering the three landing features plus a docs index.
- `docs/features/material-design-3-ui.md` — Material Design 3 management UI article.
- `docs/features/reasoning-effort-ultracode.md` — ultracode reasoning effort article.
- `docs/features/organization-banner.md` — organization banner article.
- `ROADMAP.md`, `CHANGELOG.md`, `HANDOFF.md` — created (none existed before).

This branch touches no files under `packages/**` or `.github/**`.

## Branches in flight

**Status note (2026-08-22): every branch listed here is a local working branch
owned by a parallel lane of this release train. None of them exists on GitHub
yet — there is nothing to fetch or open a PR against.** "In progress" below
means review inside the owning lane, not an open pull request. Update this
table as each branch is actually pushed and merged.

| Branch | Lane | State |
| --- | --- | --- |
| `feat/m3-tokens` | M3 token system under `packages/ui/src/styles/m3` | pending — parallel fleet, local only, not yet pushed |
| `feat/m3-home-app` | Home surface conversion to M3 tokens | pending — parallel fleet, local only, not yet pushed |
| `feat/m3-tray-browser` | Tray and browser surface conversion | pending — parallel fleet, local only, not yet pushed |
| `feat/ultracode-effort-core` | `ultracode` tier in gateway catalog + request transform | pending — parallel fleet, local only, not yet pushed |
| `feat/ultracode-effort-ui` | `ultracode` in desktop + management UI pickers (en/zh-Hant) | pending — parallel fleet, local only, not yet pushed |
| `feat/org-banner` | Organization banner config, settings inputs, home strip | pending — parallel fleet, local only, not yet pushed |
| `docs/release-docs` | This lane: README features section, feature articles, roadmap/changelog/handoff | this lane — local only, ready for review |

## Verification state

**Honest status: implementation is in review and NOT yet verified.**

- No feature branch above has been verified against a built artifact in this lane.
- Each feature article carries a prominent "Status: implementation in review" banner and
  a Verification section describing the planned checks; none of those checks have run.
- The roadmap deliberately keeps all three features unticked with a *landing via review*
  note; the changelog lists them under Unreleased with the same caveat.
- What this lane did verify: every cross-link between the new documents resolves to a
  file that exists in this branch (`README.md` ↔ the three `docs/features/*.md`
  articles), and the markdown was reviewed by eye for heading structure, table shape,
  and link syntax.

## Next steps for whoever picks this up

1. When the feature branches merge, run each article's planned verification against the
   real build:
   - M3 UI: capture home/tray/browser in light and dark, confirm `data-md-theme` +
     `localStorage` persistence across restart.
   - Ultracode: confirm catalog exposure on capable models only, transform output
     (named pass-through vs. maximum numeric budget), picker labels en + zh-Hant,
     fallback to default effort when a model lacks the tier.
   - Banner: persistence round trip, 200/500-char and https validation rejections,
     strip present when enabled and absent from the DOM when disabled, image-load
     fallback to text-only.
2. Tick the three roadmap items and move the changelog entries into a version heading
   once verified — not before.
3. Promote `docs/features/*.md` into the Astro content collection under
   `docs/src/content/docs/en/...` so the articles render at ccrdesk.top, then mirror
   them into the zh-Hant set.
4. Keep this file current as branches merge or lanes change owner.
