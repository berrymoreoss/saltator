/**
 * `cpu/w65c02s`: the WDC W65C02S microprocessor, DIP-40, as its data sheet's 5 V column
 * describes it. The pure core (`w65c02s-core.ts`) decides what each bus cycle does; this file
 * puts the cycles on the pins with Figure 6-3's timing and checks Table 6-3's requirements:
 *
 * - PHI2 falling at t0 ends a cycle: read data and the control inputs are sampled; the core
 *   advances at t0 + tDHR (a wake-up), when a hold violation can no longer change what it
 *   read. Outputs that change keep their old level until t0 + tAH, are `X` until t0 + tADS,
 *   then show the new cycle (Q5: lines that keep their level don't move).
 * - PHI2 rising at t1: a write drives `X` from t1 and the data from t1 + tMDS, held until
 *   tDHW after the next fall; SOB is sampled.
 *
 * Spec: docs/components.md#w65c02s; decision: docs/adr/0028-cpu-model.md.
 */
import {
  type CpuMode,
  type CpuView,
  Drive,
  defineComponent,
  type EvalContext,
  Level,
  ns,
  type PinDef,
  type PinTimes,
  pinIndex,
  TimingChecks,
  type TimingDef,
  toInput,
} from '../../core';
import {
  createCore,
  currentInstruction,
  endCycle,
  Flag,
  holdReset,
  LostReason,
  lose,
  Mode,
  setOverflow,
  startReset,
  type W65C02SCore,
} from './w65c02s-core';

const DATASHEET = 'https://www.westerndesigncenter.com/wdc/documentation/w65c02s.pdf';

const ADDRESS = Array.from({ length: 16 }, (_, i) => `A${i}`);
const DATA = Array.from({ length: 8 }, (_, i) => `D${i}`);

/** Figure 3-1 (40-pin PDIP), descriptions from §3. */
const PINS: readonly PinDef[] = [
  {
    name: 'VPB',
    number: 1,
    dir: 'out',
    description: 'vector pull: LOW while an interrupt or reset vector is read',
  },
  {
    name: 'RDY',
    number: 2,
    dir: 'bidir',
    description:
      'ready: LOW halts the processor in the current cycle; WAI pulls it LOW (use a pull-up)',
  },
  {
    name: 'PHI1O',
    number: 3,
    dir: 'out',
    description: 'phase 1 out: PHI2 inverted (older systems)',
  },
  {
    name: 'IRQB',
    number: 4,
    dir: 'in',
    description: 'interrupt request (active LOW, level; masked by the I flag)',
  },
  {
    name: 'MLB',
    number: 5,
    dir: 'out',
    description: 'memory lock: LOW during the modify and write cycles of read-modify-write',
  },
  {
    name: 'NMIB',
    number: 6,
    dir: 'in',
    description: 'non-maskable interrupt (a falling edge)',
  },
  { name: 'SYNC', number: 7, dir: 'out', description: 'HIGH during an opcode fetch cycle' },
  { name: 'VDD', number: 8, dir: 'power', description: 'positive power supply' },
  ...ADDRESS.slice(0, 12).map(
    (name, i): PinDef => ({ name, number: 9 + i, dir: 'tristate', description: 'address bus' }),
  ),
  { name: 'VSS', number: 21, dir: 'power', description: 'internal logic ground' },
  ...ADDRESS.slice(12).map(
    (name, i): PinDef => ({ name, number: 22 + i, dir: 'tristate', description: 'address bus' }),
  ),
  ...DATA.map(
    (name, i): PinDef => ({ name, number: 33 - i, dir: 'bidir', description: 'data bus' }),
  ),
  {
    name: 'RWB',
    number: 34,
    dir: 'tristate',
    description: 'read/write: HIGH reads, LOW writes (high impedance while BE is LOW)',
  },
  { name: 'NC', number: 35, dir: 'nc', description: 'no connection' },
  {
    name: 'BE',
    number: 36,
    dir: 'in',
    description: 'bus enable: LOW releases the address bus, data bus and RWB (asynchronous)',
  },
  { name: 'PHI2', number: 37, dir: 'in', clock: true, description: 'phase 2 in: the clock' },
  {
    name: 'SOB',
    number: 38,
    dir: 'in',
    description: 'set overflow: a falling edge sets V (sampled when PHI2 rises)',
  },
  { name: 'PHI2O', number: 39, dir: 'out', description: 'phase 2 out: PHI2 (older systems)' },
  {
    name: 'RESB',
    number: 40,
    dir: 'in',
    description: 'reset (active LOW): hold LOW at least two clock cycles; then seven cycles',
  },
];

/** The clock outputs' delay: no 65C02 data sheet found gives one, so this is an estimate. */
const CLOCK_OUT = 'tD(PHI2 to PHI1O, PHI2O)';

const TIMING: TimingDef = {
  typical: {},
  max: { tADS: ns(30), tMDS: ns(25), tBVD: ns(25), [CLOCK_OUT]: ns(10) },
  min: {
    tAH: ns(10),
    tDHW: ns(10),
    tDSR: ns(10),
    tDHR: ns(10),
    tPCS: ns(10),
    tPCH: ns(10),
    tPWH: ns(35),
    tPWL: ns(35),
    tCYC: ns(70),
    tACC: ns(30),
  },
  conditions: 'VDD = 5.0 V ± 5 %, CEXT = 35 pF; TA = 0 to 70 °C (DIP)',
  source: `WDC W65C02S data sheet (April 8, 2022), Table 6-3 and Figure 6-3; ${CLOCK_OUT}: an estimate, not in the data sheet`,
};

const limit = (key: string, table: Readonly<Record<string, number>> | undefined) =>
  table?.[key] ?? 0;
const T_ADS = limit('tADS', TIMING.max);
const T_MDS = limit('tMDS', TIMING.max);
const T_BVD = limit('tBVD', TIMING.max);
const T_CLOCK_OUT = limit(CLOCK_OUT, TIMING.max);
const T_AH = limit('tAH', TIMING.min);
const T_DHW = limit('tDHW', TIMING.min);
const T_DHR = limit('tDHR', TIMING.min);

export const CpuDiagnostic = {
  /** The CPU acted on unknown bits (or an unknown control input): its state is unknown. */
  LOST: 'cpu-lost',
} as const;

/** One instance's state: the core and what the pins need to remember (plain data). */
export interface W65C02SState {
  readonly core: W65C02SCore;
  readonly times: PinTimes;
  /** The level each output shows or is about to show: A0–A15, RWB, SYNC, VPB, MLB. */
  readonly shown: Uint8Array;
  /** Generation of the PHI2 wake-ups; every PHI2 edge makes older ones stale. */
  gen: number;
  /** Generation of BE's wake-up. */
  beGen: number;
  /** The data read at the last falling edge and its unknown bits. */
  latch: number;
  ulatch: number;
  /** Whether the cycle that ended at the last falling edge was a read the core uses. */
  read: number;
  /** Control inputs sampled at the last falling edge (Levels). */
  rdy: number;
  irqb: number;
  nmib: number;
  resb: number;
  /** NMIB and SOB as sampled before, for their edges. */
  nmiPrev: number;
  sobPrev: number;
  /** Falling edges seen while RESB was sampled LOW. */
  resetCycles: number;
  /** BE as last read. */
  be: number;
  /** The data bus drives this cycle's write (or a lost CPU's possible one). */
  writing: number;
  /** RDY is driven LOW (WAI). */
  rdyLow: number;
  /** PHI2 has been 0 or 1 once (before that, an `X` is a gate output starting up). */
  clockKnown: number;
  /** The current loss was reported. */
  lostReported: number;
}

const OUTPUTS = 20;
const RWB_OUT = 16;
const SYNC_OUT = 17;
const VPB_OUT = 18; // MLB is 19

/** Wake-up kinds, in a token's low two bits; the generation above them. */
const W_LATCH = 0;
const W_OUTPUTS = 1;
const W_WRITE = 2;
const W_BE = 3;

const MODES: readonly CpuMode[] = ['running', 'reset', 'waiting', 'stopped', 'unknown'];

const LOST_MESSAGES: Readonly<Record<number, string>> = {
  [LostReason.opcode]: 'fetched an opcode with unknown bits',
  [LostReason.branch]: 'branched on an unknown condition',
  [LostReason.pc]: 'jumped to an address with unknown bits',
  [LostReason.page]: 'indexed across a page boundary nobody knows',
  [LostReason.decimal]: 'ran ADC/SBC with the D flag unknown',
  [LostReason.interrupt]: 'may or may not take an interrupt (IRQB, NMIB or the I flag unknown)',
};

const hex4 = (value: number) => `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;

export const w65c02s = defineComponent<Record<string, never>, W65C02SState>({
  type: 'cpu/w65c02s',
  name: 'W65C02S',
  title: '8-bit microprocessor (65C02)',
  keywords: ['6502', '65c02', 'cpu', 'microprocessor', 'wdc'],
  datasheet: DATASHEET,
  pins: PINS,
  package: { kind: 'dip', pins: 40 },
  timing: TIMING,
  cpu: {
    registers: [
      { name: 'A', width: 8 },
      { name: 'X', width: 8 },
      { name: 'Y', width: 8 },
      { name: 'S', width: 8 },
      { name: 'PC', width: 16 },
      { name: 'P', width: 8, flags: 'NV-BDIZC' },
    ],
    programCounter: 'PC',
    addressPins: ADDRESS,
    dataPins: DATA,
    view(state): CpuView {
      const c = state.core;
      return {
        values: [c.a, c.x, c.y, c.s, c.pc, c.p],
        unknown: [c.ua, c.ux, c.uy, c.us, c.upc, c.up],
        mode: MODES[c.mode] ?? 'unknown',
        instruction: currentInstruction(c),
      };
    },
  },
  create() {
    const pin = (name: string) => pinIndex(PINS, name);
    const data = Int32Array.from(DATA, pin);
    const outputs = Int32Array.from([...ADDRESS, 'RWB', 'SYNC', 'VPB', 'MLB'], pin);
    const PHI2 = pin('PHI2');
    const PHI1O = pin('PHI1O');
    const PHI2O = pin('PHI2O');
    const RDY = pin('RDY');
    const IRQB = pin('IRQB');
    const NMIB = pin('NMIB');
    const RESB = pin('RESB');
    const SOB = pin('SOB');
    const BE = pin('BE');

    const checks = new TimingChecks(PINS, TIMING.min);
    const readData = checks.setupHold({
      data: DATA.join(', '),
      clock: 'PHI2',
      edge: 'fall',
      setup: 'tDSR',
      hold: 'tDHR',
    });
    const control = checks.setupHold({
      data: 'RDY, IRQB, NMIB, RESB',
      clock: 'PHI2',
      edge: 'fall',
      setup: 'tPCS',
      hold: 'tPCH',
    });
    const overflow = checks.setupHold({
      data: 'SOB',
      clock: 'PHI2',
      edge: 'rise',
      setup: 'tPCS',
      hold: 'tPCH',
    });
    const high = checks.pulseWidth({ pin: 'PHI2', level: 'high', width: 'tPWH' });
    const low = checks.pulseWidth({ pin: 'PHI2', level: 'low', width: 'tPWL' });
    const cycle = checks.cycle({ pin: 'PHI2', edge: 'fall', cycle: 'tCYC' });

    type Ctx = EvalContext<W65C02SState>;

    /** What output `i` should show for the core's cycle. */
    const desired = (c: W65C02SCore, i: number): Level => {
      if (c.mode === Mode.unknown) return Level.X;
      if (i < 16) {
        if ((c.uaddr >> i) & 1) return Level.X;
        return (c.addr >> i) & 1 ? Level.L1 : Level.L0;
      }
      if (i === RWB_OUT) return c.write ? Level.L0 : Level.L1;
      if (i === SYNC_OUT) return c.sync ? Level.L1 : Level.L0;
      if (i === VPB_OUT) return c.vpb ? Level.L1 : Level.L0;
      return c.mlb ? Level.L1 : Level.L0;
    };

    const enabled = (s: W65C02SState) => s.be === Level.L1;

    const levelDrive = (level: number) =>
      level === Level.L0 ? Drive.STRONG_0 : level === Level.L1 ? Drive.STRONG_1 : Drive.STRONG_X;

    /** An output pin's drive: released while BE is LOW (A0–A15, RWB), `X` while BE is unknown. */
    const outputDrive = (s: W65C02SState, i: number, level: number) => {
      if (i > RWB_OUT || s.be === Level.L1) return levelDrive(level);
      return s.be === Level.L0 ? Drive.Z : Drive.STRONG_X;
    };

    /**
     * The new cycle's outputs: those that change go `X` after `xDelay` and show their level
     * at the outputs wake-up `valid` later.
     */
    const updateOutputs = (ctx: Ctx, xDelay: number, valid: number) => {
      const s = ctx.state;
      let changed = false;
      for (let i = 0; i < OUTPUTS; i++) {
        const level = desired(s.core, i);
        if (level === s.shown[i]) continue;
        s.shown[i] = level;
        changed = true;
        ctx.drive(outputs[i]!, outputDrive(s, i, Level.X), xDelay);
      }
      if (changed) ctx.wakeAfter(valid, (s.gen << 2) | W_OUTPUTS);
    };

    const showOutputs = (ctx: Ctx) => {
      const s = ctx.state;
      for (let i = 0; i < OUTPUTS; i++) {
        ctx.drive(outputs[i]!, outputDrive(s, i, s.shown[i]!), 0);
      }
    };

    const driveData = (ctx: Ctx, drive: (bit: number) => Drive, delay: number) => {
      for (let i = 0; i < 8; i++) ctx.drive(data[i]!, drive(i), delay);
    };

    /** Reports a loss the core decided, once. */
    const reportLoss = (ctx: Ctx) => {
      const s = ctx.state;
      const c = s.core;
      if (c.mode !== Mode.unknown || s.lostReported || c.lostReason === LostReason.none) return;
      s.lostReported = 1;
      const why = LOST_MESSAGES[c.lostReason];
      if (!why) return; // external: the violation that caused it was reported
      ctx.report({
        kind: CpuDiagnostic.LOST,
        message: `${ctx.id} ${why} at ${hex4(c.lostAt)}: its state is unknown until RESB`,
      });
    };

    /** The part loses the CPU (a clock or control problem), reporting `message` if given. */
    const loseExternal = (ctx: Ctx, message?: string, pinRef?: number) => {
      const s = ctx.state;
      const c = s.core;
      if (c.mode === Mode.unknown) return;
      lose(c, LostReason.external, c.addr);
      s.lostReported = 1;
      if (message) ctx.report({ kind: CpuDiagnostic.LOST, message, pin: pinRef });
      updateOutputs(ctx, 0, 0);
      if (s.rdyLow) {
        s.rdyLow = 0;
        ctx.drive(RDY, Drive.Z, 0);
      }
    };

    const sample = (ctx: Ctx, pinRef: number, late: boolean) =>
      late ? Level.X : toInput(ctx.read(pinRef));

    /** PHI2 fell: the cycle ends. */
    const onFall = (ctx: Ctx, lateData: number, lateControl: number) => {
      const s = ctx.state;
      const c = s.core;
      s.gen++;
      if (s.writing) {
        s.writing = 0;
        if (enabled(s)) driveData(ctx, () => Drive.Z, T_DHW);
      }
      s.read = c.mode === Mode.running && !c.write ? 1 : 0;
      if (s.read) {
        let value = 0;
        let unknown = lateData;
        for (let i = 0; i < 8; i++) {
          const level = toInput(ctx.read(data[i]!));
          if (level === Level.L1) value |= 1 << i;
          else if (level !== Level.L0) unknown |= 1 << i;
        }
        s.latch = value & ~unknown;
        s.ulatch = unknown;
      }
      s.rdy = sample(ctx, RDY, (lateControl & 1) !== 0);
      s.irqb = sample(ctx, IRQB, (lateControl & 2) !== 0);
      s.nmib = sample(ctx, NMIB, (lateControl & 4) !== 0);
      s.resb = sample(ctx, RESB, (lateControl & 8) !== 0);
      ctx.wakeAfter(T_DHR, (s.gen << 2) | W_LATCH);
    };

    /** t0 + tDHR: the core takes what it read and the control inputs, and moves on. */
    const onLatch = (ctx: Ctx) => {
      const s = ctx.state;
      const c = s.core;
      if (s.resb === Level.L0) {
        if (c.mode !== Mode.reset) holdReset(c);
        s.lostReported = 0;
        s.resetCycles++;
      } else if (s.resb !== Level.L1) {
        loseExternal(ctx, `${ctx.id}: RESB is unknown, so is the CPU's state`, RESB);
      } else if (c.mode === Mode.reset) {
        if (s.resetCycles < 2) {
          ctx.report({
            kind: 'pulse-width-violation',
            message: `RESB was LOW for only ${s.resetCycles} clock cycle (at least 2)`,
            pin: RESB,
          });
          s.resetCycles = 0;
          lose(c, LostReason.external, c.addr);
          s.lostReported = 1;
        } else {
          s.resetCycles = 0;
          startReset(c);
        }
      } else if (c.mode === Mode.running || c.mode === Mode.waiting) {
        c.irq = s.irqb === Level.L0 ? 1 : s.irqb === Level.L1 ? 0 : 2;
        if (s.nmiPrev === Level.L1 && s.nmib === Level.L0) c.nmi = 1;
        else if (
          (s.nmiPrev === Level.L1 && s.nmib === Level.X) ||
          (s.nmiPrev === Level.X && s.nmib === Level.L0 && s.clockKnown)
        ) {
          lose(c, LostReason.interrupt, c.pc);
        }
        if (c.mode === Mode.waiting) endCycle(c, 0, 0);
        else if (c.mode === Mode.running) {
          if (s.rdy === Level.L1) {
            endCycle(c, s.read ? s.latch : 0, s.read ? s.ulatch : 0);
          } else if (s.rdy !== Level.L0) {
            loseExternal(ctx, `${ctx.id}: RDY is unknown, so is whether the CPU halted`, RDY);
          }
          // RDY LOW: halted, the cycle repeats.
        }
      }
      s.nmiPrev = s.nmib;
      reportLoss(ctx);
      updateOutputs(ctx, Math.max(0, T_AH - T_DHR), T_ADS - T_DHR);
      const waiting = c.mode === Mode.waiting ? 1 : 0;
      if (waiting !== s.rdyLow) {
        s.rdyLow = waiting;
        ctx.drive(RDY, waiting ? Drive.STRONG_0 : Drive.Z, waiting ? T_ADS - T_DHR : 0);
      }
    };

    /** PHI2 rose: a write puts its data on the bus; SOB is sampled. */
    const onRise = (ctx: Ctx, lateSob: boolean) => {
      const s = ctx.state;
      const c = s.core;
      s.gen++;
      const sob = sample(ctx, SOB, lateSob);
      if (c.mode === Mode.running) {
        if (s.sobPrev === Level.L1 && sob === Level.L0) setOverflow(c);
        else if (s.sobPrev !== sob && (s.sobPrev === Level.X || sob === Level.X)) {
          if (s.clockKnown && s.sobPrev !== Level.X) {
            c.p &= ~Flag.V;
            c.up |= Flag.V;
          }
        }
      }
      s.sobPrev = sob;
      const writes = (c.mode === Mode.running && c.write === 1) || c.mode === Mode.unknown;
      if (!writes) return;
      s.writing = 1;
      if (!enabled(s)) return;
      driveData(ctx, () => Drive.STRONG_X, 0);
      if (c.mode === Mode.running) ctx.wakeAfter(T_MDS, (s.gen << 2) | W_WRITE);
    };

    const writeDrive =
      (c: W65C02SCore) =>
      (bit: number): Drive =>
        (c.uwdata >> bit) & 1
          ? Drive.STRONG_X
          : (c.wdata >> bit) & 1
            ? Drive.STRONG_1
            : Drive.STRONG_0;

    return {
      createState: () => ({
        core: createCore(),
        times: checks.createTimes(),
        shown: new Uint8Array(OUTPUTS).fill(Level.X),
        gen: 0,
        beGen: 0,
        latch: 0,
        ulatch: 0,
        read: 0,
        rdy: Level.X,
        irqb: Level.X,
        nmib: Level.X,
        resb: Level.X,
        nmiPrev: Level.X,
        sobPrev: Level.X,
        resetCycles: 0,
        be: Level.X,
        writing: 0,
        rdyLow: 0,
        clockKnown: 0,
        lostReported: 0,
      }),

      init(ctx) {
        const s = ctx.state;
        // Power-on: nobody knows what the outputs show until a reset. BE is read when it
        // changes only (a gate output starting up, or a pull-up, makes it change at t = 0).
        for (let i = 0; i <= RWB_OUT; i++) ctx.drive(outputs[i]!, outputDrive(s, i, Level.X), 0);
      },

      evaluate(ctx) {
        const s = ctx.state;
        const { times } = s;
        const c = s.core;
        const clockChanged = ctx.changed(PHI2);
        const fell = ctx.fell(PHI2);
        const rose = ctx.rose(PHI2);
        // Requirements first (they look at the times before this delta's changes).
        const lateData = readData.setup(ctx, times, s.core.mode === Mode.running && !c.write);
        const lateControl = control.setup(ctx, times);
        const lateSob = overflow.setup(ctx, times) !== 0;
        if (s.read) s.ulatch |= readData.hold(ctx, times, true);
        const heldControl = control.hold(ctx, times);
        if (heldControl & 1) s.rdy = Level.X;
        if (heldControl & 2) s.irqb = Level.X;
        if (heldControl & 4) s.nmib = Level.X;
        if (heldControl & 8) s.resb = Level.X;
        overflow.hold(ctx, times);
        let clockBad = false;
        if (clockChanged) {
          // Every check reports its own violation (no short circuit).
          const shortHigh = high.check(ctx, times);
          const shortLow = low.check(ctx, times);
          const shortCycle = cycle.check(ctx, times);
          clockBad = shortHigh || shortLow || shortCycle;
          const level = toInput(ctx.read(PHI2));
          const known = level === Level.L0 || level === Level.L1;
          const drive = levelDrive(level);
          const inverted =
            level === Level.L0
              ? Drive.STRONG_1
              : level === Level.L1
                ? Drive.STRONG_0
                : Drive.STRONG_X;
          ctx.drive(PHI2O, drive, T_CLOCK_OUT);
          ctx.drive(PHI1O, inverted, T_CLOCK_OUT);
          if (!known && s.clockKnown) {
            loseExternal(ctx, `${ctx.id}: PHI2 went unknown, so did the CPU's state`, PHI2);
          }
          if (known) s.clockKnown = 1;
        }
        if (ctx.changed(BE)) {
          s.be = toInput(ctx.read(BE));
          s.beGen++;
          const on = s.be === Level.L1;
          for (let i = 0; i <= RWB_OUT; i++) {
            ctx.drive(
              outputs[i]!,
              on ? Drive.STRONG_X : outputDrive(s, i, Level.X),
              on ? 0 : T_BVD,
            );
          }
          if (s.writing) driveData(ctx, () => (on ? Drive.STRONG_X : Drive.Z), on ? 0 : T_BVD);
          if (on) ctx.wakeAfter(T_BVD, (s.beGen << 2) | W_BE);
        }
        if (fell) onFall(ctx, lateData, lateControl);
        if (rose) onRise(ctx, lateSob);
        if (clockBad) loseExternal(ctx);
        checks.track(ctx, times);
      },

      wake(ctx, token) {
        const s = ctx.state;
        const kind = token & 3;
        const gen = token >> 2;
        if (kind === W_BE) {
          if (gen !== s.beGen || s.be !== Level.L1) return;
          showOutputs(ctx);
          if (s.writing && s.core.mode === Mode.running) driveData(ctx, writeDrive(s.core), 0);
          return;
        }
        if (gen !== s.gen) return;
        if (kind === W_LATCH) onLatch(ctx);
        else if (kind === W_OUTPUTS) showOutputs(ctx);
        else if (kind === W_WRITE && s.writing && enabled(s)) {
          driveData(ctx, writeDrive(s.core), 0);
        }
      },
    };
  },
});
