/**
 * Pure window-sizing math for the desktop shell.
 *
 * All dimensions are device-independent pixels (Electron's screen API reports
 * work areas in DIPs), so clamping against the work area automatically adapts
 * across 100-200% display scaling. This module must stay free of electron
 * imports so the math stays unit-testable outside a running shell.
 */

export type WindowBounds = { height: number; width: number; x?: number; y?: number };
export type RequiredWindowBounds = { height: number; width: number; x: number; y: number };
export type WorkArea = { height: number; width: number; x: number; y: number };

/**
 * Windows never auto-size beyond this fraction of the usable work area, so
 * the shell always fits at any DPI scale (a maximized window still fills the
 * whole work area; this only bounds sizes we compute ourselves).
 */
export const windowWorkAreaCoverageRatio = 0.95;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** Largest window dimension that keeps the stated coverage of the work area. */
export function workAreaCoverageLimit(workAreaDimension: number): number {
  return Math.floor(workAreaDimension * windowWorkAreaCoverageRatio);
}

/**
 * Smallest usable minimum size for a display: the declared minimum unless the
 * work area is too small to contain it, in which case the coverage limit wins
 * so a resizable window can never be forced past the screen edge.
 */
export function effectiveMinimumSize(minimum: number, workAreaDimension: number): number {
  if (!(workAreaDimension > 0)) {
    return minimum;
  }
  return Math.min(minimum, workAreaCoverageLimit(workAreaDimension));
}

/** Clamp a preferred size into [effectiveMinimum, coverageLimit]. */
export function boundedWindowSize(
  preferred: number,
  minimum: number,
  workAreaDimension: number
): number {
  if (!(workAreaDimension > 0)) {
    return Math.max(minimum, preferred);
  }
  return fitWindowSize(
    preferred,
    effectiveMinimumSize(minimum, workAreaDimension),
    workAreaCoverageLimit(workAreaDimension)
  );
}

/** Largest of `preferred` and `minimum` that still fits `available`. */
export function fitWindowSize(preferred: number, minimum: number, available: number): number {
  return Math.max(minimum, Math.min(preferred, available > 0 ? available : preferred));
}

/** Effective minWidth/minHeight options for a BrowserWindow on this work area. */
export function sizeLimitsWithinWorkArea(
  limits: { minHeight: number; minWidth: number },
  workArea: Pick<WorkArea, "height" | "width">
): { minHeight: number; minWidth: number } {
  return {
    minHeight: effectiveMinimumSize(limits.minHeight, workArea.height),
    minWidth: effectiveMinimumSize(limits.minWidth, workArea.width)
  };
}

/** Center `width` x `height` inside the work area without leaving it. */
export function centeredBoundsInWorkArea(
  workArea: WorkArea,
  width: number,
  height: number
): RequiredWindowBounds {
  const safeWidth = Math.max(1, Math.min(width, workArea.width));
  const safeHeight = Math.max(1, Math.min(height, workArea.height));
  return {
    height: safeHeight,
    width: safeWidth,
    x: workArea.x + Math.round((workArea.width - safeWidth) / 2),
    y: workArea.y + Math.round((workArea.height - safeHeight) / 2)
  };
}
