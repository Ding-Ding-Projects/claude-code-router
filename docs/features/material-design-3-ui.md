# Material Design 3 management UI

> **Status: implementation in review.** This article describes the target state of the
> Material Design 3 rewrite landing on the `feat/m3-tokens`, `feat/m3-home-app`, and
> `feat/m3-tray-browser` branches. Nothing below has been verified against a built
> artifact yet — see [Verification](#verification).

## Behavior

The management UI renders from a Material Design 3 token layer instead of ad-hoc
component styles. The token system lives under `packages/ui/src/styles/m3` and covers
five groups:

- **Color roles** for light and dark themes, exposed as `--md-sys-*` custom properties
  (`--md-sys-color-primary`, `--md-sys-color-on-primary`, `--md-sys-color-surface`,
  `--md-sys-color-surface-variant`, `--md-sys-color-on-surface-variant`,
  `--md-sys-color-outline`, `--md-sys-color-error`, and the remaining M3 roles).
  Components never hard-code hex values; they read the role custom properties, so a
  theme switch restyles the whole surface without component changes.
- **Type scale** — the M3 `display`, `headline`, `title`, `body`, and `label` roles with
  their size, line-height, weight, and letter-spacing values.
- **Shape** — the corner-radius scale used by small, medium, and large components.
- **Elevation** — levels 0 through 5 with their shadow and surface-tint treatment.
- **Motion** — duration and easing tokens for standard, emphasized, and expressive
  transitions.

A `ThemeProvider` component resolves the active theme and applies it by writing a
`data-md-theme` attribute on the root element. The chosen theme is persisted in
`localStorage`, so the preference survives app restarts and page reloads. A `system`
setting follows the operating system's `prefers-color-scheme` and re-resolves when the
OS theme changes.

The **home**, **tray**, and **browser** surfaces are converted to consume the token
layer. Surfaces that have not been converted yet keep rendering with their existing
styles; conversion is incremental and unconverted surfaces are not intended to regress.

## Configuration

- Theme selection (light, dark, or system) is exposed in the management UI settings and
  applied live through `ThemeProvider`; the selection persists in `localStorage`.
- Tokens are plain CSS custom properties. Downstream components consume them with
  `var(--md-sys-color-...)`, `var(--md-sys-shape-...)`, and the matching type, elevation,
  and motion tokens — there is no runtime theming API to call.
- No gateway or provider configuration changes. The feature is entirely client-side.

## Failure modes

- **Missing or corrupt `localStorage` value** — the provider falls back to the default
  theme instead of rendering an unstyled surface.
- **`system` theme with no OS preference reported** — resolves to the light theme.
- **Unconverted surface** — keeps its legacy styles until its conversion lands; mixed
  rendering is expected only during the transition, not a defect to work around.
- **Reduced motion** — motion tokens are expected to respect the platform
  `prefers-reduced-motion` preference rather than animating regardless.

## Security notes

- The theme preference is stored locally in the app's `localStorage`. No theme state is
  sent to the gateway, to providers, or to any remote endpoint.
- The token layer is static CSS shipped with the app. No CDN stylesheet, remote font, or
  third-party asset is introduced by the rewrite.
- Theme state carries no user content, so nothing about it appears in request logs,
  exports, or telemetry.

## Verification

Not yet run — the implementation is in review. The planned verification, to be executed
against the built desktop artifact once it lands:

1. Build the UI and launch the desktop app.
2. Capture the home, tray, and browser surfaces in light and dark themes.
3. Toggle the theme in settings and confirm `data-md-theme` updates on the root element
   and the choice persists across an app restart (`localStorage` round trip).
4. Confirm converted surfaces read `--md-sys-color-*` roles (no hard-coded colors) and
   that contrast holds in both themes.

Until those steps produce real captures, treat this article as describing intent, not a
verified release.

## Suggested next articles

- [Ultracode reasoning effort](./reasoning-effort-ultracode.md) — the new top effort
  tier and how it reaches the model catalog and pickers.
- [Organization banner](./organization-banner.md) — the M3-styled home header strip and
  its persisted configuration.
