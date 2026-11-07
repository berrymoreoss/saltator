/**
 * `periph/hd44780`: a character LCD module with the Hitachi HD44780U controller, its 16-pin
 * header (Newhaven NHD-0216K1Z pinout), sizes 8 × 1 to 40 × 2. The bus side lives here — `E`
 * edges, the data sheet's bus timing checks, the read window, the internal pull-ups — the
 * controller in `hd44780-controller.ts`, the glass in `hd44780-frame.ts`.
 * Spec: docs/components.md#hd44780; decision: docs/adr/0022-character-lcd.md.
 */
import {
  Drive,
  defineComponent,
  type EvalContext,
  formatTime,
  Level,
  ms,
  ns,
  type PinDef,
  type PinTimes,
  type SymbolDef,
  type SymbolPin,
  type Time,
  TimingChecks,
  type TimingDef,
  us,
} from '../../core';
import {
  type Controller,
  type ControllerTiming,
  completeTransfer,
  createController,
  Hd44780Diagnostic,
  type Reporter,
  startRead,
  Unknown,
} from './hd44780-controller';
import { blinkPeriod } from './hd44780-frame';
import {
  HD44780_SIZE_LABELS,
  HD44780_SIZES,
  type Hd44780Size,
  hd44780Glass,
} from './hd44780-modules';
import { HD44780_ROMS, type Hd44780Rom } from './hd44780-rom';

/** Backlight colors of common modules: the glass color and whether its dots show light. */
export const HD44780_BACKLIGHTS = [
  'yellow-green',
  'blue',
  'white',
  'black',
  'amber',
  'red',
] as const;
export type Hd44780Backlight = (typeof HD44780_BACKLIGHTS)[number];

const BACKLIGHT_LABELS: Readonly<Record<Hd44780Backlight, string>> = {
  'yellow-green': 'Yellow-green (dark characters)',
  blue: 'Blue (white characters)',
  white: 'White (black characters)',
  black: 'Black (white characters)',
  amber: 'Amber (dark characters)',
  red: 'Red (dark characters)',
};

export interface Hd44780Props {
  readonly size: Hd44780Size;
  readonly backlight: Hd44780Backlight;
  readonly rom: Hd44780Rom;
  /** Oscillator frequency in Hz (190–350 kHz): execution times scale by 270 kHz / f. */
  readonly oscillator: number;
  readonly powerOn: 'reset' | 'unknown';
}

/** Glass geometry in grid cells, shared with the drawer: one dot pitch, a character's pitch. */
export const LCD_DOT_PITCH = 0.15;
export const LCD_CHAR_PITCH = 6 * LCD_DOT_PITCH;
export const LCD_LINE_PITCH = 10 * LCD_DOT_PITCH;

const DB = ['DB0', 'DB1', 'DB2', 'DB3', 'DB4', 'DB5', 'DB6', 'DB7'] as const;

const PINS: readonly PinDef[] = [
  { name: 'VSS', number: 1, dir: 'power', description: 'ground' },
  { name: 'VDD', number: 2, dir: 'power', description: 'supply voltage for logic (+5 V)' },
  {
    name: 'V0',
    number: 3,
    dir: 'in',
    sense: true,
    description:
      'LCD contrast voltage: LOW shows the characters, floating or HIGH hides them (not analog here)',
  },
  {
    name: 'RS',
    number: 4,
    dir: 'in',
    description:
      'register select: 0 instruction register (write), busy flag and address counter (read); 1 data register (internal pull-up)',
  },
  {
    name: 'RW',
    label: 'R/W̅',
    number: 5,
    dir: 'in',
    description: 'read/write select: 0 write, 1 read (internal pull-up)',
  },
  {
    name: 'E',
    number: 6,
    dir: 'in',
    description: 'enable: a read while HIGH, a write on the falling edge',
  },
  ...DB.map(
    (name, i): PinDef => ({
      name,
      number: 7 + i,
      dir: 'bidir',
      description:
        i < 4
          ? 'data bus, low-order bit; not used in 4-bit operation (internal pull-up)'
          : `data bus, high-order bit${i === 7 ? '; the busy flag on reads' : ''} (internal pull-up)`,
    }),
  ),
  { name: 'A', number: 15, dir: 'in', sense: true, description: 'backlight LED anode' },
  { name: 'K', number: 16, dir: 'in', sense: true, description: 'backlight LED cathode' },
];

const at = (name: string) => PINS.findIndex((p) => p.name === name);
const RS = at('RS');
const RW = at('RW');
const E = at('E');
const DB_PINS = DB.map(at);

/** Pins along the bottom edge, 1 to 16 from the left, wherever the size puts the glass. */
const PIN_PLACES: Readonly<Record<string, SymbolPin>> = Object.fromEntries(
  PINS.map((pin) => [pin.name, { side: 'bottom', offset: pin.number! } as const]),
);

/** The module's body: wide enough for the 16 pins and the glass, tall enough for its lines. */
export function hd44780Symbol(size: Hd44780Size): SymbolDef {
  const { columns, lines } = hd44780Glass(size);
  return {
    kind: 'lcd',
    width: Math.max(18, Math.ceil(columns * LCD_CHAR_PITCH + 2.5)),
    height: Math.ceil(lines * LCD_LINE_PITCH + 2.6),
    pins: PIN_PLACES,
  };
}

/** Execution times at 270 kHz (Table 6, max); Clear display from module data sheets. */
const EXEC_270 = us(37);
const LONG_270 = us(1520);
/** Bus timing, 5 V (VCC = 4.5–5.5 V): the data sheet's Bus Timing Characteristics. */
const BUS_MIN = {
  tcycE: ns(500),
  PWEH: ns(230),
  tAS: ns(40),
  tAH: ns(10),
  tDSW: ns(80),
  tH: ns(10),
  tDHR: ns(5),
} as const;
const T_DDR = ns(160);
/** The internal reset keeps BF = 1 for 10 ms; instructions wait more than 15 ms (Figures 23, 24). */
const RESET_BUSY = ms(10);
const POWER_ON_WAIT = ms(15);
/** A transfer completes once the hold times after `E` falls have passed. */
const COMPLETE_AFTER = Math.max(BUS_MIN.tAH, BUS_MIN.tH);

/** The controller's execution times at an oscillator frequency in Hz. */
export function hd44780ControllerTiming(oscillator: number): ControllerTiming {
  const scale = (t: Time) => Math.round((t * 270_000) / oscillator);
  return {
    exec: scale(EXEC_270),
    long: scale(LONG_270),
    // Figure 10: tADD = 1.5 / f (5.6 µs at 270 kHz; Table 6 says 4 µs — the longer is used).
    tADD: Math.round((1.5 / oscillator) * 1e12),
  };
}

function timingOf(props: Hd44780Props): TimingDef {
  const t = hd44780ControllerTiming(props.oscillator);
  return {
    typical: {},
    min: { ...BUS_MIN, 'power-on to first write': POWER_ON_WAIT },
    max: {
      tDDR: T_DDR,
      'Clear display': t.long,
      'Return home': t.long,
      'other instructions': t.exec,
      tADD: t.tADD,
      'internal reset (BF = 1)': RESET_BUSY,
    },
    conditions: `VCC = 4.5–5.5 V; execution at fOSC = ${props.oscillator / 1000} kHz`,
    source:
      'Hitachi HD44780U data sheet ADE-207-272(Z) Rev. 0.0: Bus Timing Characteristics (p. 52), Table 6, Figures 10, 23, 24; Clear display: Newhaven NHD-0216K1Z rev. 13',
  };
}

/** The part's state: the controller and the bus interface (plain data). */
export interface Hd44780State {
  readonly ctl: Controller;
  readonly times: PinTimes;
  /** 1 once `E` was 0 or 1: uncertain edges before that are power-on `X`, not transfers. */
  eKnown: number;
  /** 1 while a transfer is under way (`E` HIGH or possibly HIGH). */
  open: number;
  /** The transfer under way: RS and R/W̅ at `E` rising (`Level`). */
  rs: number;
  rw: number;
  /** It may not be a transfer at all (an uncertain rise). */
  uncertain: number;
  /** Its byte is unknown (a cycle-time violation). */
  bad: number;
  /** A read's output: the pins it drives, their value and unknown bits. */
  outPins: number;
  outValue: number;
  outX: number;
  readGen: number;
  /** The transfer completing (`E` fell): due at `doneAt`, -Infinity when none. */
  doneAt: Time;
  doneRs: number;
  doneRw: number;
  doneBus: number;
  doneBusX: number;
  doneCertain: number;
  doneGen: number;
}

const WAKE_READ = 0;
const WAKE_DONE = 1;
const token = (kind: number, gen: number) => gen * 2 + kind;

/** An input with the controller's pull-up: floating reads HIGH. */
const pulledUp = (level: Level): Level => (level === Level.Z ? Level.L1 : level);

export const hd44780 = defineComponent<Hd44780Props, Hd44780State>({
  type: 'periph/hd44780',
  name: 'HD44780',
  title: 'Character LCD module (HD44780)',
  keywords: ['lcd', 'hd44780', 'character display', 'text display', '1602', '2004'],
  designatorPrefix: 'DS',
  datasheet: 'https://www.sparkfun.com/datasheets/LCD/HD44780.pdf',
  props: [
    {
      key: 'size',
      label: 'Size',
      type: 'enum',
      default: '16x2',
      options: HD44780_SIZES.map((value) => ({ value, label: HD44780_SIZE_LABELS[value] })),
    },
    {
      key: 'backlight',
      label: 'Backlight',
      type: 'enum',
      default: 'yellow-green',
      options: HD44780_BACKLIGHTS.map((value) => ({ value, label: BACKLIGHT_LABELS[value] })),
    },
    {
      key: 'rom',
      label: 'Character ROM',
      type: 'enum',
      default: 'A00',
      options: HD44780_ROMS.map((value) => ({
        value,
        label: value === 'A00' ? 'A00 (Japanese standard)' : 'A02 (European standard)',
      })),
    },
    {
      key: 'oscillator',
      label: 'Oscillator',
      type: 'number',
      default: 270_000,
      min: 190_000,
      max: 350_000,
      unit: 'Hz',
      si: true,
    },
    {
      key: 'powerOn',
      label: 'Power-on',
      type: 'enum',
      default: 'reset',
      options: [
        { value: 'reset', label: 'Internal reset (busy 10 ms)' },
        { value: 'unknown', label: 'Unknown (initialize by instruction)' },
      ],
    },
  ],
  pins: PINS,
  symbol: ({ size }) => hd44780Symbol(size),
  timing: timingOf,
  // The blinking character changes with time alone: redraw at every blink phase.
  animation: ({ ctl }, { oscillator }) =>
    ctl.d && (ctl.b || ctl.unknown & Unknown.B) ? blinkPeriod(oscillator) / 2 : undefined,
  create: (props) => {
    const timing = hd44780ControllerTiming(props.oscillator);
    const checks = new TimingChecks(PINS, BUS_MIN);
    const address = checks.setupHold({ data: 'RS, RW', clock: 'E', edge: 'rise', setup: 'tAS' });
    const addressHold = checks.setupHold({ data: 'RS, RW', clock: 'E', edge: 'fall', hold: 'tAH' });
    const dataLow = checks.setupHold({
      data: 'DB0, DB1, DB2, DB3',
      clock: 'E',
      edge: 'fall',
      setup: 'tDSW',
      hold: 'tH',
    });
    const dataHigh = checks.setupHold({
      data: 'DB4, DB5, DB6, DB7',
      clock: 'E',
      edge: 'fall',
      setup: 'tDSW',
      hold: 'tH',
    });
    const pulse = checks.pulseWidth({ pin: 'E', level: 'high', width: 'PWEH' });
    const cycle = checks.cycle({ pin: 'E', edge: 'rise', cycle: 'tcycE' });

    const reporter =
      (ctx: EvalContext<Hd44780State>): Reporter =>
      (kind, message) =>
        ctx.report({ kind, message });

    /** Drives a read's output (strong levels, `X` for unknown bits) on its pins. */
    const driveOutput = (ctx: EvalContext<Hd44780State>, value: number, x: number) => {
      const { outPins } = ctx.state;
      for (let i = 0; i < 8; i++) {
        const bit = 1 << i;
        if (!(outPins & bit)) continue;
        const drive = x & bit ? Drive.STRONG_X : value & bit ? Drive.STRONG_1 : Drive.STRONG_0;
        ctx.drive(DB_PINS[i]!, drive, 0);
      }
    };

    /** Ends a read's output: held for `tDHR`, then the pull-ups. */
    const releaseOutput = (ctx: EvalContext<Hd44780State>) => {
      const st = ctx.state;
      if (!st.outPins) return;
      st.readGen++;
      for (let i = 0; i < 8; i++) {
        if (st.outPins & (1 << i)) ctx.drive(DB_PINS[i]!, Drive.WEAK_1, BUS_MIN.tDHR);
      }
      st.outPins = 0;
    };

    /** Completes the transfer that `E` falling (or possibly falling) ended. */
    const complete = (ctx: EvalContext<Hd44780State>) => {
      const st = ctx.state;
      if (st.doneAt === -Infinity) return;
      st.doneAt = -Infinity;
      st.doneGen++;
      completeTransfer(
        st.ctl,
        ctx.now,
        timing,
        {
          rw: st.doneRw as Level,
          rs: st.doneRs as Level,
          bus: st.doneBus,
          busX: st.doneBusX,
          certain: st.doneCertain === 1,
        },
        reporter(ctx),
      );
    };

    /** A transfer begins: `E` rose (or may have). A read starts giving out its data. */
    const begin = (ctx: EvalContext<Hd44780State>, setupBits: number, certain: boolean) => {
      const st = ctx.state;
      complete(ctx); // a cycle shorter than the hold window: finish the last one first
      st.open = 1;
      st.uncertain = certain ? 0 : 1;
      st.rs = setupBits & 1 ? Level.X : pulledUp(ctx.read(RS));
      st.rw = setupBits & 2 ? Level.X : pulledUp(ctx.read(RW));
      if (st.rw === Level.L0) return;
      const { now } = ctx;
      if (st.rs !== Level.L0 && now < POWER_ON_WAIT) {
        ctx.report({
          kind: Hd44780Diagnostic.POWER_ON,
          message: `data read ${formatTime(now)} after power-on: the data sheet asks for more than 15 ms`,
        });
      }
      const out = st.rw === Level.L1 ? startRead(st.ctl, now, st.rs as Level, reporter(ctx)) : null;
      st.outPins = out?.pins ?? 0xff;
      st.outValue = out?.value ?? 0;
      st.outX = out && certain && !st.bad ? out.x : 0xff;
      // X from the rise until the data is valid (tDDR).
      driveOutput(ctx, 0, 0xff);
      st.readGen++;
      if (st.outX !== 0xff) ctx.wakeAfter(T_DDR, token(WAKE_READ, st.readGen));
    };

    /** A transfer ends: `E` fell (or may have). The bus is latched; it completes after tAH/tH. */
    const end = (ctx: EvalContext<Hd44780State>, setupBits: number, certain: boolean) => {
      const st = ctx.state;
      st.open = 0;
      let bus = 0;
      let busX = setupBits;
      for (let i = 0; i < 8; i++) {
        const level = pulledUp(ctx.read(DB_PINS[i]!));
        if (level === Level.L1) bus |= 1 << i;
        else if (level !== Level.L0) busX |= 1 << i;
      }
      if (st.bad) busX = 0xff;
      st.doneRs = st.rs;
      st.doneRw = st.rw;
      st.doneBus = bus;
      st.doneBusX = busX;
      st.doneCertain = certain && !st.uncertain ? 1 : 0;
      st.doneAt = ctx.now + COMPLETE_AFTER;
      st.doneGen++;
      ctx.wakeAfter(COMPLETE_AFTER, token(WAKE_DONE, st.doneGen));
      st.bad = 0;
      releaseOutput(ctx);
      if (st.rw !== Level.L1 && ctx.now < POWER_ON_WAIT) {
        ctx.report({
          kind: Hd44780Diagnostic.POWER_ON,
          message: `written ${formatTime(ctx.now)} after power-on: the data sheet asks for more than 15 ms`,
        });
      }
    };

    return {
      createState: () => ({
        ctl: createController(props.powerOn, RESET_BUSY),
        times: checks.createTimes(),
        eKnown: 0,
        open: 0,
        rs: Level.X,
        rw: Level.X,
        uncertain: 0,
        bad: 0,
        outPins: 0,
        outValue: 0,
        outX: 0,
        readGen: 0,
        doneAt: -Infinity,
        doneRs: Level.X,
        doneRw: Level.X,
        doneBus: 0,
        doneBusX: 0,
        doneCertain: 0,
        doneGen: 0,
      }),
      init(ctx) {
        // The pull-up MOS transistors on DB0–DB7.
        for (const pin of DB_PINS) ctx.drive(pin, Drive.WEAK_1, 0);
      },
      evaluate(ctx) {
        const st = ctx.state;
        const { times } = st;
        const e = ctx.read(E);
        const rose = ctx.rose(E);
        const fell = ctx.fell(E);
        const writing = st.rw !== Level.L1;
        const eightBit = (st.ctl.iface & 1) !== 0;

        // The checks look at the times before this delta; `track` records it last.
        const lateAddress = address.setup(ctx, times);
        if (cycle.check(ctx, times)) st.bad = 1;
        const shortPulse = pulse.check(ctx, times);
        const lateData =
          dataLow.setup(ctx, times, writing && eightBit) |
          (dataHigh.setup(ctx, times, writing) << 4);
        const doneWrite = st.doneRw !== Level.L1;
        const earlyData =
          dataLow.hold(ctx, times, doneWrite && eightBit) |
          (dataHigh.hold(ctx, times, doneWrite) << 4);
        const earlyAddress = addressHold.hold(ctx, times);

        // Changes within the hold window make what was latched uncertain.
        if (st.doneAt !== -Infinity) {
          st.doneBusX |= earlyData;
          if (earlyAddress & 1) st.doneRs = Level.X;
          if (earlyAddress & 2) st.doneRw = Level.X;
        }

        if (e === Level.L0 || e === Level.L1) {
          if (rose) begin(ctx, lateAddress, true);
          else if (fell) end(ctx, shortPulse ? 0xff : lateData, true);
          else if (ctx.changed(E) && st.eKnown) {
            // From X or Z to a level: a possible edge.
            if (e === Level.L1 && !st.open) begin(ctx, 0, false);
            if (e === Level.L0 && st.open) end(ctx, 0xff, false);
          }
          st.eKnown = 1;
        } else if (ctx.changed(E) && st.eKnown) {
          ctx.report({
            kind: Hd44780Diagnostic.UNCERTAIN_ENABLE,
            message: `E is ${e === Level.X ? 'unknown' : 'floating'}: a transfer may or may not happen`,
            pin: E,
          });
          if (st.open) end(ctx, 0xff, false);
          else begin(ctx, 0, false);
        }

        // RS and R/W̅ must hold from tAS before E rises until tAH after it falls.
        if (st.open && !rose && (ctx.changed(RS) || ctx.changed(RW))) {
          const pin = ctx.changed(RS) ? RS : RW;
          ctx.report({
            kind: 'hold-violation',
            message: `${PINS[pin]!.name} changed while E was HIGH (stable from tAS before E rises to tAH after it falls)`,
            pin,
          });
          if (ctx.changed(RS)) st.rs = Level.X;
          if (ctx.changed(RW)) st.rw = Level.X;
          if (st.rw !== Level.L0) {
            st.readGen++;
            st.outPins = 0xff;
            driveOutput(ctx, 0, 0xff);
          }
        }
        checks.track(ctx, times);
      },
      wake(ctx, wakeToken) {
        const st = ctx.state;
        const kind = wakeToken % 2;
        const gen = (wakeToken - kind) / 2;
        if (kind === WAKE_READ) {
          if (gen === st.readGen && st.outPins) driveOutput(ctx, st.outValue, st.outX);
        } else if (gen === st.doneGen) {
          complete(ctx);
        }
      },
    };
  },
});

/** The controller of an instance (its simulator state), for the drawer and tests. */
export function hd44780Controller(state: unknown): Controller | undefined {
  if (typeof state !== 'object' || state === null || !('ctl' in state)) return undefined;
  return (state as Hd44780State).ctl;
}
