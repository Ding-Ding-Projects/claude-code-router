/*
 * Material Design 3 system tokens for @claude-code-router/ui.
 *
 * The values here mirror the CSS custom properties in tokens.css one-to-one;
 * tokens.css is what the runtime consumes, this module gives TypeScript call
 * sites a typed view for programmatic styling and tests.
 *
 * The color schemes are generated from the app's existing accent seed
 * (#0f766e, the teal used by --primary in styles/globals.css). Regenerate
 * them with:
 *
 *   node packages/ui/src/styles/m3/generate-palette.mjs
 */

/** Every Material 3 color-system role, in Material naming order. */
export const mdColorRoles = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "background",
  "onBackground",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "outline",
  "outlineVariant",
  "shadow",
  "scrim",
  "inverseSurface",
  "inverseOnSurface",
  "inversePrimary",
  "surfaceDim",
  "surfaceBright",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest"
] as const;

export type MdColorRole = (typeof mdColorRoles)[number];

export type MdColorScheme = Record<MdColorRole, string>;

/** Light scheme, grounded in the app's teal seed (#0f766e). */
export const mdColorSchemeLight: MdColorScheme = {
  primary: "#006B63",
  onPrimary: "#FFFFFF",
  primaryContainer: "#9AF2E8",
  onPrimaryContainer: "#002521",
  secondary: "#4B6360",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#CDE8E4",
  onSecondaryContainer: "#091F1D",
  tertiary: "#386281",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#C7E7FF",
  onTertiaryContainer: "#001D38",
  error: "#B52521",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD5",
  onErrorContainer: "#590000",
  background: "#F5FAFA",
  onBackground: "#181C1C",
  surface: "#F5FAFA",
  onSurface: "#181C1C",
  surfaceVariant: "#DAE5E3",
  onSurfaceVariant: "#3F4947",
  outline: "#6F7978",
  outlineVariant: "#BEC9C7",
  shadow: "#000000",
  scrim: "#000000",
  inverseSurface: "#2D3131",
  inverseOnSurface: "#ECF2F1",
  inversePrimary: "#7ED6CC",
  surfaceDim: "#D6DBDA",
  surfaceBright: "#F5FAFA",
  surfaceContainerLowest: "#FBFFFF",
  surfaceContainerLow: "#EFF5F4",
  surfaceContainer: "#E9EFEE",
  surfaceContainerHigh: "#E4E9E8",
  surfaceContainerHighest: "#DEE4E3"
};

/** Dark scheme, same seed; surface stays tinted like the app's #111315. */
export const mdColorSchemeDark: MdColorScheme = {
  primary: "#7ED6CC",
  onPrimary: "#003B36",
  primaryContainer: "#00534C",
  onPrimaryContainer: "#9AF2E8",
  secondary: "#B2CCC8",
  onSecondary: "#1E3432",
  secondaryContainer: "#344B48",
  onSecondaryContainer: "#CDE8E4",
  tertiary: "#9ECCEF",
  onTertiary: "#04334F",
  tertiaryContainer: "#1F4A68",
  onTertiaryContainer: "#C7E7FF",
  error: "#FFB4A9",
  onError: "#780000",
  errorContainer: "#970000",
  onErrorContainer: "#FFDAD5",
  background: "#101414",
  onBackground: "#DEE4E3",
  surface: "#101414",
  onSurface: "#DEE4E3",
  surfaceVariant: "#3F4947",
  onSurfaceVariant: "#BEC9C7",
  outline: "#899391",
  outlineVariant: "#3F4947",
  shadow: "#000000",
  scrim: "#000000",
  inverseSurface: "#DEE4E3",
  inverseOnSurface: "#2D3131",
  inversePrimary: "#006B63",
  surfaceDim: "#101414",
  surfaceBright: "#363A39",
  surfaceContainerLowest: "#0B0F0E",
  surfaceContainerLow: "#181C1C",
  surfaceContainer: "#1C2020",
  surfaceContainerHigh: "#272B2A",
  surfaceContainerHighest: "#313635"
};

/** Maps a color role to its CSS custom property name (--md-sys-color-*). */
export function mdColorCssVar(role: MdColorRole): string {
  return `--md-sys-color-${kebabCase(role)}`;
}

function kebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export type MdTypeScaleRole =
  | "displayLarge"
  | "displayMedium"
  | "displaySmall"
  | "headlineLarge"
  | "headlineMedium"
  | "headlineSmall"
  | "titleLarge"
  | "titleMedium"
  | "titleSmall"
  | "bodyLarge"
  | "bodyMedium"
  | "bodySmall"
  | "labelLarge"
  | "labelMedium"
  | "labelSmall";

export interface MdTypeScaleEntry {
  /** Font size in px. */
  fontSize: number;
  /** Line height in px. */
  lineHeight: number;
  fontWeight: number;
  /** Letter spacing in px. */
  letterSpacing: number;
}

export type MdTypeScale = Record<MdTypeScaleRole, MdTypeScaleEntry>;

/** The M3 2021 type scale (identical in light and dark). */
export const mdTypeScale: MdTypeScale = {
  displayLarge: { fontSize: 57, lineHeight: 64, fontWeight: 400, letterSpacing: -0.25 },
  displayMedium: { fontSize: 45, lineHeight: 52, fontWeight: 400, letterSpacing: 0 },
  displaySmall: { fontSize: 36, lineHeight: 44, fontWeight: 400, letterSpacing: 0 },
  headlineLarge: { fontSize: 32, lineHeight: 40, fontWeight: 400, letterSpacing: 0 },
  headlineMedium: { fontSize: 28, lineHeight: 36, fontWeight: 400, letterSpacing: 0 },
  headlineSmall: { fontSize: 24, lineHeight: 32, fontWeight: 400, letterSpacing: 0 },
  titleLarge: { fontSize: 22, lineHeight: 28, fontWeight: 400, letterSpacing: 0 },
  titleMedium: { fontSize: 16, lineHeight: 24, fontWeight: 500, letterSpacing: 0.15 },
  titleSmall: { fontSize: 14, lineHeight: 20, fontWeight: 500, letterSpacing: 0.1 },
  bodyLarge: { fontSize: 16, lineHeight: 24, fontWeight: 400, letterSpacing: 0.5 },
  bodyMedium: { fontSize: 14, lineHeight: 20, fontWeight: 400, letterSpacing: 0.25 },
  bodySmall: { fontSize: 12, lineHeight: 16, fontWeight: 400, letterSpacing: 0.4 },
  labelLarge: { fontSize: 14, lineHeight: 20, fontWeight: 500, letterSpacing: 0.1 },
  labelMedium: { fontSize: 12, lineHeight: 16, fontWeight: 500, letterSpacing: 0.5 },
  labelSmall: { fontSize: 11, lineHeight: 16, fontWeight: 500, letterSpacing: 0.5 }
};

/** Maps a type-scale role to its CSS custom property prefix. */
export function mdTypeScaleCssVarPrefix(role: MdTypeScaleRole): string {
  return `--md-sys-typescale-${kebabCase(role)}`;
}

export type MdShapeToken =
  | "none"
  | "extraSmall"
  | "small"
  | "medium"
  | "large"
  | "extraLarge"
  | "full";

export type MdShapeScale = Record<MdShapeToken, string>;

/** Corner radii in px. */
export const mdShapeScale: MdShapeScale = {
  none: "0px",
  extraSmall: "4px",
  small: "8px",
  medium: "12px",
  large: "16px",
  extraLarge: "28px",
  full: "999px"
};

/** Maps a shape token to its CSS custom property (--md-sys-shape-corner-*). */
export function mdShapeCssVar(token: MdShapeToken): string {
  return `--md-sys-shape-corner-${kebabCase(token)}`;
}

export type MdElevationLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type MdElevationScale = Record<MdElevationLevel, string>;

/** Box-shadow stacks from the M3 elevation spec (key + ambient shadow). */
export const mdElevation: MdElevationScale = {
  0: "none",
  1: "0px 1px 2px 0px rgba(0, 0, 0, 0.30), 0px 1px 3px 1px rgba(0, 0, 0, 0.15)",
  2: "0px 1px 2px 0px rgba(0, 0, 0, 0.30), 0px 2px 6px 2px rgba(0, 0, 0, 0.15)",
  3: "0px 1px 3px 0px rgba(0, 0, 0, 0.30), 0px 4px 8px 3px rgba(0, 0, 0, 0.15)",
  4: "0px 2px 3px 0px rgba(0, 0, 0, 0.30), 0px 6px 10px 4px rgba(0, 0, 0, 0.15)",
  5: "0px 4px 4px 0px rgba(0, 0, 0, 0.30), 0px 8px 12px 6px rgba(0, 0, 0, 0.15)"
};

export type MdMotionDuration =
  | "short1"
  | "short2"
  | "short3"
  | "short4"
  | "medium1"
  | "medium2"
  | "medium3"
  | "medium4"
  | "long1"
  | "long2"
  | "long3"
  | "long4"
  | "extraLong1"
  | "extraLong2"
  | "extraLong3"
  | "extraLong4";

export type MdMotionDurations = Record<MdMotionDuration, string>;

export const mdMotionDurations: MdMotionDurations = {
  short1: "50ms",
  short2: "100ms",
  short3: "150ms",
  short4: "200ms",
  medium1: "250ms",
  medium2: "300ms",
  medium3: "350ms",
  medium4: "400ms",
  long1: "450ms",
  long2: "500ms",
  long3: "550ms",
  long4: "600ms",
  extraLong1: "700ms",
  extraLong2: "800ms",
  extraLong3: "900ms",
  extraLong4: "1000ms"
};

export type MdMotionEasing =
  | "standard"
  | "standardAccelerate"
  | "standardDecelerate"
  | "emphasized"
  | "emphasizedAccelerate"
  | "emphasizedDecelerate"
  | "linear";

export type MdMotionEasings = Record<MdMotionEasing, string>;

export const mdMotionEasings: MdMotionEasings = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  standardAccelerate: "cubic-bezier(0.3, 0, 1, 1)",
  standardDecelerate: "cubic-bezier(0, 0, 0, 1)",
  emphasized: "cubic-bezier(0.2, 0, 0, 1)",
  emphasizedAccelerate: "cubic-bezier(0.3, 0, 0.8, 0.15)",
  emphasizedDecelerate: "cubic-bezier(0.05, 0.7, 0.1, 1)",
  linear: "linear"
};

/** Maps a motion duration to its CSS custom property. */
export function mdDurationCssVar(duration: MdMotionDuration): string {
  return `--md-sys-motion-duration-${kebabCase(duration)}`;
}

/** Maps a motion easing to its CSS custom property. */
export function mdEasingCssVar(easing: MdMotionEasing): string {
  return `--md-sys-motion-easing-${kebabCase(easing)}`;
}
