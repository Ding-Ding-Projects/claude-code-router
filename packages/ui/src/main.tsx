import { type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { M3ThemeProvider } from "@/styles/m3";

/*
 * Shared renderer bootstrap. Every page entry (the per-page main.tsx files)
 * mounts through here so the Material 3 theme provider wraps the whole tree
 * and data-md-theme lands on <html> before first paint.
 */
export function mountAppRoot(children: ReactNode): void {
  const container = document.getElementById("root");

  if (!container) {
    throw new Error("Root element not found");
  }

  createRoot(container).render(<M3ThemeProvider>{children}</M3ThemeProvider>);
}
