import assert from "node:assert/strict";
import test from "node:test";
import {
  m3ColorSchemeForDarkColors,
  m3Spacing,
  m3SurfaceColors,
  m3SurfaceForScheme,
  m3TitleBarOverlayOptions
} from "@ccr/electron/main/m3-chrome.ts";

test("M3 baseline surface roles match the documented light and dark values", () => {
  assert.equal(m3SurfaceColors.light.surface, "#fffbfe");
  assert.equal(m3SurfaceColors.light.onSurface, "#1d1b20");
  assert.equal(m3SurfaceColors.dark.surface, "#1c1b1f");
  assert.equal(m3SurfaceColors.dark.onSurface, "#e6e1e5");
});

test("color scheme resolution follows the system dark-colors flag", () => {
  assert.equal(m3ColorSchemeForDarkColors(true), "dark");
  assert.equal(m3ColorSchemeForDarkColors(false), "light");
});

test("surface lookup resolves per scheme", () => {
  assert.equal(m3SurfaceForScheme("light"), "#fffbfe");
  assert.equal(m3SurfaceForScheme("dark"), "#1c1b1f");
});

test("Windows title bar overlay paints M3 surface with on-surface glyphs", () => {
  assert.deepEqual(m3TitleBarOverlayOptions("dark"), {
    color: "#1c1b1f",
    symbolColor: "#e6e1e5"
  });
  assert.deepEqual(m3TitleBarOverlayOptions("light"), {
    color: "#fffbfe",
    symbolColor: "#1d1b20"
  });
});

test("spacing scale sits on the 4dp grid", () => {
  for (const value of Object.values(m3Spacing)) {
    assert.equal(value % 4, 0, `spacing token ${value} must be a multiple of 4`);
  }
  assert.equal(m3Spacing.sm, 8);
  assert.equal(m3Spacing.md, 12);
});
