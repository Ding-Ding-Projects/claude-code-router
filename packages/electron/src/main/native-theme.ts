import { nativeTheme } from "electron";
import type { AppConfig } from "@ccr/core/contracts/app";
import { m3ColorSchemeForDarkColors, type M3ColorScheme } from "./m3-chrome";

export function nativeThemeSource(theme: AppConfig["theme"] | undefined): "dark" | "light" | "system" {
  return theme === "light" || theme === "dark" ? theme : "system";
}

export function applyNativeThemePreference(theme: AppConfig["theme"] | undefined): void {
  nativeTheme.themeSource = nativeThemeSource(theme);
}

/** Resolved M3 color scheme after applying the user's preference to the OS value. */
export function resolvedColorScheme(): M3ColorScheme {
  return m3ColorSchemeForDarkColors(nativeTheme.shouldUseDarkColors);
}

/**
 * Invoke `handler` whenever the resolved color scheme flips, including system
 * changes picked up while the preference is "system". Returns an unsubscribe
 * function. Repeated `updated` events without a scheme flip are ignored so
 * chrome repaint handlers stay cheap.
 */
export function subscribeToResolvedColorScheme(handler: (scheme: M3ColorScheme) => void): () => void {
  let lastScheme: M3ColorScheme = resolvedColorScheme();
  const onUpdated = (): void => {
    const nextScheme = resolvedColorScheme();
    if (nextScheme === lastScheme) {
      return;
    }
    lastScheme = nextScheme;
    handler(nextScheme);
  };
  nativeTheme.on("updated", onUpdated);
  return () => {
    nativeTheme.off("updated", onUpdated);
  };
}
