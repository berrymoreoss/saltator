/**
 * Drawer for character LCD modules (`periph/hd44780`): the module board, the bezel, the glass in
 * its backlight's colors and every dot of every 5 × 8 character, from the controller's state
 * (`hd44780Frame`). The backlight is lit while `A` is HIGH and `K` LOW (an LED); characters show
 * only with the contrast input `V0` LOW. The blink follows simulated time. Without a simulation:
 * a module before power-on, dark glass and no characters. Pin names run along the bottom edge,
 * as Proteus draws its LM016L. Spec: docs/editor.md#symbol-drawing.
 */
import { Level, pinsOf, pinTextRuns } from '../../core';
import {
  blinkOn,
  GLASS_ROWS,
  type Hd44780Backlight,
  type Hd44780Rom,
  type Hd44780Size,
  hd44780Controller,
  hd44780Frame,
  hd44780Glass,
  LCD_CHAR_PITCH,
  LCD_DOT_PITCH,
  LCD_LINE_PITCH,
} from '../../library';
import { overlinedText, type SymbolGraphics } from '../graphics';
import type { DrawContext, Drawer } from './types';

/** Glass colors: lit and unlit backlight; dots on, and off (the faint grid real glass shows). */
interface GlassColors {
  readonly lit: string;
  readonly dark: string;
  readonly on: string;
  readonly onDark: string;
  readonly off: string;
  readonly offDark: string;
}

export const LCD_GLASS: Readonly<Record<Hd44780Backlight, GlassColors>> = {
  'yellow-green': {
    lit: '#b4d22e',
    dark: '#7d8a4c',
    on: '#26310d',
    onDark: '#2c3318',
    off: '#a6c32a',
    offDark: '#748046',
  },
  blue: {
    lit: '#2f50e6',
    dark: '#1b2350',
    on: '#eef3ff',
    onDark: '#4a5680',
    off: '#3a5cf0',
    offDark: '#20295a',
  },
  white: {
    lit: '#eef2f5',
    dark: '#a9adb1',
    on: '#16181a',
    onDark: '#2a2c2e',
    off: '#e0e5e9',
    offDark: '#9fa3a7',
  },
  black: {
    lit: '#0e1114',
    dark: '#0b0d0f',
    on: '#f4f6f8',
    onDark: '#3c4046',
    off: '#181c20',
    offDark: '#121417',
  },
  amber: {
    lit: '#ffb21a',
    dark: '#9c7a36',
    on: '#3a2300',
    onDark: '#3a2a10',
    off: '#f2a614',
    offDark: '#92722f',
  },
  red: {
    lit: '#ff4d3d',
    dark: '#93453c',
    on: '#3b0906',
    onDark: '#3a1410',
    off: '#f04536',
    offDark: '#894038',
  },
};

const BEZEL = '#1d1f21';
const DOT = LCD_DOT_PITCH * 0.84;
/** Glass margin around the characters, and bezel around the glass, in cells. */
const GLASS_PAD = 0.3;
const BEZEL_PAD = 0.25;

/** Where the glass sits in the body: centered, below a top margin. */
export function lcdGlassRect(c: DrawContext): { x: number; y: number; w: number; h: number } {
  const { columns, lines } = hd44780Glass(c.props.size as Hd44780Size);
  const w = columns * LCD_CHAR_PITCH - (LCD_CHAR_PITCH - 5 * LCD_DOT_PITCH) + 2 * GLASS_PAD;
  const h = lines * LCD_LINE_PITCH - (LCD_LINE_PITCH - GLASS_ROWS * LCD_DOT_PITCH) + 2 * GLASS_PAD;
  return { x: c.body.x + (c.body.width - w) / 2, y: c.body.y + 0.85, w, h };
}

function dotsPath(
  g: SymbolGraphics,
  rows: Uint8Array,
  unknown: Uint8Array,
  columns: number,
  x0: number,
  y0: number,
  on: boolean,
): void {
  g.beginPath();
  for (let i = 0; i < unknown.length; i++) {
    if (unknown[i]) continue;
    const cx = x0 + (i % columns) * LCD_CHAR_PITCH;
    const cy = y0 + Math.floor(i / columns) * LCD_LINE_PITCH;
    for (let row = 0; row < GLASS_ROWS; row++) {
      const bits = rows[i * GLASS_ROWS + row]!;
      for (let dot = 0; dot < 5; dot++) {
        if ((((bits >> (4 - dot)) & 1) === 1) !== on) continue;
        g.rect(cx + dot * LCD_DOT_PITCH, cy + row * LCD_DOT_PITCH, DOT, DOT);
      }
    }
  }
}

const lcd: Drawer = (g, c) => {
  const { body, live } = c;
  const size = c.props.size as Hd44780Size;
  const colors = LCD_GLASS[c.props.backlight as Hd44780Backlight] ?? LCD_GLASS['yellow-green'];
  const { columns, lines } = hd44780Glass(size);
  g.beginPath();
  g.rect(body.x, body.y, body.width, body.height);
  g.fill('body');
  g.stroke();

  const glass = lcdGlassRect(c);
  g.beginPath();
  g.rect(
    glass.x - BEZEL_PAD,
    glass.y - BEZEL_PAD,
    glass.w + 2 * BEZEL_PAD,
    glass.h + 2 * BEZEL_PAD,
  );
  g.fill(BEZEL);

  const lit = live !== undefined && live.level('A') === Level.L1 && live.level('K') === Level.L0;
  g.beginPath();
  g.rect(glass.x, glass.y, glass.w, glass.h);
  g.fill(lit ? colors.lit : colors.dark);

  const controller = live ? hd44780Controller(live.state) : undefined;
  const frame = controller
    ? hd44780Frame(
        controller,
        size,
        c.props.rom as Hd44780Rom,
        blinkOn(live?.time ?? 0, Number(c.props.oscillator)),
      )
    : undefined;
  const rows = frame?.rows ?? new Uint8Array(columns * lines * GLASS_ROWS);
  const unknown = frame?.unknown ?? new Uint8Array(columns * lines);
  // Contrast: with V0 not LOW the liquid crystal never turns: every dot looks off.
  const contrast = live?.level('V0') === Level.L0;
  const x0 = glass.x + GLASS_PAD;
  const y0 = glass.y + GLASS_PAD;
  dotsPath(g, rows, unknown, columns, x0, y0, false);
  g.fill(lit ? colors.off : colors.offDark);
  if (contrast) {
    dotsPath(g, rows, unknown, columns, x0, y0, true);
    g.fill(lit ? colors.on : colors.onDark);
  }
  if (unknown.includes(1)) {
    g.beginPath();
    for (let i = 0; i < unknown.length; i++) {
      if (!unknown[i]) continue;
      const cx = x0 + (i % columns) * LCD_CHAR_PITCH;
      const cy = y0 + Math.floor(i / columns) * LCD_LINE_PITCH;
      g.rect(cx, cy, 5 * LCD_DOT_PITCH, GLASS_ROWS * LCD_DOT_PITCH);
    }
    g.fill(`${c.levelColor?.(Level.X) ?? '#ff0000'}aa`);
  }

  const pins = pinsOf(c.definition, c.props);
  for (const pin of c.layout.pins) {
    const def = pins.find((p) => p.name === pin.name);
    const { text, overline } = overlinedText(pinTextRuns(def ?? { name: pin.name }));
    g.text(text, pin.at[0], body.y + body.height - 0.12, {
      size: 0.42,
      align: 'center',
      baseline: 'bottom',
      paint: 'pinText',
      overline,
    });
  }
};

export const LCD_DRAWERS: Readonly<Record<string, Drawer>> = { lcd };
