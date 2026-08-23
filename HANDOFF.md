# Handoff

Current state of this repository for whoever picks it up next. Written 2026-08-22,
superseding the earlier per-lane handoff (that one described mid-flight state; every
claim in it was re-checked against the repository before this rewrite).

## Where things stand

- Default branch: `main` @ `6020e9b`, pushed and verified on
  `Ding-Ding-Projects/claude-code-router` (public). Upstream remains configured as
  the `upstream` remote and was never written to.
- The release train merged: Material Design 3 UI rewrite, `ultracode`
  reasoning-effort tier end-to-end, organization banner, desktop shell chrome,
  default claude-design + claude-ship plugins, universal upstream auto-retry
  (15 s cooldown, unlimited attempts, SSE waiting stream), Squirrel release
  pipeline, line counter with agent-vs-human attribution, docs set.
- A GitHub Pages site (landing + docs + changelog + visitor settings) is being
  built on six local branches by a parallel build fleet; see "In flight".

## Verification evidence (what actually ran)

| Gate | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | exit 0 |
| UI suite | `npm test -w @claude-code-router/ui` | 187 pass / 0 fail |
| Bundle build | `npm run build:assets` | exit 0 |
| Core focused | compiled `default-plugins`, `upstream-waiting-retry`, `claude-app-gateway-models` under `.test-dist/` via `node --test` | 45 pass / 0 fail |
| Line counter | `node scripts/count-lines.mjs` | exit 0 |

All gates ran against the integrated tree at `6020e9b`, i.e. against the source
tree plus its built bundle — none of them drove the packaged installer. The
desktop-shell lane additionally ran its own electron unit suite (41/41) and the
effort-UI lane proved one negative regression red→green before landing.

## Known open items (each needs an owner)

1. **CI billing blocker** — the first workflow run on this repo failed at startup:
   GitHub-hosted runners were refused because of account payments / spending limit.
   This is account-level; every push stays red until billing is resolved. The
   workflow files themselves parse clean and gate on nothing by design.
2. **No release exists yet** — releases publish automatically per push once the
   billing blocker clears. Until then README's "landing in this release train"
   banner stays up, the download button on the future site stays absent, and
   roadmap items stay unticked.
3. **Visual captures pending** — real built-app screenshots (light/dark home,
   settings, tray) and the root `social-preview.png` are being produced by the
   site fleet's capture lane. Nothing visual should be claimed until those land.
4. **UI language coverage** — the management UI i18n is `en` + `zh` only today;
   there is no zh-Hant or bilingual mode in the app itself (the ultracode label
   ships as en + zh accordingly). Closing that gap is a cross-cutting change.
5. **~65 bespoke-styled buttons** intentionally left un-swapped during the home
   reskin (unlayered `.md-btn` rules would silently override their utility
   classes); they render through bridged tokens instead. Swap them only together
   with a specificity fix.
6. **Tidbyt/status surfaces** live outside this repository and are unaffected by
   anything here.

## In flight (do not delete while active)

Six local branches owned by the site-build fleet, each with an active checkout:
`feat/site-core`, `feat/social-captures`, `feat/pages-pipeline`,
`feat/site-content`, `feat/site-toys-security`, `feat/site-toys-ops`. When they
land: merge to `main`, run the full gate battery again, enable Pages with
`build_type=workflow` (see `scripts/PAGES-ENABLE.md`), verify the deployed site
serves absolute OG tags under `/claude-code-router/`.

Retained deliberately after ancestry checks (not ancestors of `main`, content
superseded): `preserve/docs-wip`, `preserve/release-pipeline-wip`,
`review/correctness-regression`, `review/fleet3`, `review/md3-a11y-i18n`,
`review/second-fleet`. Delete only with fresh authorization after re-proving.

## Next steps for whoever picks this up

1. Clear the Actions billing blocker, then watch the first release run end to end
   and confirm the Squirrel artifacts + dim-sum code name land in the notes.
2. Land the site fleet, enable Pages, verify deployed URL + OG fetch anonymously.
3. Run each feature article's planned verification against a real installed build
   (theme persistence across restart, catalog-gated ultracode visibility, banner
   round-trip + validation rejections), then tick the three roadmap items and move
   changelog entries into a version heading — not before.
4. Promote `docs/features/*.md` into the Astro collection under
   `docs/src/content/docs/en/...` so the articles render on the existing docs
   site, then mirror into the zh-Hant set.
5. Close the en/zh-only i18n gap (add zh-Hant + bilingual mode app-wide).
