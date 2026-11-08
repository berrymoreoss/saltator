/**
 * A `SymbolGraphics` that records instead of drawing, for tests: every point a path passes
 * through (curve control points, sampled arcs, rectangle and image corners), every text, text
 * block and image, and how many strokes and fills were made.
 */
import type { Point, Rect } from '../circuit';
import type { Paint, RasterImage, SymbolGraphics, TextBlockStyle, TextStyle } from './graphics';

export interface RecordedText {
  readonly text: string;
  readonly at: Point;
  readonly style: TextStyle;
}

export interface RecordedTextBlock {
  readonly lines: readonly string[];
  readonly box: Rect;
  readonly style: TextBlockStyle;
}

export interface RecordedImage {
  readonly image: RasterImage;
  readonly box: Rect;
}

export class RecordingGraphics implements SymbolGraphics {
  readonly scale: number;
  readonly points: Point[] = [];
  readonly texts: RecordedText[] = [];
  readonly textBlocks: RecordedTextBlock[] = [];
  readonly paints: Paint[] = [];
  readonly images: RecordedImage[] = [];
  strokes = 0;
  fills = 0;

  constructor(scale = 16) {
    this.scale = scale;
  }

  beginPath(): void {}
  closePath(): void {}
  moveTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false): void {
    // Sample the arc the way Canvas draws it: from start to end, clockwise unless ccw.
    let sweep = end - start;
    if (!ccw && sweep < 0) sweep += Math.PI * 2;
    if (ccw && sweep > 0) sweep -= Math.PI * 2;
    if (Math.abs(sweep) > Math.PI * 2) sweep = Math.sign(sweep) * Math.PI * 2;
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const a = start + (sweep * i) / steps;
      this.points.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
    }
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.points.push([cx, cy], [x, y]);
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.points.push([c1x, c1y], [c2x, c2y], [x, y]);
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.points.push([x, y], [x + width, y + height]);
  }
  stroke(paint: Paint = 'line'): void {
    this.strokes++;
    this.paints.push(paint);
  }
  fill(paint: Paint): void {
    this.fills++;
    this.paints.push(paint);
  }
  setDash(): void {}
  text(text: string, x: number, y: number, style: TextStyle): void {
    this.texts.push({ text, at: [x, y], style });
  }
  textBlock(lines: readonly string[], box: Rect, style: TextBlockStyle): void {
    this.textBlocks.push({ lines: [...lines], box, style });
  }
  image(image: RasterImage, x: number, y: number, width: number, height: number): void {
    this.images.push({ image, box: { x, y, width, height } });
    this.points.push([x, y], [x + width, y + height]);
  }
}
