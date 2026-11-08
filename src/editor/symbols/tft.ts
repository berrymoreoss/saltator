/**
 * Drawer for TFT modules (`periph/st7789`): the module board, the bezel and the glass, centered
 * under a top margin, with the pin names along the header strip at the bottom. The glass shows
 * the controller's frame (`st7789Frame`) as an image while the backlight is lit — BLK HIGH or
 * open (the board pulls it up); dark while it is LOW. Pixels the memory doesn't know are noise
 * in the `X` color; pixels whose look is uncertain show under a hatch of it (the veil). Without
 * a simulation: a module before power-on, dark glass. Spec: docs/editor.md#symbol-drawing.
 */
import { Level, pinsOf, pinTextRuns } from '../../core';
import {
  FRAME_UNCERTAIN,
  FRAME_UNKNOWN,
  type St7789Controller,
  type St7789Panel,
  st7789Controller,
  st7789Frame,
  st7789Glass,
  TFT_BEZEL,
  TFT_PIXELS_PER_CELL,
} from '../../library';
import { overlinedText, type RasterImage } from '../graphics';
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

/** `#rgb` or `#rrggbb` as [r, g, b]; anything else as red. */
function rgbOf(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color)?.[1];
  if (!hex) return [255, 0, 0];
  const full = hex.length === 3 ? [...hex].map((d) => d + d).join('') : hex;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** A fixed pattern of 0–255 per pixel: the noise of unknown memory, the same every frame. */
const noise = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 7) & 0xff;

/** Pixels of the veil's hatch: a diagonal band every 6 pixels. */
const hatched = (x: number, y: number) => (x + y) % 6 < 2;

/** The glass as an image, from the frame: X noise, the veil, alpha 255. */
export function glassImage(ctl: St7789Controller, panel: St7789Panel, xColor: string): RasterImage {
  const { width, height, pixels } = st7789Frame(ctl, panel);
  const rgba = new Uint8ClampedArray(width * height * 4);
  // RGBA bytes written a pixel at a time: little-endian words are A B G R. Signed words keep
  // the arithmetic in small integers (an unsigned 0xFF…… would be a double).
  const words = new Int32Array(rgba.buffer);
  const [xr, xg, xb] = rgbOf(xColor);
  const OPAQUE = 0xff << 24;
  // Imported bindings as locals: a transformed module (tests) reads them through getters.
  const unknown = FRAME_UNKNOWN;
  const uncertain = FRAME_UNCERTAIN;
  const abgr = (r: number, g: number, b: number) => OPAQUE | (b << 16) | (g << 8) | r;
  for (let i = 0, y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const p = pixels[i]!;
      if (p & unknown) {
        // 25–85 % of the X color, in 1/256 steps.
        const shade = 64 + ((noise(x, y) * 154) >> 8);
        words[i] = abgr((xr * shade) >> 8, (xg * shade) >> 8, (xb * shade) >> 8);
        continue;
      }
      let r = (p >> 16) & 0xff;
      let g = (p >> 8) & 0xff;
      let b = p & 0xff;
      if (p & uncertain && hatched(x, y)) {
        r = (r * 77 + xr * 179) >> 8;
        g = (g * 77 + xg * 179) >> 8;
        b = (b * 77 + xb * 179) >> 8;
      }
      words[i] = abgr(r, g, b);
    }
  }
  return { width, height, rgba };
}

interface CachedGlass {
  readonly version: number;
  readonly epoch: number;
  readonly panel: St7789Panel;
  readonly xColor: string;
  readonly image: RasterImage;
}

/**
 * The last image of each controller: redrawing an unchanged glass (a pan, another part's
 * change) reuses it. Keyed by the controller object; its version says what changed, the epoch
 * says it was rewound (a restored version may repeat with other pixels).
 */
const glassCache = new WeakMap<St7789Controller, CachedGlass>();

function cachedGlassImage(
  ctl: St7789Controller,
  panel: St7789Panel,
  epoch: number,
  xColor: string,
): RasterImage {
  const hit = glassCache.get(ctl);
  if (
    hit?.version === ctl.version &&
    hit.epoch === epoch &&
    hit.panel === panel &&
    hit.xColor === xColor
  ) {
    return hit.image;
  }
  const image = glassImage(ctl, panel, xColor);
  glassCache.set(ctl, { version: ctl.version, epoch, panel, xColor, image });
  return image;
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
  const ctl = lit ? st7789Controller(live.state) : undefined;
  if (ctl) {
    const panel = c.props.panel as St7789Panel;
    const xColor = c.levelColor?.(Level.X) ?? '#ff0000';
    g.image(
      cachedGlassImage(ctl, panel, live?.epoch ?? 0, xColor),
      glass.x,
      glass.y,
      glass.w,
      glass.h,
    );
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

export const TFT_DRAWERS: Readonly<Record<string, Drawer>> = { tft };
