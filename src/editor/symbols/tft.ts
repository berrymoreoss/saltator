/**
 * Drawer for TFT modules (`periph/st7789`): the module board, the bezel and the glass, centered
 * under a top margin, with the pin names along the header strip at the bottom. The backlight is
 * lit while BLK is HIGH or open (the board pulls it up) and dark while it is LOW. Without a
 * simulation: a module before power-on, dark glass. Spec: docs/editor.md#symbol-drawing.
 */
import { Level, pinsOf, pinTextRuns } from '../../core';
import { type St7789Panel, st7789Glass, TFT_BEZEL, TFT_PIXELS_PER_CELL } from '../../library';
import { overlinedText } from '../graphics';
import type { DrawContext, Drawer } from './types';

/** Glass colors: a normally black panel shows black where it shows nothing. */
export const TFT_GLASS = {
  /** Backlight off (or no simulation). */
  dark: '#08090b',
  /** Backlight on, nothing shown: the little light a black IPS pixel lets through. */
  lit: '#15171b',
} as const;

const BEZEL = '#1d1f21';
/** Bezel around the glass, in cells. */
const BEZEL_PAD = 0.25;

/** Where the glass sits in the body: centered across, a bezel's width below the top. */
export function tftGlassRect(c: DrawContext): { x: number; y: number; w: number; h: number } {
  const { width, height } = st7789Glass(c.props.panel as St7789Panel);
  const w = width / TFT_PIXELS_PER_CELL;
  const h = height / TFT_PIXELS_PER_CELL;
  return { x: c.body.x + (c.body.width - w) / 2, y: c.body.y + TFT_BEZEL, w, h };
}

/** Lit unless BLK is LOW: HIGH or floating (the board's 10 kΩ pull-up) light it. */
export function backlightOn(level: Level): boolean {
  return level !== Level.L0;
}

const tft: Drawer = (g, c) => {
  const { body, live } = c;
  g.beginPath();
  g.rect(body.x, body.y, body.width, body.height);
  g.fill('body');
  g.stroke();

  const glass = tftGlassRect(c);
  g.beginPath();
  g.rect(
    glass.x - BEZEL_PAD,
    glass.y - BEZEL_PAD,
    glass.w + 2 * BEZEL_PAD,
    glass.h + 2 * BEZEL_PAD,
  );
  g.fill(BEZEL);

  const lit = live !== undefined && backlightOn(live.level('BLK'));
  g.beginPath();
  g.rect(glass.x, glass.y, glass.w, glass.h);
  g.fill(lit ? TFT_GLASS.lit : TFT_GLASS.dark);

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

export const TFT_DRAWERS: Readonly<Record<string, Drawer>> = { tft };
