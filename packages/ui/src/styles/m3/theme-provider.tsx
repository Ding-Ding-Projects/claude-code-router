import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type M3ThemePreference = "system" | "light" | "dark";
export type M3ResolvedTheme = "light" | "dark";

/** localStorage key the chosen preference is persisted under. */
export const M3_THEME_STORAGE_KEY = "ccr-md-theme";
/** Attribute on <html> that switches the token set in tokens.css. */
export const M3_THEME_ATTRIBUTE = "data-md-theme";

const VALID_PREFERENCES: readonly M3ThemePreference[] = ["system", "light", "dark"];

function hasDocument(): boolean {
  return typeof document !== "undefined" && !!document.documentElement;
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Reads the persisted preference; anything invalid falls back to "system". */
export function readStoredThemePreference(): M3ThemePreference {
  if (!hasLocalStorage()) {
    return "system";
  }
  try {
    const stored = localStorage.getItem(M3_THEME_STORAGE_KEY);
    return stored && (VALID_PREFERENCES as readonly string[]).includes(stored)
      ? (stored as M3ThemePreference)
      : "system";
  } catch {
    // Private-browsing storage can refuse access; defaulting is correct there.
    return "system";
  }
}

export function resolveTheme(preference: M3ThemePreference): M3ResolvedTheme {
  if (preference === "system") {
    return prefersDark() ? "dark" : "light";
  }
  return preference;
}

/** Writes the resolved theme onto <html> so tokens.css picks a scheme. */
export function applyResolvedTheme(resolved: M3ResolvedTheme): void {
  if (!hasDocument()) {
    return;
  }
  document.documentElement.setAttribute(M3_THEME_ATTRIBUTE, resolved);
}

interface M3ThemeContextValue {
  /** What the user picked ("system" follows prefers-color-scheme). */
  preference: M3ThemePreference;
  /** The scheme currently applied to <html>. */
  resolvedTheme: M3ResolvedTheme;
  setPreference: (preference: M3ThemePreference) => void;
}

const M3ThemeContext = createContext<M3ThemeContextValue | undefined>(undefined);

export interface M3ThemeProviderProps {
  children?: ReactNode;
  /** Overrides the persisted/system preference (useful for previews/tests). */
  defaultPreference?: M3ThemePreference;
}

/**
 * Applies the Material 3 color scheme by setting data-md-theme on <html>.
 * The choice persists to localStorage under "ccr-md-theme"; "system" tracks
 * prefers-color-scheme live.
 */
export function M3ThemeProvider({ children, defaultPreference }: M3ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<M3ThemePreference>(() => {
    if (defaultPreference) {
      return defaultPreference;
    }
    if (hasLocalStorage()) {
      return readStoredThemePreference();
    }
    return "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState<M3ResolvedTheme>(() => resolveTheme(preference));

  useLayoutEffect(() => {
    const next = resolveTheme(preference);
    setResolvedTheme(next);
    applyResolvedTheme(next);
    // Only re-run when the preference changes; media-query changes are handled below.
  }, [preference]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia || preference !== "system") {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = resolveTheme("system");
      setResolvedTheme(next);
      applyResolvedTheme(next);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: M3ThemePreference) => {
    setPreferenceState(next);
    if (hasLocalStorage()) {
      try {
        localStorage.setItem(M3_THEME_STORAGE_KEY, next);
      } catch {
        // Persisting is best-effort; the session still honours the choice.
      }
    }
  }, []);

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme, setPreference]);

  return <M3ThemeContext.Provider value={value}>{children}</M3ThemeContext.Provider>;
}

/** Access the active M3 theme state from anywhere under the provider. */
export function useM3Theme(): M3ThemeContextValue {
  const context = useContext(M3ThemeContext);
  if (!context) {
    throw new Error("useM3Theme must be used inside M3ThemeProvider");
  }
  return context;
}
