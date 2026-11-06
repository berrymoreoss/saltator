/**
 * The camera maps world coordinates (grid cells) to screen coordinates (CSS pixels of the canvas)
 * and back: `screen = (world − origin) × scale`. Values are immutable; every operation returns a
 * new camera. Spec: docs/editor.md#camera.
 */
import type { Point, Rect } from '../circuit';

export interface Camera {
  /** World point at the canvas's top-left corner. */
  readonly x: number;
  readonly y: number;
  /** Screen pixels per grid cell. */
  readonly scale: number;
}

/** Size of the canvas in CSS pixels. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Screen pixels per cell at 100 % zoom. */
export const BASE_SCALE = 16;
/** Zoom limits: 12.5 % … 1600 %. */
export const MIN_SCALE = 2;
export const MAX_SCALE = 256;
/** Zoom-to-fit never magnifies beyond 200 %, so a lone part doesn't fill the screen. */
export const MAX_FIT_SCALE = 32;
/** One keyboard/menu zoom step. */
export const ZOOM_STEP = Math.SQRT2;

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, scale: BASE_SCALE };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function toScreen(camera: Camera, world: Point): Point {
  return [(world[0] - camera.x) * camera.scale, (world[1] - camera.y) * camera.scale];
}

export function toWorld(camera: Camera, screen: Point): Point {
  return [screen[0] / camera.scale + camera.x, screen[1] / camera.scale + camera.y];
}

/** The world rectangle the viewport shows (fractional). */
export function visibleRect(camera: Camera, viewport: Viewport): Rect {
  return {
    x: camera.x,
    y: camera.y,
    width: viewport.width / camera.scale,
    height: viewport.height / camera.scale,
  };
}

/** Zoom percentage shown to the user (100 % = `BASE_SCALE`). */
export function zoomPercent(camera: Camera): number {
  return Math.round((camera.scale / BASE_SCALE) * 100);
}

/** Moves the view by a screen distance (dragging the canvas by `dx`, `dy` moves the world). */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x - dx / camera.scale, y: camera.y - dy / camera.scale };
}

/** Sets the scale (clamped) keeping the world point under `anchor` (screen) where it is. */
export function zoomTo(camera: Camera, scale: number, anchor: Point): Camera {
  const next = clampScale(scale);
  const [wx, wy] = toWorld(camera, anchor);
  return { x: wx - anchor[0] / next, y: wy - anchor[1] / next, scale: next };
}

/** Multiplies the scale by `factor` about a screen point (wheel and pinch zoom). */
export function zoomAt(camera: Camera, factor: number, anchor: Point): Camera {
  return zoomTo(camera, camera.scale * factor, anchor);
}

/**
 * One zoom step in or out about a screen point: to the next level of the √2 ladder through
 * 100 % (…, 70.7 %, 100 %, 141 %, 200 %, …), so stepping from any scale lands on round levels.
 */
export function zoomStep(camera: Camera, direction: 1 | -1, anchor: Point): Camera {
  const level = Math.log(camera.scale / BASE_SCALE) / Math.log(ZOOM_STEP);
  const epsilon = 1e-6;
  const next = direction > 0 ? Math.floor(level + epsilon) + 1 : Math.ceil(level - epsilon) - 1;
  return zoomTo(camera, BASE_SCALE * ZOOM_STEP ** next, anchor);
}

/** Centers the world point `center` in the viewport at the given scale. */
export function centerOn(center: Point, viewport: Viewport, scale: number): Camera {
  const s = clampScale(scale);
  return {
    x: center[0] - viewport.width / 2 / s,
    y: center[1] - viewport.height / 2 / s,
    scale: s,
  };
}

/**
 * A camera showing the whole world rectangle centered, with `padding` screen pixels around it,
 * at most `MAX_FIT_SCALE`. An empty viewport keeps the current scale.
 */
export function fitRect(rect: Rect, viewport: Viewport, padding = 32): Camera {
  const availableW = Math.max(1, viewport.width - 2 * padding);
  const availableH = Math.max(1, viewport.height - 2 * padding);
  const scale = Math.min(
    MAX_FIT_SCALE,
    availableW / Math.max(rect.width, 1),
    availableH / Math.max(rect.height, 1),
  );
  return centerOn([rect.x + rect.width / 2, rect.y + rect.height / 2], viewport, scale);
}
