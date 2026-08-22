import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedWindowSize,
  centeredBoundsInWorkArea,
  effectiveMinimumSize,
  fitWindowSize,
  sizeLimitsWithinWorkArea,
  windowWorkAreaCoverageRatio,
  workAreaCoverageLimit
} from "@ccr/electron/main/window-metrics.ts";

test("coverage limit keeps about 95 percent of the usable work area", () => {
  assert.equal(windowWorkAreaCoverageRatio, 0.95);
  assert.equal(workAreaCoverageLimit(1920), 1824);
  assert.equal(workAreaCoverageLimit(1032), 980);
  assert.equal(workAreaCoverageLimit(481), 456);
});

test("declared minimums hold on normal displays", () => {
  // 1920x1080 display at 100% scaling minus a taskbar.
  const workArea = { width: 1920, height: 1032 };
  assert.deepEqual(
    sizeLimitsWithinWorkArea({ minHeight: 420, minWidth: 360 }, workArea),
    { minHeight: 420, minWidth: 360 }
  );
});

test("minimums shrink on small displays so windows can never exceed the screen", () => {
  // 1280x800 laptop at 200% scaling: the DIP work area is roughly 640x380.
  const workArea = { width: 640, height: 380 };
  assert.deepEqual(
    sizeLimitsWithinWorkArea({ minHeight: 420, minWidth: 360 }, workArea),
    { minHeight: 361, minWidth: 360 }
  );
  assert.equal(effectiveMinimumSize(420, 380), 361);
});

test("degenerate work areas keep the declared minimum", () => {
  assert.equal(effectiveMinimumSize(420, 0), 420);
  assert.equal(boundedWindowSize(760, 420, 0), Math.max(420, 760));
});

test("preferred sizes clamp to the coverage limit at every DPI scale", () => {
  // 100% scaling: defaults are untouched.
  assert.equal(boundedWindowSize(1180, 360, 1920), 1180);
  assert.equal(boundedWindowSize(760, 420, 1032), 760);
  // Small DIP work area (high scaling): preferred clamps down to ~95%.
  assert.equal(boundedWindowSize(760, 420, 380), 361);
  assert.equal(boundedWindowSize(1180, 360, 640), 608);
  // A minimum larger than the whole work area collapses to the coverage cap.
  assert.equal(boundedWindowSize(840, 560, 400), 380);
});

test("fitWindowSize preserves its historical semantics", () => {
  assert.equal(fitWindowSize(760, 420, 452), 452);
  assert.equal(fitWindowSize(760, 420, 1000), 760);
  assert.equal(fitWindowSize(1180, 360, -5), 1180);
});

test("centered bounds stay inside the work area", () => {
  const workArea = { x: 100, y: 60, width: 1920, height: 1032 };
  const bounds = centeredBoundsInWorkArea(workArea, 1824, 980);
  assert.equal(bounds.width, 1824);
  assert.equal(bounds.height, 980);
  assert.equal(bounds.x, 100 + Math.round((1920 - 1824) / 2));
  assert.equal(bounds.y, 60 + Math.round((1032 - 980) / 2));
  assert.ok(bounds.x >= workArea.x && bounds.y >= workArea.y);
  assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width);
  assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height);
});

test("centered bounds clamp sizes that would overflow the work area", () => {
  const workArea = { x: 0, y: 0, width: 640, height: 380 };
  const bounds = centeredBoundsInWorkArea(workArea, 1200, 900);
  assert.equal(bounds.width, 640);
  assert.equal(bounds.height, 380);
});
