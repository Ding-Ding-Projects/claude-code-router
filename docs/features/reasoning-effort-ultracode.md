# Ultracode reasoning effort

> **Status: implementation in review.** This article describes the target state of the
> `ultracode` tier landing on the `feat/ultracode-effort-core` and
> `feat/ultracode-effort-ui` branches. Nothing below has been verified against a built
> artifact yet — see [Verification](#verification).

## Behavior

`ultracode` is a new, topmost reasoning-effort tier. The effort ordering becomes:

```text
low < medium < high < xhigh < max < ultra < ultracode
```

- **Gateway model catalog** — capable models list `ultracode` in their per-model effort
  set alongside the existing efforts, with the catalog's usual default-effort handling.
  Models that cannot honor the tier do not advertise it, so availability is decided by
  the catalog rather than by a hard-coded allowlist of provider names.
- **Upstream request transform** — when a request resolves to `ultracode`:
  - Providers that accept a *named* effort receive `ultracode` passed through as-is.
  - Providers that take a *numeric* thinking budget receive the maximum thinking budget
    the model supports — `ultracode` maps to the top of the numeric range rather than
    being dropped or silently downgraded to a lower named tier.
- **Pickers** — the Claude Code desktop model picker and the management UI model picker
  both surface the tier with English and Traditional Chinese (zh-Hant) labels, ordered
  above the existing efforts.

Requests routed at other efforts are unaffected: no transform change applies unless the
resolved effort is `ultracode`.

## Configuration

- No new configuration keys. Availability comes from the gateway model catalog; a model
  offers `ultracode` exactly when the catalog lists it in that model's efforts.
- Selection happens where any other effort is selected today: agent profiles and the
  model pickers in the Claude Code desktop app and the management UI.
- Because the tier maps to a maximum thinking budget on numeric providers, expect
  higher token usage and latency on those routes; the request log's token and cost
  reporting reflects it like any other request.

## Failure modes

- **Model does not support the tier** — it does not appear in that model's picker
  entries. If a persisted profile references `ultracode` for a model whose catalog entry
  no longer lists it, the route falls back to that model's default effort instead of
  sending an unsupported value upstream.
- **Provider rejects a named effort** — the transform's provider-specific mapping rules
  apply; on providers that only take a numeric budget the value arrives as the maximum
  thinking budget, never as an unrecognized string.
- **Unknown effort value in a hand-edited profile** — treated like any unrecognized
  effort today: the route resolves without sending the invalid value upstream.

## Security notes

- Selecting `ultracode` changes cost and latency characteristics only. It introduces no
  new credentials, endpoints, or data flows; requests still travel to the same resolved
  provider and account.
- The elevated budget means higher spend per request on metered providers. Cost
  estimates and token counts in the observability views report it through the existing
  pipeline — there is no separate "ultracode" accounting path to audit.
- No effort value is logged beyond what request logging already records for routing
  resolution.

## Verification

Not yet run — the implementation is in review. Planned checks once the branches land:

1. Catalog exposure: capable models list `ultracode`; non-capable models do not.
2. Transform output: a named-effort provider receives `ultracode`; a numeric-budget
   provider receives the model's maximum thinking budget.
3. Picker labels: English and zh-Hant labels render in both the Claude Code desktop
   model picker and the management UI picker, ordered above `ultra`.
4. Fallback: a profile pinned to `ultracode` against a model without the tier resolves
   to that model's default effort.

Until those steps pass against the real gateway, treat this article as describing intent,
not a verified release.

## Suggested next articles

- [Material Design 3 management UI](./material-design-3-ui.md) — the token layer and
  theming behind the management UI picker surfaces.
- [Organization banner](./organization-banner.md) — the M3-styled home header strip and
  its persisted configuration.
