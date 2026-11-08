/**
 * `periph/st7789`: a color TFT module with the Sitronix ST7789V controller on its 4-line serial
 * interface, the common 8-pin breakout header (LCDWiki MSP2008, MSP1141; DisplayModule
 * DM-TFT114-397), one part for every panel. The interface side lives here — CS framing, SDA
 * shifted in on SCL rising, D/CX on the 8th edge, the reset pulse — the controller in
 * `st7789-controller.ts`, the panels in `st7789-panels.ts`.
 * Spec: docs/components.md#st7789.
 */
import {
  defineComponent,
  type EvalContext,
  Level,
  type PinDef,
  type SymbolDef,
  type SymbolPin,
  us,
} from '../../core';
import {
  type Controller,
  createController,
  hardwareReset,
  type Reporter,
  receiveByte,
  St7789Diagnostic,
} from './st7789-controller';
import { ST7789_PANEL_LABELS, ST7789_PANELS, type St7789Panel, st7789Glass } from './st7789-panels';

export interface St7789Props {
  readonly panel: St7789Panel;
}

const PINS: readonly PinDef[] = [
  { name: 'GND', number: 1, dir: 'power', description: 'ground' },
  {
    name: 'VCC',
    number: 2,
    dir: 'power',
    description: 'supply (3.3 V; the logic is not 5 V tolerant)',
  },
  {
    name: 'SCL',
    number: 3,
    dir: 'in',
    clock: true,
    description: 'serial clock: SDA is sampled on its rising edge while CS is LOW',
  },
  { name: 'SDA', number: 4, dir: 'in', description: 'serial data in, most significant bit first' },
  {
    name: 'RES',
    number: 5,
    dir: 'in',
    activeLow: true,
    description: 'reset (RESX): a LOW pulse of at least 10 µs resets the controller',
  },
  {
    name: 'DC',
    number: 6,
    dir: 'in',
    description: 'data/command (D/CX), sampled on the 8th clock: 0 command, 1 parameter or data',
  },
  {
    name: 'CS',
    number: 7,
    dir: 'in',
    activeLow: true,
    description: 'chip select (CSX): LOW enables the interface, HIGH restarts the byte',
  },
  {
    name: 'BLK',
    number: 8,
    dir: 'in',
    sense: true,
    description: 'backlight: lit while HIGH or open (10 kΩ pull-up to VCC), dark while LOW',
  },
];

const at = (name: string) => PINS.findIndex((p) => p.name === name);
const SCL = at('SCL');
const SDA = at('SDA');
const RES = at('RES');
const DC = at('DC');
const CS = at('CS');

/** Glass pixels per cell: 16, one CSS pixel per glass pixel at 100 % (a cell is 16 px). */
export const TFT_PIXELS_PER_CELL = 16;
/** Board around the glass, in cells: the sides and top, and the header strip at the bottom. */
export const TFT_BEZEL = 1;
export const TFT_HEADER = 3;

/** Pins along the bottom edge, 1 to 8 from the left, wherever the panel puts the glass. */
const PIN_PLACES: Readonly<Record<string, SymbolPin>> = Object.fromEntries(
  PINS.map((pin) => [pin.name, { side: 'bottom', offset: pin.number! } as const]),
);

/** Body height of the shortest panels (240 rows); taller ones grow upwards from it. */
const TFT_BASE_HEIGHT = Math.ceil(240 / TFT_PIXELS_PER_CELL) + TFT_BEZEL + TFT_HEADER;

/**
 * The module's body: the glass with a bezel, the header strip below it. Wide enough for the 8
 * pins; a taller panel is raised by what it grows, so the pins stay put for every panel (a panel
 * change in Properties keeps the wires on them).
 */
export function st7789Symbol(panel: St7789Panel): SymbolDef {
  const { width, height } = st7789Glass(panel);
  const bodyHeight = Math.ceil(height / TFT_PIXELS_PER_CELL) + TFT_BEZEL + TFT_HEADER;
  return {
    kind: 'tft',
    width: Math.max(10, Math.ceil(width / TFT_PIXELS_PER_CELL) + 2 * TFT_BEZEL),
    height: bodyHeight,
    raise: bodyHeight - TFT_BASE_HEIGHT,
    pins: PIN_PLACES,
  };
}

/** Table 9: a RESX LOW pulse of at least tRW resets. */
const T_RW = us(10);

export interface St7789State {
  ctl: Controller;
  /** CS as last seen (read only when it changes). */
  cs: number;
  /** The byte being shifted in, MSB first, and how many bits of it arrived. */
  shift: number;
  bits: number;
  /** 1 while RESX is LOW: the interface is held. */
  resetting: number;
  /** Generation of the pending reset wake-up (a RESX rise cancels it). */
  resetGen: number;
}

export const st7789 = defineComponent<St7789Props, St7789State>({
  type: 'periph/st7789',
  name: 'ST7789',
  title: 'TFT LCD module (ST7789)',
  keywords: ['tft', 'lcd', 'st7789', 'ips', 'spi', 'color display', '240x240', '240x320'],
  designatorPrefix: 'DS',
  datasheet: 'https://www.newhavendisplay.com/appnotes/datasheets/LCDs/ST7789V.pdf',
  props: [
    {
      key: 'panel',
      label: 'Panel',
      type: 'enum',
      default: '240x320',
      options: ST7789_PANELS.map((value) => ({ value, label: ST7789_PANEL_LABELS[value] })),
    },
  ],
  pins: PINS,
  symbol: ({ panel }) => st7789Symbol(panel),
  create: () => {
    const reporter =
      (ctx: EvalContext<St7789State>): Reporter =>
      (kind, message) =>
        ctx.report({ kind, message });

    /** Drops a byte cut short by CS rising (§8.5: "reject the previous bits"). */
    const restartByte = (ctx: EvalContext<St7789State>) => {
      const st = ctx.state;
      if (st.bits === 0) return;
      ctx.report({
        kind: St7789Diagnostic.PARTIAL_BYTE,
        message: `CS rose after ${st.bits} of 8 bits: the byte is dropped`,
        pin: CS,
      });
      st.bits = 0;
      st.shift = 0;
    };

    /** SCL rose with CS LOW: SDA shifts in; the 8th bit completes the byte with D/CX. */
    const clockIn = (ctx: EvalContext<St7789State>) => {
      const st = ctx.state;
      const sda = ctx.read(SDA);
      st.shift = ((st.shift << 1) | (sda === Level.L1 ? 1 : 0)) & 0xff;
      st.bits++;
      if (st.bits < 8) return;
      st.bits = 0;
      const dc = ctx.read(DC);
      if (dc === Level.L0 || dc === Level.L1) {
        receiveByte(st.ctl, ctx.now, dc === Level.L1 ? 1 : 0, st.shift, reporter(ctx));
      }
      st.shift = 0;
    };

    return {
      createState: () => ({
        ctl: createController(),
        cs: Level.X,
        shift: 0,
        bits: 0,
        resetting: 0,
        resetGen: 0,
      }),
      evaluate(ctx) {
        const st = ctx.state;
        if (ctx.changed(RES)) {
          st.resetGen++;
          if (ctx.read(RES) === Level.L0) {
            // The interface stops at once; the registers reset once the pulse is long enough.
            st.resetting = 1;
            st.bits = 0;
            st.shift = 0;
            ctx.wakeAfter(T_RW, st.resetGen);
          } else {
            st.resetting = 0;
          }
        }
        // CS is read when it changes, and until it is first known (tied LOW from power-on).
        if (ctx.changed(CS) || (st.cs !== Level.L0 && st.cs !== Level.L1)) {
          st.cs = ctx.read(CS);
          if (st.cs !== Level.L0) restartByte(ctx);
        }
        if (st.resetting || st.cs !== Level.L0) return;
        if (ctx.rose(SCL)) clockIn(ctx);
      },
      wake(ctx, token) {
        const st = ctx.state;
        if (token === st.resetGen && st.resetting) hardwareReset(st.ctl);
      },
    };
  },
});

/** The controller of an instance (its simulator state), for the drawer and tests. */
export function st7789Controller(state: unknown): Controller | undefined {
  if (typeof state !== 'object' || state === null || !('ctl' in state)) return undefined;
  return (state as St7789State).ctl;
}
