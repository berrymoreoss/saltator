/**
 * Drawers for fixed levels: constants, pull resistors and the VCC/GND rail symbols. Resistors
 * follow the gate style: a zigzag (ANSI) or a rectangle (IEC).
 */
import type { SymbolGraphics } from '../graphics';
import type { DrawContext, Drawer, GateStyle } from './types';

/** VCC: a bar with the pin hanging below it (rail name above, placed by the scene). */
function rail(g: SymbolGraphics, x: number, y: number): void {
  g.beginPath();
  g.moveTo(x - 0.8, y);
  g.lineTo(x + 0.8, y);
  g.stroke('line', 0.18);
}

/** The ground sign: three bars getting shorter downwards, starting at `y`. */
function ground(g: SymbolGraphics, x: number, y: number): void {
  g.beginPath();
  g.moveTo(x - 0.8, y);
  g.lineTo(x + 0.8, y);
  g.moveTo(x - 0.5, y + 0.3);
  g.lineTo(x + 0.5, y + 0.3);
  g.moveTo(x - 0.2, y + 0.6);
  g.lineTo(x + 0.2, y + 0.6);
  g.stroke('line', 0.14);
}

/** A vertical resistor from y0 to y1 at x. */
function resistor(g: SymbolGraphics, x: number, y0: number, y1: number, style: GateStyle): void {
  g.beginPath();
  if (style === 'iec') {
    g.rect(x - 0.3, y0, 0.6, y1 - y0);
    g.fill('body');
    g.stroke();
    return;
  }
  const zigs = 6;
  const step = (y1 - y0) / zigs;
  g.moveTo(x, y0);
  for (let i = 0; i < zigs; i++) {
    g.lineTo(x + (i % 2 === 0 ? 0.35 : -0.35), y0 + step * (i + 0.5));
  }
  g.lineTo(x, y1);
  g.stroke();
}

/** Pull-up: VCC bar on top, resistor, pin below. Pull-down: pin on top, resistor, ground. */
function pull(up: boolean): Drawer {
  return (g, { body, layout, gateStyle }: DrawContext) => {
    const x = layout.pins[0]?.at[0] ?? body.x + body.width / 2;
    const top = body.y;
    const bottom = body.y + body.height;
    // Pull-up: rail at the top edge, pin at the bottom; pull-down: pin on top, ground at the bottom.
    const r0 = up ? top + 0.6 : top + 0.4;
    const r1 = up ? bottom - 0.4 : bottom - 0.9;
    const end = up ? bottom : bottom - 0.6;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, r0);
    g.moveTo(x, r1);
    g.lineTo(x, end);
    g.stroke();
    resistor(g, x, r0, r1, gateStyle);
    if (up) rail(g, x, top);
    else ground(g, x, end);
  };
}

const vcc: Drawer = (g, { body, layout }) => {
  const x = layout.pins[0]?.at[0] ?? body.x + body.width / 2;
  const barY = body.y + 0.3;
  g.beginPath();
  g.moveTo(x, barY);
  g.lineTo(x, body.y + body.height);
  g.stroke();
  rail(g, x, barY);
};

const gnd: Drawer = (g, { body, layout }) => {
  const x = layout.pins[0]?.at[0] ?? body.x + body.width / 2;
  g.beginPath();
  g.moveTo(x, body.y);
  g.lineTo(x, body.y + 0.2);
  g.stroke();
  ground(g, x, body.y + 0.2);
};

/** A tie to a fixed level: a small box with the value. */
const constant: Drawer = (g, { body, props }) => {
  g.beginPath();
  g.rect(body.x + 0.2, body.y + 0.2, body.width - 0.2, body.height - 0.4);
  g.fill('body');
  g.stroke();
  g.text(String(props.value ?? '?'), body.x + 0.1 + body.width / 2, body.y + body.height / 2, {
    size: 0.9,
    align: 'center',
    baseline: 'middle',
    font: 'mono',
    bold: true,
    paint: 'line',
  });
};

export const POWER_DRAWERS: Readonly<Record<string, Drawer>> = {
  constant,
  'pull-up': pull(true),
  'pull-down': pull(false),
  vcc,
  gnd,
};
