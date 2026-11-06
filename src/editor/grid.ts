/**
 * Adaptive grid: dots at every cell when cells are big enough on screen, otherwise at a coarser
 * step, with stronger dots at a major step.
 */

/** Dots closer than this on screen are thinned out, in CSS px. */
export const MIN_DOT_SPACING = 8;

const STEPS = [1, 5, 10, 50, 100, 500, 1000] as const;

export interface GridSpacing {
  /** Cells between dots. */
  readonly step: number;
  /** Cells between major dots (a multiple of `step`). */
  readonly major: number;
}

export function gridSpacing(scale: number): GridSpacing {
  const step = STEPS.find((s) => s * scale >= MIN_DOT_SPACING) ?? STEPS[STEPS.length - 1]!;
  return { step, major: step < 10 ? 10 : step * 10 };
}
