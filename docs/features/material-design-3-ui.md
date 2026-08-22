# Material Design 3 management UI

> **Status:** implemented on feature branches and in code review. This article describes the target state agreed for the current release cycle; see [HANDOFF](../../HANDOFF.md) for the exact verification position before treating any behavior below as shipped.

The management UI is being rewritten on a Material Design 3 (M3) foundation. Instead of ad-hoc colors, font sizes, radii, shadows, and animations scattered across components, every visual decision now comes from a central token system, and light/dark theming becomes a first-class, persisted user choice. The home, tray, and browser surfaces are converted in this cycle; remaining surfaces follow.

## Overview

- A dedicated token layer lives under `packages/ui/src/styles/m3` and defines color roles, type scale, shape, elevation, and motion as CSS custom properties.
- Color roles are published twice — once for the light scheme and once for the dark scheme — under `--md-sys-*` names (for example `--md-sys-color-primary`, `--md-sys-color-surface`, `--md-sys-color-on-surface`).
- A React `ThemeProvider` applies the selected scheme to the document root through a `data-md-theme` attribute and persists the choice in browser `localStorage`, restoring it before first paint so the UI does not flash the wrong scheme.
- Components consume tokens only. No component hard-codes a hex value or pixel size that belongs to the design system, which keeps every future surface automatically themeable and consistent.

## Behavior

### Token system (`packages/ui/src/styles/m3`)

| Token group | Published as | Notes |
| --- | --- | --- |
| Color roles | `--md-sys-color-*` custom properties | Full M3 role set: primary/on-primary, secondary, tertiary, surface variants, outline, error, and supporting roles |
| Type scale | `--md-sys-typescale-*` | Display, headline, title, body, and label roles with size/weight/line-height per M3 |
| Shape | `--md-sys-shape-*` | Corner radius scale from none through full |
| Elevation | `--md-sys-elevation-*` | Level 0–5 shadow values matching M3 elevation levels |
| Motion | `--md-sys-motion-*` | Standard durations and easings; reduced-motion preferences collapse non-essential transitions |

Both schemes are defined in the same files: the light scheme is the default set of custom properties, and the dark scheme overrides it when the root carries the corresponding `data-md-theme` value. Because components reference roles rather than raw values, switching schemes re-themes the entire application without component changes.

### ThemeProvider

1. On startup the provider reads the persisted scheme choice from `localStorage`.
2. It writes the resolved scheme onto the document root as `data-md-theme="light"` or `data-md-theme="dark"`.
3. It persists any subsequent change back to `localStorage` so the choice survives reloads and restarts of the desktop app.
4. Scheme changes apply live to the running UI — no restart required.

### Converted surfaces

In this cycle the following surfaces render entirely from M3 tokens:

- **Home** — the dashboard entry surface.
- **Tray** — the system-tray menu and quick controls.
- **Browser** — the built-in automation browser chrome.

Surfaces not listed above still render with their previous styling until their conversion lands; they remain fully functional during the transition.

## Configuration

No configuration file changes are involved. The theme choice is a per-user UI preference:

- Switch schemes from the UI's appearance controls; the selection is stored locally and applied immediately.
- Clearing the app's local web storage returns the UI to the default light scheme.
- There is no remote sync and no config.json field for the theme; it never leaves the machine.

## Failure modes

| Situation | Behavior |
| --- | --- |
| `localStorage` unavailable (restricted profile, storage disabled) | Provider falls back to the default light scheme; UI renders normally and no error blocks startup |
| Stored value is not a recognized scheme name (corrupt or hand-edited) | Value ignored, default light scheme applied; next explicit change overwrites the bad value |
| Attribute missing entirely (component rendered outside the provider) | Light scheme custom properties are still active because they are the base definitions, so surfaces degrade to light instead of unstyled |
| Reduced motion requested at OS/browser level | Motion tokens resolve to minimal/no transition durations rather than animating |
| Unconverted surface encountered mid-transition | Surface renders legacy styling but remains functional; conversion tracked on the roadmap |

## Security notes

- Tokens and themes are presentation-only data. The provider validates the stored scheme against the known set before applying it, so an arbitrary string can never be injected into the DOM attribute.
- The theme preference contains no personal data, is not sent to providers, is not logged, and never enters request payloads, telemetry, or exports.
- No third-party fonts, CDNs, or remote style assets are introduced; all styling ships inside the application bundle.

## Verification

Planned and implemented checks for this feature:

- Unit tests cover the ThemeProvider round trip: persist → reload → restore, plus fallback when storage is empty, unavailable, or corrupt.
- A guard test asserts the token files define both the light and dark sets for the `--md-sys-color-*` roles so one scheme cannot silently go stale.
- Manual verification walks the converted home/tray/browser surfaces in both schemes at common window sizes, checking contrast, focus visibility, and that no clipped or overlapping text appears.

**Current status:** implementation is in review; the checks above have not yet been run to green against an integrated build. Do not tick this off in the [roadmap](../../ROADMAP.md) until they have.

## Suggested next articles

- [Reasoning effort: ultracode](./reasoning-effort-ultracode.md) — the new top effort tier surfaced in these same pickers.
- [Organization banner](./organization-banner.md) — an M3-styled header strip rendered by this token system.
- [Roadmap](../../ROADMAP.md) — which surfaces convert in later cycles.
