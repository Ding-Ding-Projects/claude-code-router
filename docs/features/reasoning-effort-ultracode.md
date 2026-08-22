# Reasoning effort: `ultracode`

> **Status:** implemented on feature branches and in code review. This article describes the target state agreed for the current release cycle; see [HANDOFF](../../HANDOFF.md) for the exact verification position before treating any behavior below as shipped.

CCR already lets you steer how hard a model thinks with reasoning-effort tiers (`low`, `medium`, `high`, `xhigh`, `max`, `ultra`). This change adds a new top tier named **`ultracode`** that sits above all of them, aimed at long-horizon coding work where the maximum available thinking budget is worth its latency and cost.

## Overview

- A single new effort value, `ultracode`, is added above `ultra` in the effort ladder.
- It is exposed through the gateway's model catalog **only for models whose capabilities advertise support** — it does not appear on models that cannot honor it.
- In the upstream request transform, the named effort is passed through to providers that accept named efforts; where the upstream protocol expresses reasoning as a numeric thinking budget, `ultracode` maps to the **maximum budget the target model supports**, not a fixed number.
- Both pickers surface it with localized labels in English and Traditional Chinese (zh-Hant).

## Behavior

### Effort ladder

```
low → medium → high → xhigh → max → ultra → ultracode
```

`ultracode` is strictly the top of the ladder. Ordering matters anywhere the UI or CLI presents, sorts, or compares efforts.

### Gateway model catalog

- Capable models list `ultracode` among their supported reasoning efforts in the catalog served by the gateway.
- Models without the corresponding capability flag simply do not offer the tier; nothing about their existing behavior changes.
- The Claude Code desktop app's model picker and the management UI's model picker both read this exposure and show the tier only when it applies to the selected model.

### Upstream request mapping

| Upstream contract | What happens when `ultracode` is requested |
| --- | --- |
| Provider accepts named effort values | The string `ultracode` is passed through unchanged as the request's reasoning effort |
| Provider expresses reasoning as a numeric thinking budget | The transform maps `ultracode` to the maximum thinking budget advertised for the target model/provider combination |

The existing lower tiers keep their current mappings untouched; only the new value has new mapping logic.

### Picker surfaces

- **Claude Code desktop model picker** — lists the tier when the selected model supports it.
- **Management UI model picker** — same conditional listing.
- Labels are localized: an English label and a Traditional Chinese (zh-Hant) label ship together, so both language modes present the tier natively rather than falling back to the raw enum value.

## Configuration

No new configuration file is required. You select `ultracode` exactly like any other effort:

- Pick it from either picker when working with a capable model.
- Or set the reasoning effort in the relevant agent profile / per-model settings stored in `~/.claude-code-router/config.json`.
- API clients that already send a reasoning-effort field can send `ultracode` directly; the gateway validates it against the routed model's advertised capabilities as it does today for other tiers.

## Failure modes

| Situation | Behavior |
| --- | --- |
| Model lacks the capability flag | Tier is absent from both pickers; it is never silently offered for a model that cannot use it |
| Request names `ultracode` for a non-capable route | Validation follows the gateway's existing unsupported-effort handling and surfaces the resolved provider/model and error in the request log |
| Upstream rejects the effort name despite capability advertising | Error is surfaced through normal observability (status, resolved route, log entry) so the failing hop is identifiable |
| Numeric-budget provider advertises a smaller maximum than expected | Mapping uses whatever maximum that provider actually advertises — the tier means "max available", not a hard-coded token count |
| Existing sessions/profiles pinned to older tiers | Continue unchanged; adding the tier does not alter previously saved selections |

## Security notes

- **Cost and latency:** `ultracode` requests the largest reasoning budget available, which can materially increase token usage, cost, and response time versus lower tiers. Choose it deliberately for hard tasks.
- The effort value influences request bodies but carries no credentials, no user identifiers, and no telemetry; it is recorded only in the local request log alongside the other routing facts CCR already shows.
- Capability gating comes from the gateway's own model catalog, not from client-supplied claims, so a caller cannot conjure the tier for a model that does not declare it.

## Verification

Planned and implemented checks for this feature:

- Catalog tests assert `ultracode` appears only for capable models and keeps correct ordering against the existing ladder.
- Transform tests cover both mappings: named pass-through, and numeric mapping to each provider's advertised maximum budget.
- Picker snapshot/localization tests assert the English and zh-Hant labels render in both the desktop picker and the management UI picker, and that the tier hides for incapable models.

**Current status:** implementation is in review; the checks above have not yet been run to green against an integrated build. Do not tick this off in the [roadmap](../../ROADMAP.md) until they have.

## Suggested next articles

- [Material Design 3 management UI](./material-design-3-ui.md) — the design system one of these pickers renders in.
- [Organization banner](./organization-banner.md) — configuration-sourced header strip on Home.
- [Roadmap](../../ROADMAP.md) — follow-up work around effort defaults and per-provider budgets.
