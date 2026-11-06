/**
 * Drawers for IO parts: contacts (switch, button, DIP switch), clock, LEDs, LED bar, 7-segment
 * and hex displays, probe. R04a draws the idle look (power-on switch positions, unlit lights);
 * R05 draws the live state.
 */
import type { Rect } from '../../circuit';
import type { SymbolGraphics } from '../graphics';
import type { DrawContext, Drawer } from './types';

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
  return `${LED_COLORS[String(color)] ?? LED_COLORS.red}55`;
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

const toggleSwitch: Drawer = (g, { body, props }) => {
  contacts(g, body, props.contact, props.on === true);
};

/** A momentary button: contacts in the released position under a push plunger. */
const button: Drawer = (g, { body, props }) => {
  contacts(g, body, props.contact, false);
  const x = body.x + 1.5;
  g.setDash([0.15, 0.12]);
  g.beginPath();
  g.moveTo(x, body.y + 0.15);
  g.lineTo(x, body.y + 0.85);
  g.stroke();
  g.setDash([]);
  g.beginPath();
  g.moveTo(x - 0.35, body.y + 0.15);
  g.lineTo(x + 0.35, body.y + 0.15);
  g.stroke('line', 0.14);
};

/** A bank of slide switches, `ON` towards the pins, numbered like the real part. */
const dipSwitch: Drawer = (g, { body, props }) => {
  const count = body.height - 1;
  const on = Number(props.on ?? 0);
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
    const closed = ((on >> i) & 1) === 1;
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

/** A box with a square wave (auto) or a single pulse (manual step). */
const clock: Drawer = (g, { body, props }) => {
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
  g.stroke('line', 0.12);
};

/** A diode pointing right at row y between x0 and x1 (leads included), `size` = triangle height. */
function diode(
  g: SymbolGraphics,
  x0: number,
  x1: number,
  y: number,
  size: number,
  color: unknown,
): void {
  const cx = (x0 + x1) / 2;
  const half = size / 2;
  const left = cx - half * 0.9;
  const right = cx + half * 0.9;
  g.beginPath();
  g.moveTo(left, y - half);
  g.lineTo(right, y);
  g.lineTo(left, y + half);
  g.closePath();
  g.fill(unlit(color));
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
const led: Drawer = (g, { body, props }) => {
  const y = body.y + body.height / 2;
  diode(g, body.x, body.x + body.width, y, 0.8, props.color);
  arrow(g, body.x + 0.95, body.y + 0.5);
  arrow(g, body.x + 1.3, body.y + 0.6);
};

const ledBar: Drawer = (g, { body, props }) => {
  g.beginPath();
  g.rect(body.x + 0.2, body.y + 0.3, body.width - 0.4, body.height - 0.6);
  g.fill('body');
  g.stroke();
  for (let i = 1; i < body.height; i++) {
    diode(g, body.x, body.x + body.width, body.y + i, 0.55, props.color);
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

const sevenSegment: Drawer = (g, c) => {
  const { body, props } = c;
  g.beginPath();
  g.rect(body.x, body.y, body.width, body.height);
  g.fill('body');
  g.stroke();
  const x = body.x + 1.9;
  const y = body.y + 1.3;
  const w = 2.2;
  const h = 4.4;
  const slant = 0.25;
  const color = unlit(props.color);
  g.beginPath();
  for (const [x0, y0, x1, y1] of Object.values(segments(x, y, w, h))) {
    g.moveTo(x0 + slant * (1 - (y0 - y) / h), y0);
    g.lineTo(x1 + slant * (1 - (y1 - y) / h), y1);
  }
  g.stroke(color, 0.32);
  g.beginPath();
  g.arc(x + w + 0.45, y + h, 0.18, 0, Math.PI * 2);
  g.fill(color);
  pinLabels(g, c);
};

const hexDisplay: Drawer = (g, c) => {
  const { body, props } = c;
  g.beginPath();
  g.rect(body.x, body.y, body.width, body.height);
  g.fill('body');
  g.stroke();
  g.beginPath();
  g.rect(body.x + 0.6, body.y + 0.6, body.width - 1.2, body.height - 2.2);
  g.stroke();
  g.text('–', body.x + body.width / 2, body.y + 0.6 + (body.height - 2.2) / 2, {
    size: 2.4,
    align: 'center',
    baseline: 'middle',
    paint: unlit(props.color),
    font: 'mono',
    bold: true,
  });
  pinLabels(g, c);
};

/** A round probe head with its level shown inside while simulating (R05). */
const probe: Drawer = (g, { body }) => {
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
