/**
 * The drawing surface symbol drawers use: a small subset of the Canvas 2D path API in a part's
 * local grid coordinates, with semantic paints instead of colors and text that stays readable
 * whatever the placement. The canvas implementation applies the placement and camera; a
 * recording implementation backs the tests. Spec: docs/editor.md#symbol-drawing.
 */
import type { Placement, Point, Rect } from '../circuit';
import type { TextRun } from '../core';
import type { Camera } from './camera';
import type { TextAlign, TextBaseline } from './text-placement';
import type { CanvasTheme } from './theme';

/**
 * `line`: outlines (the default stroke); `body`: body fill; `ink`: solid marks in the line color
 * (arrow heads, ground bars); `pin`: pin stubs; `text`, `pinText`: text; anything else is a CSS
 * color (an LED's color).
 */
export type Paint = 'line' | 'body' | 'ink' | 'pin' | 'bus' | 'text' | 'pinText' | (string & {});

export interface TextStyle {
  /** Font size in cells. */
  readonly size: number;
  readonly align?: TextAlign;
  readonly baseline?: TextBaseline;
  /** Reading direction in local coordinates: 0 along +x, 90 along +y. */
  readonly rotate?: 0 | 90;
  readonly paint?: Paint;
  readonly font?: 'sans' | 'mono';
  readonly bold?: boolean;
  /**
   * Draw a bar over the text (active-low pin names): all of it, or the character ranges given
   * (`[from, to)`, `1R̅D̅`: `[[1, 3]]`).
   */
  readonly overline?: boolean | readonly OverlineRange[];
  /** Skip the text when smaller than this on screen, in px (default 4). */
  readonly minPx?: number;
}

/** How a block of lines is drawn (`SymbolGraphics.textBlock`); lengths in cells. */
export interface TextBlockStyle {
  /** Font size. */
  readonly size: number;
  /** Distance between the lines' middles. */
  readonly lineHeight: number;
  /** Room between the box's starting edge and the lines. */
  readonly padding: number;
  readonly font?: 'sans' | 'mono';
  readonly paint?: Paint;
  /** Skip the block when its text is smaller than this on screen, in px (default 4). */
  readonly minPx?: number;
}

/** Characters `[from, to)` of a text with a bar over them. */
export type OverlineRange = readonly [from: number, to: number];

/** A text with marked overlines (`pinTextRuns`) as plain text and the style's `overline`. */
export function overlinedText(runs: readonly TextRun[]): {
  readonly text: string;
  readonly overline: boolean | readonly OverlineRange[];
} {
  const ranges: OverlineRange[] = [];
  let text = '';
  for (const run of runs) {
    if (run.overline) ranges.push([text.length, text.length + run.text.length]);
    text += run.text;
  }
  const whole = ranges.length === 1 && ranges[0]![0] === 0 && ranges[0]![1] === text.length;
  return { text, overline: whole || (ranges.length > 0 && ranges) };
}

/**
 * A picture of `width × height` pixels (RGBA, row by row) a drawer hands `image`: a TFT's glass.
 * Treat it as immutable — implementations may cache what they make of it by identity, so a
 * changed picture is a new object.
 */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

export interface SymbolGraphics {
  /** Screen pixels per cell, for level-of-detail decisions. */
  readonly scale: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  /** Angles in radians, clockwise on screen (y grows downwards). */
  arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  closePath(): void;
  /** Strokes the current path; `width` in cells (default: the part line width). */
  stroke(paint?: Paint, width?: number): void;
  fill(paint: Paint): void;
  /** Dashed strokes until reset with an empty array; lengths in cells. */
  setDash(segments: readonly number[]): void;
  text(text: string, x: number, y: number, style: TextStyle): void;
  /**
   * Lines of text in a box of local cells, upright on screen whatever the placement: they read
   * left to right from the top of the placed box down — or bottom to top from its left edge,
   * when the part lies on its side — so a rotated or flipped block keeps its lines in order. The
   * text isn't clipped to the box. Empty lines take their room.
   */
  textBlock(lines: readonly string[], box: Rect, style: TextBlockStyle): void;
  /**
   * Draws `image` scaled into the box of local cells, turned and mirrored with the part.
   * Magnified, its pixels stay sharp squares; reduced, they are smoothed.
   */
  image(image: RasterImage, x: number, y: number, width: number, height: number): void;
}

/** Line width of part outlines, in cells (1.6 px at 100 %). */
export const LINE_WIDTH = 0.1;
/** Wires are a little heavier than outlines. */
export const WIRE_WIDTH = 0.125;
/** Bus lines are much heavier than wires, as schematics draw them. */
export const BUS_WIDTH = 0.3;
/** Thin lines never get thinner than this on screen, in CSS px. */
export const MIN_LINE_PX = 1;

/** Canvas `transform()` arguments `[a, b, c, d, e, f]` of a placement (mirror, rotate, move). */
export function placementMatrix(
  placement: Placement,
): [number, number, number, number, number, number] {
  const m = placement.flip ? -1 : 1;
  const [e, f] = placement.origin;
  switch (placement.rotation) {
    case 0:
      return [m, 0, 0, 1, e, f];
    case 90:
      return [0, m, -1, 0, e, f];
    case 180:
      return [-m, 0, 0, -1, e, f];
    case 270:
      return [0, -m, 1, 0, e, f];
  }
}

/** Applies the linear part of a placement (no translation) to a direction. */
function direction(placement: Placement, v: Point): Point {
  const [a, b, c, d] = placementMatrix(placement);
  return [a * v[0] + c * v[1], b * v[0] + d * v[1]];
}

/**
 * How to draw text so it reads left-to-right or bottom-to-top on screen, never upside down or
 * mirrored: the screen rotation (0 or −90°) and the alignment/baseline after the placement.
 */
export function uprightText(
  placement: Placement,
  style: Pick<TextStyle, 'rotate' | 'align' | 'baseline'>,
): { angle: 0 | -90; align: TextAlign; baseline: TextBaseline } {
  const along: Point = style.rotate === 90 ? [0, 1] : [1, 0];
  const across: Point = style.rotate === 90 ? [-1, 0] : [0, 1];
  const reading = direction(placement, along);
  const down = direction(placement, across);
  // Screen axes of upright text: horizontal reads +x (down = +y); vertical reads −y (down = +x).
  const horizontal = reading[1] === 0;
  const angle = horizontal ? 0 : -90;
  const textX: Point = horizontal ? [1, 0] : [0, -1];
  const textY: Point = horizontal ? [0, 1] : [1, 0];
  const sameX = reading[0] * textX[0] + reading[1] * textX[1] > 0;
  const sameY = down[0] * textY[0] + down[1] * textY[1] > 0;
  const align = style.align ?? 'left';
  const baseline = style.baseline ?? 'middle';
  return {
    angle,
    align: sameX || align === 'center' ? align : align === 'left' ? 'right' : 'left',
    baseline: sameY || baseline === 'middle' ? baseline : baseline === 'top' ? 'bottom' : 'top',
  };
}

export const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Draws on a 2D canvas context in a part's local coordinates (or world, with no placement). */
export class CanvasGraphics implements SymbolGraphics {
  readonly ctx: CanvasRenderingContext2D;
  readonly camera: Camera;
  readonly dpr: number;
  readonly theme: CanvasTheme;
  #placement: Placement = { origin: [0, 0], rotation: 0, flip: false };
  /** Replaces the line and ink color (selected parts). */
  highlight: string | undefined;

  constructor(ctx: CanvasRenderingContext2D, camera: Camera, dpr: number, theme: CanvasTheme) {
    this.ctx = ctx;
    this.camera = camera;
    this.dpr = dpr;
    this.theme = theme;
  }

  get scale(): number {
    return this.camera.scale;
  }

  /** World coordinates (no placement). */
  world(): void {
    this.place({ origin: [0, 0], rotation: 0, flip: false });
  }

  /** Local coordinates of a part placed by `placement`. */
  place(placement: Placement): void {
    this.#placement = placement;
    const { scale, x, y } = this.camera;
    const k = scale * this.dpr;
    this.ctx.setTransform(k, 0, 0, k, -x * k, -y * k);
    this.ctx.transform(...placementMatrix(placement));
  }

  paint(paint: Paint): string {
    const t = this.theme;
    switch (paint) {
      case 'line':
      case 'ink':
        return this.highlight ?? t.partStroke;
      case 'body':
        return t.partFill;
      case 'pin':
        return this.highlight ?? t.pin;
      case 'bus':
        return this.highlight ?? t.bus;
      case 'text':
        return this.highlight ?? t.text;
      case 'pinText':
        return t.pinText;
      default:
        return paint;
    }
  }

  beginPath(): void {
    this.ctx.beginPath();
  }
  moveTo(x: number, y: number): void {
    this.ctx.moveTo(x, y);
  }
  lineTo(x: number, y: number): void {
    this.ctx.lineTo(x, y);
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false): void {
    this.ctx.arc(x, y, r, start, end, ccw);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.ctx.quadraticCurveTo(cx, cy, x, y);
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.ctx.rect(x, y, width, height);
  }
  closePath(): void {
    this.ctx.closePath();
  }

  stroke(paint: Paint = 'line', width = LINE_WIDTH): void {
    const { ctx } = this;
    ctx.strokeStyle = this.paint(paint);
    ctx.lineWidth = Math.max(width, MIN_LINE_PX / this.scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  fill(paint: Paint): void {
    this.ctx.fillStyle = this.paint(paint);
    this.ctx.fill();
  }

  setDash(segments: readonly number[]): void {
    this.ctx.setLineDash(segments as number[]);
  }

  image(image: RasterImage, x: number, y: number, width: number, height: number): void {
    const source = rasterCanvas(image);
    if (!source) return;
    const ctx = this.ctx;
    const devicePerPixel = (width / image.width) * this.camera.scale * this.dpr;
    ctx.imageSmoothingEnabled = devicePerPixel < 1;
    ctx.drawImage(source, x, y, width, height);
  }

  text(text: string, x: number, y: number, style: TextStyle): void {
    const px = style.size * this.scale;
    if (px < (style.minPx ?? 4) || text === '') return;
    const { ctx, camera, dpr } = this;
    const [a, b, c, d, e, f] = placementMatrix(this.#placement);
    const wx = a * x + c * y + e;
    const wy = b * x + d * y + f;
    const sx = (wx - camera.x) * camera.scale * dpr;
    const sy = (wy - camera.y) * camera.scale * dpr;
    const { angle, align, baseline } = uprightText(this.#placement, style);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, sx, sy);
    if (angle !== 0) ctx.rotate((angle * Math.PI) / 180);
    ctx.font = `${style.bold ? '600 ' : ''}${px}px ${style.font === 'mono' ? MONO : SANS}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillStyle = this.paint(style.paint ?? 'text');
    ctx.fillText(text, 0, 0);
    if (style.overline) {
      const width = ctx.measureText(text).width;
      const x0 = align === 'left' ? 0 : align === 'right' ? -width : -width / 2;
      const top = baseline === 'top' ? 0 : baseline === 'bottom' ? -px : -px / 2;
      const bar = (from: number, to: number) =>
        ctx.fillRect(from, top - px * 0.08, to - from, Math.max(1, px * 0.08));
      if (style.overline === true) bar(x0, x0 + width);
      else {
        const at = (i: number) => x0 + ctx.measureText(text.slice(0, i)).width;
        for (const [from, to] of style.overline) bar(at(from), at(to));
      }
    }
    ctx.restore();
  }

  textBlock(lines: readonly string[], box: Rect, style: TextBlockStyle): void {
    const px = style.size * this.scale;
    if (px < (style.minPx ?? 4)) return;
    const { ctx, camera, dpr } = this;
    const [a, b, c, d, e, f] = placementMatrix(this.#placement);
    const x0 = a * box.x + c * box.y + e;
    const y0 = b * box.x + d * box.y + f;
    const x1 = a * (box.x + box.width) + c * (box.y + box.height) + e;
    const y1 = b * (box.x + box.width) + d * (box.y + box.height) + f;
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    // A quarter turn lays the block on its side: it reads upwards, its first line at the left.
    const upright = this.#placement.rotation % 180 === 0;
    ctx.save();
    ctx.font = `${px}px ${style.font === 'mono' ? MONO : SANS}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.paint(style.paint ?? 'text');
    lines.forEach((line, i) => {
      if (line === '') return;
      const across = (i + 0.5) * style.lineHeight;
      const wx = upright ? left + style.padding : left + across;
      const wy = upright ? top + across : bottom - style.padding;
      const sx = (wx - camera.x) * camera.scale * dpr;
      const sy = (wy - camera.y) * camera.scale * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, sx, sy);
      if (!upright) ctx.rotate(-Math.PI / 2);
      ctx.fillText(line, 0, 0);
    });
    ctx.restore();
  }
}

/** The canvas each image was copied into, kept as long as the image is. */
const rasterCanvases = new WeakMap<RasterImage, HTMLCanvasElement | OffscreenCanvas>();

/** `image` on a canvas of its own, made once per image object (undefined without a DOM). */
function rasterCanvas(image: RasterImage): HTMLCanvasElement | OffscreenCanvas | undefined {
  const cached = rasterCanvases.get(image);
  if (cached) return cached;
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(image.width, image.height);
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
  } else {
    return undefined;
  }
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return undefined;
  const data = new ImageData(image.width, image.height);
  data.data.set(image.rgba);
  ctx.putImageData(data, 0, 0);
  rasterCanvases.set(image, canvas);
  return canvas;
}
