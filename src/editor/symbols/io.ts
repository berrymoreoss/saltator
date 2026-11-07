/**
 * Drawers for IO parts: contacts (switch, button, DIP switch), clock, LEDs, LED bar, 7-segment
 * and hex displays, probe. Without a simulation they show the idle look (power-on switch
 * positions, unlit lights); with `live` the state in the simulation: lever and slider positions,
 * a pressed plunger, lights at their average brightness, the digit, the probed level.
 */
import type { Rect } from '../../circuit';
import { Level, levelChar } from '../../core';
import { hexDigit } from '../../library';
import type { SymbolGraphics } from '../graphics';
import { type DrawContext, type Drawer, type PartLive, UNKNOWN_LIGHT } from './types';

/** CSS colors of the `color` prop of LEDs and displays. */
export const LED_COLORS: Readonly<Record<string, string>> = {
  red: '#ff453a',
  green: '#32d74b',
  yellow: '#ffd60a',
  orange: '#ff9f0a',
  blue: '#0a84ff',
  white: '#f2f2f7',
};

/** An LED color as drawn while unlit: the color, mostly transparent. */
export function unlit(color: unknown): string {
  return lit(color, 0);
}

const UNLIT_ALPHA = 0x55;

/** An LED color at a brightness from 0 (unlit) to 1 (fully on). */
export function lit(color: unknown, brightness: number): string {
  const alpha = Math.round(
    UNLIT_ALPHA + (0xff - UNLIT_ALPHA) * Math.min(1, Math.max(0, brightness)),
  );
  return `${LED_COLORS[String(color)] ?? LED_COLORS.red}${alpha.toString(16).padStart(2, '0')}`;
}

/** How light `i` of a part is painted: its brightness, or the `X` color when unknown. */
function lightPaint(c: DrawContext, i: number): { paint: string; brightness: number } {
  const b = c.live?.light(i) ?? 0;
  if (b === UNKNOWN_LIGHT)
    return { paint: `${c.levelColor?.(Level.X) ?? '#ff0000'}99`, brightness: 0 };
  return { paint: lit(c.props.color, b), brightness: b };
}

/** A soft halo around a lit light (no gradients on `SymbolGraphics`: one translucent disc). */
function glow(g: SymbolGraphics, x: number, y: number, r: number, color: unknown, b: number): void {
  if (b <= 0) return;
  const alpha = Math.round(0x48 * b)
    .toString(16)
    .padStart(2, '0');
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill(`${LED_COLORS[String(color)] ?? LED_COLORS.red}${alpha}`);
}

/** A boolean field of a part's live state (`on`, `pressed`). */
function stateFlag(live: PartLive | undefined, key: string): boolean | undefined {
  const state = live?.state;
  if (typeof state !== 'object' || state === null) return undefined;
  const value = (state as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : undefined;
}

const CONTACT_R = 0.12;

function contactDot(g: SymbolGraphics, x: number, y: number): void {
  g.beginPath();
  g.arc(x, y, CONTACT_R, 0, Math.PI * 2);
  g.fill('body');
  g.stroke();
}

/**
 * Switch contacts in a 3×2 body with the pin on the right: the common terminal on the right,
 * the throw(s) on the left — `1` (to VCC) on top, `0` (to GND) below. SPDT has both, SPST one.
 * The lever touches the throw it is closed on, or points between them when open.
 */
function contacts(g: SymbolGraphics, body: Rect, contact: unknown, on: boolean): void {
  const x0 = body.x;
  const y0 = body.y;
  const common: [number, number] = [x0 + 2.3, y0 + 1];
  const high: [number, number] = [x0 + 0.7, y0 + 0.45];
  const low: [number, number] = [x0 + 0.7, y0 + 1.55];
  const throws: [number, number, string][] =
    contact === 'spst-vcc'
      ? [[...high, '1']]
      : contact === 'spst-gnd'
        ? [[...low, '0']]
        : [
            [...high, '1'],
            [...low, '0'],
          ];
  const target =
    contact === 'spdt'
      ? on
        ? high
        : low
      : on
        ? (throws[0]!.slice(0, 2) as [number, number])
        : // Open: the lever points at the gap, away from the contact.
          ([x0 + 0.9, contact === 'spst-gnd' ? y0 + 0.75 : y0 + 1.3] as [number, number]);

  g.beginPath();
  g.moveTo(common[0], common[1]);
  g.lineTo(x0 + 3, y0 + 1);
  g.moveTo(common[0], common[1]);
  g.lineTo(target[0], target[1]);
  g.stroke();
  contactDot(g, ...common);
  for (const [x, y, level] of throws) {
    contactDot(g, x, y);
    g.text(level, x - 0.25, y, {
      size: 0.45,
      align: 'right',
      baseline: 'middle',
      paint: 'pinText',
      font: 'mono',
      minPx: 6,
    });
  }
}

/**
 * A changeover whose common is tied to a rail (`0` for GND, `1` for VCC, on the left) and whose
 * throws are the pins, `ON` on top and `OFF` below; the lever touches the closed one.
 */
function changeover(g: SymbolGraphics, body: Rect, rail: '0' | '1', on: boolean): void {
  const x0 = body.x;
  const y0 = body.y;
  const common: [number, number] = [x0 + 0.7, y0 + 1];
  const throwOn: [number, number] = [x0 + 2.3, y0 + 0.45];
  const throwOff: [number, number] = [x0 + 2.3, y0 + 1.55];
  g.beginPath();
  g.moveTo(...throwOn);
  g.lineTo(x0 + 2.3, y0);
  g.lineTo(x0 + 3, y0);
  g.moveTo(...throwOff);
  g.lineTo(x0 + 2.3, y0 + 2);
  g.lineTo(x0 + 3, y0 + 2);
  g.moveTo(...common);
  g.lineTo(...(on ? throwOn : throwOff));
  g.stroke();
  for (const point of [common, throwOn, throwOff]) contactDot(g, ...point);
  g.text(rail, common[0] - 0.25, common[1], {
    size: 0.45,
    align: 'right',
    baseline: 'middle',
    paint: 'pinText',
    font: 'mono',
    minPx: 6,
  });
}

const toggleSwitch: Drawer = (g, { body, props, live }) => {
  const on = stateFlag(live, 'on') ?? props.on === true;
  if (props.contact === 'spdt-gnd' || props.contact === 'spdt-vcc') {
    changeover(g, body, props.contact === 'spdt-vcc' ? '1' : '0', on);
  } else {
    contacts(g, body, props.contact, on);
  }
};

/** A momentary button: contacts under a push plunger, released unless pressed while running. */
const button: Drawer = (g, { body, props, live }) => {
  const pressed = stateFlag(live, 'pressed') === true;
  contacts(g, body, props.contact, pressed);
  const x = body.x + 1.5;
  const top = body.y + (pressed ? 0.35 : 0.15);
  g.setDash([0.15, 0.12]);
  g.beginPath();
  g.moveTo(x, top);
  g.lineTo(x, body.y + 0.85);
  g.stroke();
  g.setDash([]);
  g.beginPath();
  g.moveTo(x - 0.35, top);
  g.lineTo(x + 0.35, top);
  g.stroke('line', 0.14);
};

/** Positions of a DIP switch bank: live while simulating, else the power-on bitmask. */
function dipPositions(c: DrawContext, count: number): boolean[] {
  const state = c.live?.state as { on?: unknown } | undefined;
  if (Array.isArray(state?.on)) return state.on.map((on) => on === true);
  const mask = Number(c.props.on ?? 0);
  return Array.from({ length: count }, (_, i) => ((mask >> i) & 1) === 1);
}

/** A bank of slide switches, `ON` towards the pins, numbered like the real part. */
const dipSwitch: Drawer = (g, c) => {
  const { body } = c;
  const count = body.height - 1;
  const on = dipPositions(c, count);
  g.beginPath();
  g.rect(body.x, body.y, body.width, body.height);
  g.fill('body');
  g.stroke();
  g.text('ON', body.x + 2.2, body.y + 0.45, {
    size: 0.4,
    align: 'center',
    baseline: 'middle',
    paint: 'pinText',
    minPx: 6,
  });
  for (let i = 0; i < count; i++) {
    const y = body.y + 1 + i;
    const closed = on[i] === true;
    g.beginPath();
    g.rect(body.x + 1.5, y - 0.3, 1.3, 0.6);
    g.stroke();
    g.beginPath();
    g.rect(body.x + (closed ? 2.15 : 1.5), y - 0.3, 0.65, 0.6);
    g.fill('ink');
    g.text(String(i + 1), body.x + 0.35, y, {
      size: 0.45,
      align: 'left',
      baseline: 'middle',
      paint: 'pinText',
      font: 'mono',
      minPx: 6,
    });
  }
};

/**
 * A box with a square wave (auto) or a single pulse (manual step); while simulating the wave is
 * drawn in the color of the output's level.
 */
const clock: Drawer = (g, { body, props, live, levelColor }) => {
  const x = body.x;
  const lo = body.y + 1.45;
  const hi = body.y + 0.55;
  g.beginPath();
  g.rect(body.x + 0.15, body.y + 0.15, body.width - 0.3, body.height - 0.3);
  g.fill('body');
  g.stroke();
  g.beginPath();
  if (props.mode === 'manual') {
    g.moveTo(x + 0.45, lo);
    g.lineTo(x + 1.15, lo);
    g.lineTo(x + 1.15, hi);
    g.lineTo(x + 1.85, hi);
    g.lineTo(x + 1.85, lo);
    g.lineTo(x + 2.55, lo);
  } else {
    g.moveTo(x + 0.45, lo);
    g.lineTo(x + 0.95, lo);
    g.lineTo(x + 0.95, hi);
    g.lineTo(x + 1.5, hi);
    g.lineTo(x + 1.5, lo);
    g.lineTo(x + 2.05, lo);
    g.lineTo(x + 2.05, hi);
    g.lineTo(x + 2.55, hi);
  }
  g.stroke(live && levelColor ? levelColor(live.level('Y')) : 'line', 0.12);
};

/**
 * A diode pointing right at row y between x0 and x1 (leads included), `size` = triangle height,
 * filled with light `light` of the part (unlit without a simulation).
 */
function diode(
  g: SymbolGraphics,
  c: DrawContext,
  x0: number,
  x1: number,
  y: number,
  size: number,
  light: number,
): void {
  const cx = (x0 + x1) / 2;
  const half = size / 2;
  const left = cx - half * 0.9;
  const right = cx + half * 0.9;
  const { paint, brightness } = lightPaint(c, light);
  glow(g, cx, y, size * 0.95, c.props.color, brightness);
  g.beginPath();
  g.moveTo(left, y - half);
  g.lineTo(right, y);
  g.lineTo(left, y + half);
  g.closePath();
  g.fill(paint);
  g.stroke();
  g.beginPath();
  g.moveTo(right, y - half);
  g.lineTo(right, y + half);
  g.moveTo(x0, y);
  g.lineTo(left, y);
  g.moveTo(right, y);
  g.lineTo(x1, y);
  g.stroke();
}

function arrow(g: SymbolGraphics, x: number, y: number): void {
  const d = 0.3;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + d, y - d);
  g.moveTo(x + d - 0.15, y - d);
  g.lineTo(x + d, y - d);
  g.lineTo(x + d, y - d + 0.15);
  g.stroke('line', 0.07);
}

/** A diode on the pin row with two emission arrows above it. */
const led: Drawer = (g, c) => {
  const { body } = c;
  const y = body.y + body.height / 2;
  diode(g, c, body.x, body.x + body.width, y, 0.8, 0);
  arrow(g, body.x + 0.95, body.y + 0.5);
  arrow(g, body.x + 1.3, body.y + 0.6);
};

const ledBar: Drawer = (g, c) => {
  const { body } = c;
  g.beginPath();
  g.rect(body.x + 0.2, body.y + 0.3, body.width - 0.4, body.height - 0.6);
  g.fill('body');
  g.stroke();
  for (let i = 1; i < body.height; i++) {
    diode(g, c, body.x, body.x + body.width, body.y + i, 0.55, i - 1);
  }
};

type Segment = readonly [x0: number, y0: number, x1: number, y1: number];

/** Segments a–g of a digit in a w×h box at (x, y), slanted a little like real displays. */
function segments(x: number, y: number, w: number, h: number): Record<string, Segment> {
  const m = y + h / 2;
  const b = y + h;
  const r = x + w;
  const gap = 0.22;
  return {
    a: [x + gap, y, r - gap, y],
    b: [r, y + gap, r, m - gap],
    c: [r, m + gap, r, b - gap],
    d: [x + gap, b, r - gap, b],
    e: [x, m + gap, x, b - gap],
    f: [x, y + gap, x, m - gap],
    g: [x + gap, m, r - gap, m],
  };
}

function pinLabels(g: SymbolGraphics, c: DrawContext): void {
  const { body } = c;
  for (const pin of c.layout.pins) {
    const top = pin.side === 'top';
    g.text(pin.name, pin.at[0], top ? body.y + 0.15 : body.y + body.height - 0.15, {
      size: 0.4,
      align: 'center',
      baseline: top ? 'top' : 'bottom',
      paint: 'pinText',
      minPx: 6,
    });
  }
}

/** Segment names in light order (the part's `SEGMENTS` without `dp`). */
const SEGMENT_ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
const DP_LIGHT = 7;

const sevenSegment: Drawer = (g, c) => {
  const { body } = c;
  g.beginPath();
  g.rect(body.x, body.y, body.width, body.height);
  g.fill('body');
  g.stroke();
  const x = body.x + 1.9;
  const y = body.y + 1.3;
  const w = 2.2;
  const h = 4.4;
  const slant = 0.25;
  const shape = segments(x, y, w, h);
  // One stroke per paint: unlit segments share one, lit ones differ by brightness.
  const byPaint = new Map<string, Segment[]>();
  SEGMENT_ORDER.forEach((name, i) => {
    const { paint } = lightPaint(c, i);
    const list = byPaint.get(paint);
    if (list) list.push(shape[name]!);
    else byPaint.set(paint, [shape[name]!]);
  });
  for (const [paint, list] of byPaint) {
    g.beginPath();
    for (const [x0, y0, x1, y1] of list) {
      g.moveTo(x0 + slant * (1 - (y0 - y) / h), y0);
      g.lineTo(x1 + slant * (1 - (y1 - y) / h), y1);
    }
    g.stroke(paint, 0.32);
  }
  g.beginPath();
  g.arc(x + w + 0.45, y + h, 0.18, 0, Math.PI * 2);
  g.fill(lightPaint(c, DP_LIGHT).paint);
  pinLabels(g, c);
};

const HEX_INPUTS = ['D0', 'D1', 'D2', 'D3'] as const;

/** The digit of its inputs while simulating (unknown inputs: a dash in the `X` color). */
const hexDisplay: Drawer = (g, c) => {
  const { body, props, live, levelColor } = c;
  g.beginPath();
  g.rect(body.x, body.y, body.width, body.height);
  g.fill('body');
  g.stroke();
  g.beginPath();
  g.rect(body.x + 0.6, body.y + 0.6, body.width - 1.2, body.height - 2.2);
  g.stroke();
  const digit = live ? hexDigit(HEX_INPUTS.map((pin) => live.level(pin))) : undefined;
  const unknown = live !== undefined && digit === undefined;
  g.text(
    digit === undefined ? '–' : digit.toString(16).toUpperCase(),
    body.x + body.width / 2,
    body.y + 0.6 + (body.height - 2.2) / 2,
    {
      size: 2.4,
      align: 'center',
      baseline: 'middle',
      paint:
        digit !== undefined
          ? lit(props.color, 1)
          : unknown && levelColor
            ? levelColor(Level.X)
            : unlit(props.color),
      font: 'mono',
      bold: true,
    },
  );
  pinLabels(g, c);
};

/** A round probe head showing the level of its net while simulating. */
const probe: Drawer = (g, { body, live, levelColor }) => {
  const cx = body.x + body.width / 2;
  const cy = body.y + body.height / 2;
  g.beginPath();
  g.moveTo(body.x, cy);
  g.lineTo(cx - 0.8, cy);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, 0.8, 0, Math.PI * 2);
  g.fill('body');
  g.stroke();
  if (live && levelColor) {
    const level = live.level('A');
    g.text(levelChar(level), cx, cy, {
      size: 0.95,
      align: 'center',
      baseline: 'middle',
      paint: levelColor(level),
      font: 'mono',
      bold: true,
    });
    return;
  }
  g.text('·', cx, cy, { size: 0.9, align: 'center', baseline: 'middle', paint: 'pinText' });
};

export const IO_DRAWERS: Readonly<Record<string, Drawer>> = {
  switch: toggleSwitch,
  button,
  'dip-switch': dipSwitch,
  clock,
  led,
  'led-bar': ledBar,
  'seven-segment': sevenSegment,
  'hex-display': hexDisplay,
  probe,
};
