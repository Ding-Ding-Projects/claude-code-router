/**
 * Material Design 3 tokens for the desktop shell chrome (window frame,
 * title bar overlay, tray popover surface).
 *
 * These are main-process constants so native chrome can match the M3
 * management UI without importing anything from the renderer bundle. Values
 * follow the M3 baseline color roles:
 * https://m3.material.io/styles/color/system/overview
 */

export type M3ColorScheme = "dark" | "light";

/** M3 baseline spacing scale on the 4dp grid. */
export const m3Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
} as const;

export type M3SpacingToken = keyof typeof m3Spacing;

/**
 * M3 baseline `surface` and `on-surface` color roles per scheme. The window
 * title bar overlay paints `surface`; caption button glyphs paint
 * `on-surface`.
 */
export const m3SurfaceColors: Record<M3ColorScheme, { onSurface: string; surface: string }> = {
  dark: {
    onSurface: "#e6e1e5",
    surface: "#1c1b1f"
  },
  light: {
    onSurface: "#1d1b20",
    surface: "#fffbfe"
  }
};

export function m3ColorSchemeForDarkColors(shouldUseDarkColors: boolean): M3ColorScheme {
  return shouldUseDarkColors ? "dark" : "light";
}

export function m3SurfaceForScheme(scheme: M3ColorScheme): string {
  return m3SurfaceColors[scheme].surface;
}

/**
 * Windows title bar overlay colors for a scheme. Only `color` and
 * `symbolColor` are set: the overlay height stays on Windows' own DPI-aware
 * caption metrics instead of a fixed pixel value.
 */
export function m3TitleBarOverlayOptions(
  scheme: M3ColorScheme
): { color: string; symbolColor: string } {
  return {
    color: m3SurfaceColors[scheme].surface,
    symbolColor: m3SurfaceColors[scheme].onSurface
  };
}
