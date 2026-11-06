/**
 * Logic gate drawers: AND, OR, XOR families with optional inversion, buffer, inverter and
 * tri-state buffer, in ANSI/IEEE 91 distinctive shapes or IEC 60617 rectangles. The geometry
 * (body, pins) is the library's; only the drawing differs between styles.
 *
 * ANSI shapes keep a standard 4-cell height centered on the output; gates with more inputs than
 * fit extend their input side with straight lines (IEEE 91 "extended input"), and each input
 * stub is continued to the shape's back edge.
 */
import type { Rect } from '../../circuit';
import type { SymbolGraphics } from '../graphics';
import type { DrawContext, Drawer } from './types';

/** Radius of an inversion bubble, in cells. */
export const BUBBLE = 0.3;
/** Height of the ANSI gate shape, in cells. */
const SHAPE_HEIGHT = 4;

type Family = 'and' | 'or' | 'xor';

function bubble(g: SymbolGraphics, x: number, y: number): void {
  g.beginPath();
  g.arc(x + BUBBLE, y, BUBBLE, 0, Math.PI * 2);
  g.fill('body');
  g.stroke();
}

/** Input pin rows (local y) on the body's left edge. */
function inputRows(c: DrawContext): number[] {
  return c.layout.pins.filter((p) => p.side === 'left').map((p) => p.at[1]);
}

/** The ANSI shape's vertical extent: SHAPE_HEIGHT centered on the body, or the body if shorter. */
function shapeSpan(body: Rect): { top: number; bottom: number; mid: number } {
  const mid = body.y + body.height / 2;
  const half = Math.min(SHAPE_HEIGHT, body.height) / 2;
  return { top: mid - half, bottom: mid + half, mid };
}

/** x of the OR/XOR concave back curve at row y (a quadratic bulging `depth` into the body). */
function backCurveX(x: number, top: number, bottom: number, depth: number, y: number): number {
  const t = (y - top) / (bottom - top);
  if (t <= 0 || t >= 1) return x;
  // Quadratic Bézier from (x, top) via (x + 2·depth, mid) to (x, bottom): x(t) = x + 4·depth·t(1−t).
  return x + 4 * depth * t * (1 - t);
}

function ansiGate(g: SymbolGraphics, c: DrawContext, family: Family, inverted: boolean): void {
  const { body } = c;
  const { top, bottom, mid } = shapeSpan(body);
  const right = body.x + body.width - (inverted ? 2 * BUBBLE : 0);
  const half = (bottom - top) / 2;
  // OR and XOR shapes start a little in for XOR's extra back curve.
  const back = family === 'xor' ? body.x + 0.5 : body.x;
  const depth = 0.5;

  // Extended input side above and below the shape.
  if (body.height > bottom - top) {
    g.beginPath();
    g.moveTo(body.x, body.y);
    g.lineTo(body.x, top);
    g.moveTo(body.x, bottom);
    g.lineTo(body.x, body.y + body.height);
    g.stroke();
  }

  g.beginPath();
  if (family === 'and') {
    const flat = Math.max(body.x, right - half);
    g.moveTo(body.x, top);
    g.lineTo(flat, top);
    g.arc(flat, mid, half, -Math.PI / 2, Math.PI / 2);
    g.lineTo(body.x, bottom);
    g.closePath();
  } else {
    const length = right - back;
    g.moveTo(back, top);
    g.bezierCurveTo(
      back + length * 0.55,
      top,
      right - length * 0.15,
      mid - half * 0.45,
      right,
      mid,
    );
    g.bezierCurveTo(
      right - length * 0.15,
      mid + half * 0.45,
      back + length * 0.55,
      bottom,
      back,
      bottom,
    );
    g.quadraticCurveTo(back + 2 * depth, mid, back, top);
    g.closePath();
  }
  g.fill('body');
  g.stroke();

  if (family === 'xor') {
    g.beginPath();
    g.moveTo(body.x, top);
    g.quadraticCurveTo(body.x + 2 * depth, mid, body.x, bottom);
    g.stroke();
  }

  // Continue input stubs from the body edge to a curved back.
  if (family !== 'and') {
    g.beginPath();
    for (const y of inputRows(c)) {
      const x = backCurveX(back, top, bottom, depth, y);
      if (x - body.x > 0.01) {
        g.moveTo(body.x, y);
        g.lineTo(x, y);
      }
    }
    g.stroke('pin');
  }

  if (inverted) bubble(g, right, mid);
}

const IEC_QUALIFIER: Readonly<Record<Family | 'buffer', string>> = {
  and: '&',
  or: '≥1',
  xor: '=1',
  buffer: '1',
};

function iecBox(
  g: SymbolGraphics,
  body: Rect,
  qualifier: string,
  inverted: boolean,
  outputY: number,
): void {
  const right = body.x + body.width - (inverted ? 2 * BUBBLE : 0);
  g.beginPath();
  g.rect(body.x, body.y, right - body.x, body.height);
  g.fill('body');
  g.stroke();
  g.text(qualifier, (body.x + right) / 2, body.y + 0.35, {
    size: 0.8,
    align: 'center',
    baseline: 'top',
    paint: 'line',
  });
  if (inverted) bubble(g, right, outputY);
}

function gate(family: Family, inverted: boolean): Drawer {
  return (g, c) => {
    if (c.gateStyle === 'iec') {
      iecBox(g, c.body, IEC_QUALIFIER[family], inverted, c.body.y + c.body.height / 2);
    } else {
      ansiGate(g, c, family, inverted);
    }
  };
}

/** A triangle pointing right over the body's height, apex at `right`. */
function triangle(g: SymbolGraphics, body: Rect, right: number): void {
  g.beginPath();
  g.moveTo(body.x, body.y);
  g.lineTo(right, body.y + body.height / 2);
  g.lineTo(body.x, body.y + body.height);
  g.closePath();
  g.fill('body');
  g.stroke();
}

function oneInput(inverted: boolean): Drawer {
  return (g, { body, gateStyle }) => {
    const right = body.x + body.width - (inverted ? 2 * BUBBLE : 0);
    const mid = body.y + body.height / 2;
    if (gateStyle === 'iec') {
      iecBox(g, body, IEC_QUALIFIER.buffer, inverted, mid);
      return;
    }
    triangle(g, body, right);
    if (inverted) bubble(g, right, mid);
  };
}

/**
 * Tri-state buffer: A on the left, Y on the right, EN entering from below. The triangle is as
 * tall as the body (2 cells); the EN stub is continued up to its slanted edge.
 */
const tristate: Drawer = (g, c) => {
  const { body } = c;
  const en = c.layout.pins.find((p) => p.side === 'bottom');
  const enX = en?.at[0] ?? body.x + body.width / 2;
  const bottom = body.y + body.height;
  if (c.gateStyle === 'iec') {
    iecBox(g, body, '1', false, body.y + body.height / 2);
    g.text('▽', body.x + body.width - 0.3, body.y + body.height / 2, {
      size: 0.6,
      align: 'right',
      baseline: 'middle',
      paint: 'line',
    });
    g.text('EN', enX, bottom - 0.15, {
      size: 0.45,
      align: 'center',
      baseline: 'bottom',
      paint: 'pinText',
      minPx: 6,
    });
    return;
  }
  const right = body.x + body.width - 1;
  triangle(g, { ...body, width: right - body.x }, right);
  // The slanted lower edge at the EN column: y = bottom − (x − left) · height / 2 / width.
  const t = (enX - body.x) / (right - body.x);
  const edgeY = bottom - (t * body.height) / 2;
  g.beginPath();
  g.moveTo(enX, bottom);
  g.lineTo(enX, edgeY);
  g.moveTo(right, body.y + body.height / 2);
  g.lineTo(body.x + body.width, body.y + body.height / 2);
  g.stroke('pin');
};

export const GATE_DRAWERS: Readonly<Record<string, Drawer>> = {
  'gate-and': gate('and', false),
  'gate-nand': gate('and', true),
  'gate-or': gate('or', false),
  'gate-nor': gate('or', true),
  'gate-xor': gate('xor', false),
  'gate-xnor': gate('xor', true),
  buffer: oneInput(false),
  not: oneInput(true),
  'tristate-buffer': tristate,
};
