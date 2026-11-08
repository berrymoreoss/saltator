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
  formatTime,
  Level,
  ns,
  type PinDef,
  type PinTimes,
  type SymbolDef,
  type SymbolPin,
  TimingChecks,
  type TimingDef,
  us,
} from '../../core';
import {
  type Controller,
  createController,
  hardwareReset,
  lost,
  type Reporter,
  receiveByte,
  resetReleased,
  St7789Diagnostic,
  uncertainReset,
  WAIT_COMMAND,
  WAIT_SLEEP,
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

/** Table 6 (4-line serial, write), VDDI 1.65–3.3 V, and Table 9 (tRW). */
const MIN = {
  tCSS: ns(15),
  tCSH: ns(15),
  tCHW: ns(40),
  tSCYCW: ns(66),
  tSHW: ns(15),
  tSLW: ns(15),
  tDCS: ns(10),
  tDCH: ns(10),
  tSDS: ns(10),
  tSDH: ns(10),
  tRW: us(10),
} as const;

/** Table 9: shorter RESX pulses are rejected as spikes; between it and tRW a reset may start. */
const T_SPIKE = us(5);

/** A byte completes once the hold times after its 8th edge have passed (tSDH, tDCH). */
const COMPLETE_AFTER = Math.max(MIN.tSDH, MIN.tDCH);

function timingOf(): TimingDef {
  return {
    typical: {},
    min: {
      ...MIN,
      'RESX↑ to command': WAIT_COMMAND,
      'RESX↑ to SLPOUT': WAIT_SLEEP,
      'SWRESET, SLPIN, SLPOUT to command': WAIT_COMMAND,
      'SLPOUT to SLPIN': WAIT_SLEEP,
    },
    conditions: 'VDDI 1.65–3.3 V, VDD 2.4–3.3 V; 3.3 V logic, not 5 V tolerant',
    source:
      'Sitronix ST7789V data sheet V1.3 (2014/03): Table 6 (4-line serial write), Table 9 and its notes (reset), the SWRESET, SLPIN and SLPOUT restrictions',
  };
}

const WAKE_RESET = 0;
const WAKE_BYTE = 1;
const token = (kind: number, gen: number) => gen * 2 + kind;

export interface St7789State {
  ctl: Controller;
  times: PinTimes;
  /** CS as last seen (read only when it changes). */
  cs: number;
  /** The byte being shifted in, MSB first, its unknown bits, and how many bits arrived. */
  shift: number;
  shiftX: number;
  bits: number;
  /** 1 once SCL rose with the interface listening (its hold checks then count). */
  edgeTaken: number;
  /** 1 while the bit phase is unknown (an uncertain clock or select): bytes count as unknown. */
  lost: number;
  /**
   * 1 once CS (SCL) was known. Before that an unknown level is the power-on state of the logic
   * driving it (a counter not reset yet): no activity, as unknown controls count everywhere
   * else only once they were known (an LCD's E, a RAM's WE̅).
   */
  csKnown: number;
  sclKnown: number;
  /** A complete byte waiting out the hold times: value, unknown bits, D/CX (-1 unknown). */
  pending: number;
  pendingValue: number;
  pendingX: number;
  pendingDc: number;
  byteGen: number;
  /** 1 while RESX is LOW: the interface is held. When it fell; the pending reset's generation. */
  resetting: number;
  resetFell: number;
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
  timing: timingOf,
  create: () => {
    const checks = new TimingChecks(PINS, MIN);
    const sda = checks.setupHold({
      data: 'SDA',
      clock: 'SCL',
      edge: 'rise',
      setup: 'tSDS',
      hold: 'tSDH',
    });
    const dc = checks.setupHold({
      data: 'DC',
      clock: 'SCL',
      edge: 'rise',
      setup: 'tDCS',
      hold: 'tDCH',
    });
    const csSetup = checks.setupHold({
      data: 'CS',
      clock: 'SCL',
      edge: 'rise',
      setup: 'tCSS',
      dataEdge: 'fall',
    });
    const csHold = checks.setupHold({
      data: 'CS',
      clock: 'SCL',
      edge: 'rise',
      hold: 'tCSH',
      dataEdge: 'rise',
    });
    const sclHigh = checks.pulseWidth({ pin: 'SCL', level: 'high', width: 'tSHW' });
    const sclLow = checks.pulseWidth({ pin: 'SCL', level: 'low', width: 'tSLW' });
    const sclCycle = checks.cycle({ pin: 'SCL', edge: 'rise', cycle: 'tSCYCW' });
    const csHigh = checks.pulseWidth({ pin: 'CS', level: 'high', width: 'tCHW' });

    const reporter =
      (ctx: EvalContext<St7789State>): Reporter =>
      (kind, message) =>
        ctx.report({ kind, message });

    /** Hands the pending byte to the controller (its hold window is over, or must end now). */
    const complete = (ctx: EvalContext<St7789State>) => {
      const st = ctx.state;
      if (!st.pending) return;
      st.pending = 0;
      st.byteGen++;
      if (st.pendingDc === -1 && !st.lost) {
        ctx.report({
          kind: St7789Diagnostic.UNCERTAIN,
          message: 'D/CX was unknown on the 8th edge: the byte may be a command or data',
          pin: DC,
        });
      }
      receiveByte(st.ctl, ctx.now, st.pendingDc, st.pendingValue, st.pendingX, reporter(ctx));
    };

    /** Drops a byte cut short by CS rising (§8.5: "reject the previous bits"). */
    const restartByte = (ctx: EvalContext<St7789State>) => {
      const st = ctx.state;
      if (st.bits !== 0 && !st.lost) {
        ctx.report({
          kind: St7789Diagnostic.PARTIAL_BYTE,
          message: `CS rose after ${st.bits} of 8 bits: the byte is dropped`,
          pin: CS,
        });
      }
      st.bits = 0;
      st.shift = 0;
      st.shiftX = 0;
    };

    /** The bit phase is lost: whatever comes in until CS↑ or a reset can't be placed. */
    const lose = (ctx: EvalContext<St7789State>, why: string, pin: number) => {
      const st = ctx.state;
      if (!st.lost) {
        ctx.report({ kind: St7789Diagnostic.UNCERTAIN, message: why, pin });
        lost(st.ctl);
      }
      st.lost = 1;
    };

    const levelName = (level: Level) => (level === Level.X ? 'unknown' : 'floating');

    /** SCL rose with CS LOW: SDA shifts in; the 8th bit completes the byte with D/CX. */
    const clockIn = (ctx: EvalContext<St7789State>, lateSda: boolean, lateDc: boolean) => {
      const st = ctx.state;
      complete(ctx); // a byte still in its hold window: an edge this soon broke tSCYCW anyway
      const level = ctx.read(SDA);
      const bitX = lateSda || (level !== Level.L0 && level !== Level.L1);
      st.shift = ((st.shift << 1) | (level === Level.L1 ? 1 : 0)) & 0xff;
      st.shiftX = ((st.shiftX << 1) | (bitX ? 1 : 0)) & 0xff;
      st.edgeTaken = 1;
      if (++st.bits < 8) return;
      const dcLevel = ctx.read(DC);
      st.pending = 1;
      st.pendingValue = st.shift;
      st.pendingX = st.lost ? 0xff : st.shiftX;
      st.pendingDc =
        st.lost || lateDc || (dcLevel !== Level.L0 && dcLevel !== Level.L1)
          ? -1
          : dcLevel === Level.L1
            ? 1
            : 0;
      st.byteGen++;
      ctx.wakeAfter(COMPLETE_AFTER, token(WAKE_BYTE, st.byteGen));
      st.bits = 0;
      st.shift = 0;
      st.shiftX = 0;
    };

    /** RESX changed. */
    const resetPin = (ctx: EvalContext<St7789State>) => {
      const st = ctx.state;
      const level = ctx.read(RES);
      st.resetGen++;
      if (level === Level.L0) {
        // A byte complete before RESX fell stands; one under way is rejected (§8.5).
        complete(ctx);
        st.resetting = 1;
        st.resetFell = ctx.now;
        st.bits = 0;
        st.shift = 0;
        st.shiftX = 0;
        ctx.wakeAfter(MIN.tRW, token(WAKE_RESET, st.resetGen));
        return;
      }
      const wasLow = st.resetting === 1;
      st.resetting = 0;
      if (level !== Level.L1) {
        ctx.report({
          kind: St7789Diagnostic.UNCERTAIN,
          message: `RES is ${level === Level.X ? 'unknown' : 'floating'}: the controller may be resetting`,
          pin: RES,
        });
        uncertainReset(st.ctl, ctx.now);
        st.lost = 1;
        return;
      }
      if (!wasLow) return;
      const width = ctx.now - st.resetFell;
      if (width >= MIN.tRW) {
        resetReleased(st.ctl, ctx.now);
      } else if (width >= T_SPIKE) {
        ctx.report({
          kind: 'pulse-width-violation',
          message: `RES was LOW for ${formatTime(width)}: a reset needs at least 10 µs (5–9 µs: it may or may not reset)`,
          pin: RES,
        });
        uncertainReset(st.ctl, ctx.now);
      } else {
        ctx.report({
          kind: St7789Diagnostic.RESET_REJECTED,
          message: `RES was LOW for only ${formatTime(width)}: rejected as a spike (a reset needs 10 µs)`,
          pin: RES,
        });
      }
    };

    return {
      createState: () => ({
        ctl: createController(),
        times: checks.createTimes(),
        cs: Level.X,
        shift: 0,
        shiftX: 0,
        bits: 0,
        edgeTaken: 0,
        lost: 0,
        csKnown: 0,
        sclKnown: 0,
        pending: 0,
        pendingValue: 0,
        pendingX: 0,
        pendingDc: 0,
        byteGen: 0,
        resetting: 0,
        resetFell: 0,
        resetGen: 0,
      }),
      evaluate(ctx) {
        const st = ctx.state;
        const { times } = st;
        if (ctx.changed(RES)) resetPin(ctx);
        // CS is read when it changes, and until it is first known (tied LOW from power-on).
        const csChanged = ctx.changed(CS) || (st.cs !== Level.L0 && st.cs !== Level.L1);
        if (csChanged) st.cs = ctx.read(CS);
        const listening = !st.resetting && st.cs === Level.L0;
        const rose = listening && ctx.rose(SCL);

        // The checks look at the times before this delta; `track` records it last.
        const lateSda = sda.setup(ctx, times, rose) !== 0;
        const lateDc = dc.setup(ctx, times, rose && st.bits === 7) !== 0;
        if (sda.hold(ctx, times, st.edgeTaken === 1 && !st.resetting)) {
          if (st.pending) st.pendingX |= 1;
          else st.shiftX |= 1;
        }
        if (dc.hold(ctx, times, st.pending === 1)) st.pendingDc = -1;
        const lateSelect = csSetup.setup(ctx, times, rose) !== 0;
        csHold.hold(ctx, times, st.edgeTaken === 1);
        // Every check runs (an `||` would hide the next one's report at the same edge).
        const shortHigh = sclHigh.check(ctx, times, listening);
        const shortLow = sclLow.check(ctx, times, listening);
        const shortCycle = sclCycle.check(ctx, times, listening);
        const badClock = shortHigh || shortLow || shortCycle;
        const shortDeselect = csHigh.check(ctx, times, !st.resetting);

        const csUnknown = st.cs !== Level.L0 && st.cs !== Level.L1;
        if (csChanged && !st.resetting) {
          if (st.cs === Level.L1) {
            complete(ctx);
            restartByte(ctx);
            st.edgeTaken = 0;
            // CS HIGH initializes the interface: the bit phase is known again.
            if (!shortDeselect) st.lost = 0;
          } else if (csUnknown) {
            // Between bytes a glitch is harmless (HIGH would only restart a byte not begun, as a
            // memory's output window does at a byte boundary); in the middle of one it may cut it.
            if (st.bits !== 0) {
              lose(
                ctx,
                `CS is ${levelName(st.cs as Level)} in the middle of a byte: the bit phase is lost`,
                CS,
              );
            }
          } else if (shortDeselect) {
            lose(ctx, 'CS was HIGH too briefly to restart the interface (tCHW)', CS);
          }
        }
        if (!csUnknown) st.csKnown = 1;
        const sclChanged = ctx.changed(SCL);
        const scl = sclChanged ? ctx.read(SCL) : Level.L0;
        const sclUnknown = sclChanged && scl !== Level.L0 && scl !== Level.L1;
        const sclRose = sclChanged && (scl === Level.L1 || sclUnknown);
        if (csUnknown && st.csKnown && !st.resetting && sclRose) {
          lose(
            ctx,
            `SCL rose while CS was ${levelName(st.cs as Level)}: the bit phase is lost`,
            SCL,
          );
        }
        if (listening && !st.resetting) {
          if (sclUnknown) {
            if (st.sclKnown) lose(ctx, `SCL is ${levelName(scl)}: the bit phase is lost`, SCL);
          } else if (badClock || lateSelect) {
            lose(
              ctx,
              'an SCL edge too soon may or may not have been taken: the bit phase is lost',
              SCL,
            );
          }
          if (rose) clockIn(ctx, lateSda, lateDc);
        }
        if (sclChanged && !sclUnknown) st.sclKnown = 1;
        checks.track(ctx, times);
      },
      wake(ctx, wakeToken) {
        const st = ctx.state;
        const kind = wakeToken % 2;
        const gen = (wakeToken - kind) / 2;
        if (kind === WAKE_RESET) {
          if (gen === st.resetGen && st.resetting) {
            hardwareReset(st.ctl);
            st.lost = 0;
          }
        } else if (gen === st.byteGen) {
          complete(ctx);
        }
      },
    };
  },
});

/** The controller of an instance (its simulator state), for the drawer and tests. */
export function st7789Controller(state: unknown): Controller | undefined {
  if (typeof state !== 'object' || state === null || !('ctl' in state)) return undefined;
  return (state as St7789State).ctl;
}
