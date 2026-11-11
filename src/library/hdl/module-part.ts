/**
 * A Verilog module as a part (HDL-1, ADR-0030; tri-states HDL-8): the definition made from a
 * module's IR — a pin per port bit, one delay (`delay`) for every output — and its behavior, the
 * interpreter. Each `evaluate`: the flip-flops whose clock had an edge load from the values
 * before it, the input and inout pins are read, asynchronous resets apply, the combinational
 * cells, latches and tri-state buffers run once each in topological order (no events inside a
 * module), and every output is driven with the delay — released (`Z`) where its tri-state buffer
 * is off (inertial, so an unchanged output costs nothing). A floating pin reads `X`, and is
 * reported only where that `X` reaches something the module drives or stores. State is byte
 * planes over the bits — plain data, so snapshots, rewind and replicas work as for any part.
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import {
  type Behavior,
  Drive,
  defineComponent,
  type EvalContext,
  HDL_CELLS,
  type HdlModule,
  type HdlPartResult,
  hdlCellOutput,
  hdlDelayProp,
  hdlModuleProblems,
  hdlPinDirs,
  hdlPortName,
  hdlPortPins,
  Level,
  type PinDef,
  type SignalsDef,
  strong,
  toInput,
} from '../../core';
import { ClockEdge, clockEdge } from '../74xx/edge-triggered';
import { analyzeHdlModule, type HdlAnalysis, outputName, PIN } from './analyze';
import {
  active,
  applyAsync,
  compileFlipFlop,
  compileStep,
  type FlipFlop,
  hasAsync,
  load,
  nextState,
} from './cells';
import { type CellStep, newPlanes, planeIndex, TX, tri } from './planes';

type HdlProps = { delay: number };

interface HdlState {
  /** A byte per bit: its value (0 where unknown). Then the constants 0, 1, x. */
  readonly val: Uint8Array;
  /** A byte per bit: 1 where unknown. */
  readonly unk: Uint8Array;
  /** The flip-flops' next states between the two phases of a clock edge (0, 1, 2 = X). */
  readonly next: Uint8Array;
  /** Which flip-flops have a next state waiting in this evaluation. */
  readonly edges: Uint8Array;
  /** A byte per read pin: 1 where it was floating when last read. */
  readonly floating: Uint8Array;
  /** Per flip-flop, the value (0, 1, 2 = X) its clock had when it last looked (HDL-9). */
  readonly seen: Uint8Array;
}

/** A driving pin's value: a bit's (or a constant's), push-pull. */
const STRONG = 0;
/** A driving pin's value: a `$tribuf`'s — its `A` bit while `EN`, released while not, `X` while unknown. */
const BUFFER = 1;

/** The drive of each value a bit can have (0, 1, `X`). */
const DRIVES = [strong(Level.L0), strong(Level.L1), strong(Level.X)] as const;

/** A latch, for the floating rule: open (or maybe open) and holding `X` from a floating pin. */
interface Latch {
  readonly en: number;
  readonly enPolarity: number;
  readonly q: Int32Array;
  readonly cone: Int32Array;
}

/** Everything an instance runs, made once per module. */
interface Program {
  readonly bitCount: number;
  /** The pins read into the planes — inputs, inouts no logic drives — and their bits. */
  readonly readPins: Int32Array;
  readonly readBits: Int32Array;
  /** The pins that drive (outputs, inouts), how (`STRONG`, `BUFFER`), from which plane index. */
  readonly drivePins: Int32Array;
  readonly driveKinds: Uint8Array;
  readonly driveBits: Int32Array;
  /** A buffer's enable (plane index); −1 for `STRONG`. */
  readonly driveEnables: Int32Array;
  /** Per driving pin, the read pins (positions in `readPins`) its value can come from. */
  readonly driveCones: readonly Int32Array[];
  readonly steps: readonly CellStep[];
  readonly flipFlops: readonly FlipFlop[];
  /** Per flip-flop, the name of what it stores (`q`, `state`), for messages. */
  readonly flipFlopNames: readonly string[];
  /** Per flip-flop, the read pins its next state can come from. */
  readonly flipFlopCones: readonly Int32Array[];
  /** Per flip-flop, the read pins what its edge samples (D, EN, SRST) comes from: races. */
  readonly dataCones: readonly Int32Array[];
  /** Per flip-flop, its clock's pin; −1 for a clock made by logic or a constant. */
  readonly clockPins: Int32Array;
  /** Per read pin, whether it clocks a flip-flop. */
  readonly clockReads: Uint8Array;
  /** Per flip-flop, whether its data cone holds a clock pin (`q <= clk`): it races any edge. */
  readonly dataSeesClock: Uint8Array;
  /** The flip-flops clocked by logic inside the module (HDL-9). */
  readonly internal: Int32Array;
  /** The flip-flops with asynchronous controls, and the read pins those can come from. */
  readonly asyncFlops: Int32Array;
  readonly asyncCones: readonly Int32Array[];
  /** The most rounds of clock edges one evaluation runs (a ripple chain of n takes n). */
  readonly roundLimit: number;
  /** The names of the part's pins, for messages. */
  readonly pinNames: readonly string[];
  /** Per combinational loop, a signal on it, and whether it failed to settle (scratch). */
  readonly loopNames: readonly string[];
  readonly loopFailed: Uint8Array;
  readonly latches: readonly Latch[];
  /** The pin that reads each plane index (−1 for others), for clocks. */
  readonly pinOfBit: Int32Array;
  readonly nextSize: number;
  /** Bits with a power-up value (`init`, HDL-9) and their values, 0 or 1. */
  readonly initBits: Int32Array;
  readonly initValues: Uint8Array;
}

const PORT_WORDS = { in: 'input', out: 'output', inout: 'inout' } as const;

/**
 * The pins of a module: each port's bits in declaration order, least significant first; an
 * output `tristate` where a tri-state buffer drives it, an inout `bidir` (`hdlPinDirs`).
 */
export function hdlPins(module: HdlModule): PinDef[] {
  const dirs = hdlPinDirs(module);
  let pin = 0;
  return module.ports.flatMap((port) => {
    const word = PORT_WORDS[port.dir];
    const bus = hdlPortName(port);
    return hdlPortPins(port).map(
      (name, i): PinDef => ({
        name,
        dir: dirs[pin++]!,
        description:
          port.bits.length === 1 ? `${word} ${bus}` : `${word} ${bus}, bit ${port.lsb + i}`,
      }),
    );
  });
}

/**
 * A combinational loop's cells as one step (HDL-9): run over and over from the planes' values
 * until no output bit of the loop changes — an SR latch of NANDs holds, sets and resets; one that
 * starts `X` stays `X`. Past twice its cells and two passes it oscillates (a ring of inverters):
 * the bits still changing become `X` and it goes on until that settles; `failed[slot]` says so.
 */
function loopStep(
  steps: readonly CellStep[],
  outputs: Int32Array,
  failed: Uint8Array,
  slot: number,
): CellStep {
  const limit = 2 * steps.length + 2;
  const val0 = new Uint8Array(outputs.length);
  const unk0 = new Uint8Array(outputs.length);
  /** One pass over the loop; says whether an output bit changed. */
  const pass = (val: Uint8Array, unk: Uint8Array): boolean => {
    for (let i = 0; i < outputs.length; i++) {
      val0[i] = val[outputs[i]!]!;
      unk0[i] = unk[outputs[i]!]!;
    }
    for (let k = 0; k < steps.length; k++) steps[k]!(val, unk);
    let changed = false;
    for (let i = 0; i < outputs.length && !changed; i++) {
      changed = val[outputs[i]!] !== val0[i] || unk[outputs[i]!] !== unk0[i];
    }
    return changed;
  };
  /** Makes `X` every output bit the last pass changed. */
  const unknownWhereChanged = (val: Uint8Array, unk: Uint8Array) => {
    for (let i = 0; i < outputs.length; i++) {
      const b = outputs[i]!;
      if (val[b] === val0[i] && unk[b] === unk0[i]) continue;
      val[b] = 0;
      unk[b] = 1;
    }
  };
  return (val, unk) => {
    for (let p = 0; p < limit; p++) if (!pass(val, unk)) return;
    failed[slot] = 1;
    for (let p = 0; p < limit; p++) {
      unknownWhereChanged(val, unk);
      if (!pass(val, unk)) return;
    }
    unknownWhereChanged(val, unk);
  };
}

function compile(module: HdlModule, analysis: HdlAnalysis): Program {
  const { bitCount, cells } = module;
  const { driver, cones } = analysis;

  // The pins read into the planes: the inputs, then the inouts' bits no logic drives (an
  // inout sharing an input's bit drives it instead).
  const readPins: number[] = [];
  const readBits: number[] = [];
  const readPos = new Int32Array(bitCount).fill(-1);
  const pinOfBit = new Int32Array(bitCount + 3).fill(-1);
  const firstPin: number[] = [];
  let pins = 0;
  for (const port of module.ports) {
    firstPin.push(pins);
    pins += port.bits.length;
  }
  const read = (pin: number, bit: number) => {
    readPos[bit] = readPins.length;
    readPins.push(pin);
    readBits.push(bit);
    pinOfBit[bit] = pin;
  };
  for (const [p, port] of module.ports.entries()) {
    if (port.dir !== 'in') continue;
    for (const [i, bit] of port.bits.entries()) read(firstPin[p]! + i, bit as number);
  }
  for (const [p, port] of module.ports.entries()) {
    if (port.dir !== 'inout') continue;
    for (const [i, bit] of port.bits.entries()) {
      if (typeof bit === 'number' && driver[bit] === PIN && readPos[bit]! < 0) {
        read(firstPin[p]! + i, bit);
      }
    }
  }

  const isFlipFlop = (index: number) => HDL_CELLS[cells[index]!.type].kind === 'flip-flop';
  const toReadPins = (bits: readonly number[]) =>
    Int32Array.from(bits.filter((b) => readPos[b]! >= 0).map((b) => readPos[b]!));
  /** The read pins a bit's value can come from: its own, its cell's cone, none past a flip-flop. */
  const coneOfBit = (bit: number): Int32Array => {
    const from = driver[bit]!;
    if (from === PIN) return toReadPins([bit]);
    if (from < 0 || isFlipFlop(from)) return new Int32Array(0);
    return toReadPins(cones[from]!);
  };

  // The buffer driving each inout's bit through its pin (its plane driver is the pin).
  const pinBuffer = new Int32Array(bitCount).fill(-1);
  const pinBufferBit = new Int32Array(bitCount).fill(-1);
  for (const [index, cell] of cells.entries()) {
    if (cell.type !== '$tribuf') continue;
    for (const [i, bit] of cell.ports.Y!.entries()) {
      const b = bit as number;
      if (driver[b] !== index) {
        pinBuffer[b] = index;
        pinBufferBit[b] = i;
      }
    }
  }

  const drivePins: number[] = [];
  const driveKinds: number[] = [];
  const driveBits: number[] = [];
  const driveEnables: number[] = [];
  const driveCones: Int32Array[] = [];
  const drives = (pin: number, kind: number, bit: number, enable: number, cone: Int32Array) => {
    drivePins.push(pin);
    driveKinds.push(kind);
    driveBits.push(bit);
    driveEnables.push(enable);
    driveCones.push(cone);
  };
  const buffer = (pin: number, cell: number, i: number) => {
    const ports = cells[cell]!.ports;
    const a = planeIndex(ports.A![i]!, bitCount);
    drives(pin, BUFFER, a, planeIndex(ports.EN![0]!, bitCount), toReadPins(cones[cell]!));
  };
  for (const [p, port] of module.ports.entries()) {
    if (port.dir === 'in') continue;
    for (const [i, bit] of port.bits.entries()) {
      const pin = firstPin[p]! + i;
      if (bit === 'z') continue; // never driven: tristate and bidir pins start released
      if (typeof bit !== 'number') {
        drives(pin, STRONG, planeIndex(bit, bitCount), -1, new Int32Array(0));
      } else if (port.dir === 'inout' && pinOfBit[bit] === pin) {
        // The pin reads this bit back; only a buffer drives it.
        if (pinBuffer[bit]! >= 0) buffer(pin, pinBuffer[bit]!, pinBufferBit[bit]!);
      } else if (
        port.dir === 'out' &&
        driver[bit]! >= 0 &&
        cells[driver[bit]!]!.type === '$tribuf'
      ) {
        buffer(pin, driver[bit]!, cells[driver[bit]!]!.ports.Y!.indexOf(bit));
      } else {
        drives(pin, STRONG, bit, -1, coneOfBit(bit));
      }
    }
  }

  // Steps in order; a buffer writes only the bits it is the plane driver of (not an inout's). A
  // loop's cells make one step, run until they settle (HDL-9).
  const steps: CellStep[] = [];
  const latches: Latch[] = [];
  const loopOf = new Int32Array(cells.length).fill(-1);
  for (const [l, members] of analysis.loops.entries()) for (const m of members) loopOf[m] = l;
  const loopNames: string[] = [];
  const loopFailed = new Uint8Array(analysis.loops.length);
  let loopSteps: CellStep[] = [];
  for (const index of analysis.order) {
    const cell = cells[index]!;
    const l = loopOf[index]!;
    const into = l >= 0 ? loopSteps : steps;
    if (cell.type === '$tribuf') {
      const keep = cell.ports.Y!.flatMap((bit, i) => (driver[bit as number] === index ? [i] : []));
      if (keep.length > 0) {
        const ports = {
          A: keep.map((i) => cell.ports.A![i]!),
          EN: cell.ports.EN!,
          Y: keep.map((i) => cell.ports.Y![i]!),
        };
        into.push(compileStep({ ...cell, ports }, bitCount));
      }
    } else into.push(compileStep(cell, bitCount));
    const members = l >= 0 ? analysis.loops[l]! : undefined;
    if (members && index === members[members.length - 1]) {
      // The loop's last cell: its steps become one, iterated.
      const outputs = members.flatMap((m) =>
        hdlCellOutput(cells[m]!).map((bit) => planeIndex(bit, bitCount)),
      );
      steps.push(loopStep(loopSteps, Int32Array.from(outputs), loopFailed, l));
      loopNames.push(outputName(module, hdlCellOutput(cells[members[0]!]!)));
      loopSteps = [];
    }
    if (HDL_CELLS[cell.type].kind === 'latch' && cell.ports.EN) {
      latches.push({
        en: planeIndex(cell.ports.EN![0]!, bitCount),
        enPolarity: cell.params.EN_POLARITY as number,
        q: Int32Array.from(cell.ports.Q!, (bit) => planeIndex(bit, bitCount)),
        cone: toReadPins(cones[index]!),
      });
    }
  }

  let offset = 0;
  const flipFlops = analysis.flipFlops.map((index) => {
    const ff = compileFlipFlop(cells[index]!, bitCount, offset);
    offset += ff.q.length;
    return ff;
  });
  const clockPins = Int32Array.from(flipFlops, (ff) => pinOfBit[ff.clk]!);
  // A clock that is a signal bit but no pin's is made by logic; a constant one never ticks.
  const internal = Int32Array.from(
    flipFlops.flatMap((ff, k) => (ff.clk < bitCount && clockPins[k]! < 0 ? [k] : [])),
  );
  const asyncFlops = Int32Array.from(flipFlops.flatMap((ff, k) => (hasAsync(ff) ? [k] : [])));
  const clockReads = new Uint8Array(readPins.length);
  for (const ff of flipFlops)
    if (ff.clk < bitCount && readPos[ff.clk]! >= 0) clockReads[readPos[ff.clk]!] = 1;
  const dataCones = analysis.dataCones.map(toReadPins);
  const dataSeesClock = Uint8Array.from(dataCones, (cone) =>
    cone.some((p) => clockReads[p]) ? 1 : 0,
  );
  // Power-up values, as an FPGA's bitstream loads its flip-flops; `x` bits start unknown.
  const initBits: number[] = [];
  const initValues: number[] = [];
  for (const named of [...module.ports, ...module.signals]) {
    for (const [i, value] of (named.init ?? []).entries()) {
      const bit = named.bits[i];
      if (typeof bit !== 'number' || value === 'x') continue;
      initBits.push(bit);
      initValues.push(value === '1' ? 1 : 0);
    }
  }
  return {
    bitCount,
    readPins: Int32Array.from(readPins),
    readBits: Int32Array.from(readBits),
    drivePins: Int32Array.from(drivePins),
    driveKinds: Uint8Array.from(driveKinds),
    driveBits: Int32Array.from(driveBits),
    driveEnables: Int32Array.from(driveEnables),
    driveCones,
    steps,
    flipFlops,
    flipFlopNames: analysis.flipFlops.map((index) => outputName(module, cells[index]!.ports.Q!)),
    flipFlopCones: analysis.flipFlops.map((index) => toReadPins(cones[index]!)),
    dataCones,
    clockPins,
    clockReads,
    dataSeesClock,
    internal,
    asyncFlops,
    asyncCones: analysis.asyncCones.map(toReadPins),
    roundLimit: 2 * internal.length + 4,
    pinNames: hdlPins(module).map((pin) => pin.name),
    loopNames,
    loopFailed,
    latches,
    pinOfBit,
    nextSize: offset,
    initBits: Int32Array.from(initBits),
    initValues: Uint8Array.from(initValues),
  };
}

/**
 * The part module `module` runs as, of type `type` (`hdl/<circuit id>`), named `name`; no
 * definition when the module has errors (its shape or what the analysis refuses).
 */
export function hdlPart(type: string, name: string, module: HdlModule): HdlPartResult {
  const shape = hdlModuleProblems(module);
  if (shape.length > 0) {
    return { messages: shape.map((message) => ({ severity: 'error', message })) };
  }
  const analysis = analyzeHdlModule(module);
  if (analysis.messages.some((m) => m.severity === 'error')) return { messages: analysis.messages };
  const program = compile(module, analysis);
  const definition = defineComponent<HdlProps, HdlState>({
    type,
    name,
    title: `Verilog module ${module.top}`,
    keywords: ['verilog', 'module', module.top],
    pins: hdlPins(module),
    props: [hdlDelayProp],
    signals: innerSignals(module),
    create: (props) => behavior(program, props.delay),
  });
  return { definition, messages: analysis.messages };
}

/**
 * The module's named signals as the part shows them (HDL-4): each bit read from the planes,
 * where a register's or latch's state is its `Q` bits — 0, 1 and `X` are `Level`'s numbers.
 */
function innerSignals(module: HdlModule): SignalsDef<HdlState> {
  const named = module.signals.filter((s) => s.bits.length > 0);
  const list = named.map((s) => ({
    name: s.name,
    lsb: s.lsb,
    width: s.bits.length,
    ...(s.src !== undefined && { src: s.src }),
  }));
  const planes = named.map((s) => Int32Array.from(s.bits, (b) => planeIndex(b, module.bitCount)));
  return {
    list,
    level: (state, signal, bit) => tri(state.val, state.unk, planes[signal]![bit]!) as Level,
  };
}

/** Whether a flip-flop's next state (`nextState`) has an unknown bit. */
function loadsUnknown(ff: FlipFlop, next: Uint8Array): boolean {
  for (let i = 0; i < ff.q.length; i++) if (next[ff.offset + i] === TX) return true;
  return false;
}

/** Reports the floating pins among `cone` (positions in `readPins`): their `X` was used. */
function reportCone(
  ctx: EvalContext<HdlState>,
  cone: Int32Array,
  floating: Uint8Array,
  readPins: Int32Array,
): void {
  for (let i = 0; i < cone.length; i++) {
    const p = cone[i]!;
    if (floating[p]) ctx.reportFloating(readPins[p]!);
  }
}

/** What the pin clocks did in a delta: no edge, edges, or edges one of which races its data. */
const NO_EDGE = 0;
const EDGED = 1;
const RACES = 2;
type PinEdges = typeof NO_EDGE | typeof EDGED | typeof RACES;

/** The edge a clock made inside the module went through, from `was` to `now` (0, 1, `X`). */
function edgeOf(was: number, now: number, rising: boolean): ClockEdge {
  if (was === now) return ClockEdge.NONE;
  const from = rising ? 0 : 1;
  const to = rising ? 1 : 0;
  if (was === from && now === to) return ClockEdge.ACTIVE;
  return (was === from || was === TX) && (now === to || now === TX)
    ? ClockEdge.UNCERTAIN
    : ClockEdge.NONE;
}

/**
 * Merges the next state a flip-flop computed into `next` with the one in `other` (the same
 * edge seen at another moment of a race): the bits that differ become `X`. Says whether one did.
 */
function mergeRace(ff: FlipFlop, next: Uint8Array, other: Uint8Array): boolean {
  let differ = false;
  for (let i = ff.offset; i < ff.offset + ff.q.length; i++) {
    if (next[i] === other[i]) continue;
    next[i] = TX;
    differ = true;
  }
  return differ;
}

/**
 * The combinational cells, then the asynchronous controls (level-sensitive, from pins or from
 * logic), again while those change a flip-flop. Says whether they kept changing past the limit.
 */
function settlePlanes(program: Program, val: Uint8Array, unk: Uint8Array): boolean {
  const { steps, flipFlops, asyncFlops, roundLimit } = program;
  for (let k = 0; k < steps.length; k++) steps[k]!(val, unk);
  for (let round = 0; asyncFlops.length > 0; round++) {
    let changed = false;
    for (let j = 0; j < asyncFlops.length; j++) {
      if (applyAsync(flipFlops[asyncFlops[j]!]!, val, unk)) changed = true;
    }
    if (!changed) return false;
    if (round >= roundLimit) return true;
    for (let k = 0; k < steps.length; k++) steps[k]!(val, unk);
  }
  return false;
}

function behavior(program: Program, delay: number): Behavior<HdlState> {
  const { bitCount, readPins, readBits, flipFlops, flipFlopCones, flipFlopNames } = program;
  const { drivePins, driveKinds, driveBits, driveEnables, driveCones, latches } = program;
  const { dataCones, clockPins, internal, asyncFlops, asyncCones, roundLimit, pinNames } = program;
  const { clockReads, dataSeesClock } = program;
  // Scratch for one evaluation (nothing is kept between them): the planes as the evaluation
  // found them, the next states seen at another moment of a race, which pin flip-flops race.
  const before = internal.length > 0 ? newPlanes(bitCount) : undefined;
  const other = new Uint8Array(program.nextSize);
  const racing = new Uint8Array(flipFlops.length);
  /** Which flip-flops clocked by logic had an edge in this evaluation already. */
  const clocked = new Uint8Array(flipFlops.length);
  /** Per read pin, whether it changed in this delta (filled at the first edge). */
  const changed = new Uint8Array(readPins.length);

  /** Loads every flip-flop with an edge waiting, all at once. */
  const loadEdges = (state: HdlState) => {
    const { val, unk, next, edges } = state;
    for (let k = 0; k < flipFlops.length; k++) {
      if (!edges[k]) continue;
      load(flipFlops[k]!, val, unk, next);
      edges[k] = 0;
    }
  };
  const { steps } = program;
  const { loopNames, loopFailed } = program;
  const settle = (ctx: EvalContext<HdlState>) => {
    if (asyncFlops.length === 0) {
      const { val, unk } = ctx.state;
      for (let k = 0; k < steps.length; k++) steps[k]!(val, unk);
    } else if (settlePlanes(program, ctx.state.val, ctx.state.unk)) {
      ctx.report({
        kind: 'oscillation',
        message: 'asynchronous controls made by logic keep changing their flip-flops',
      });
    }
    for (let l = 0; l < loopFailed.length; l++) {
      if (!loopFailed[l]) continue;
      loopFailed[l] = 0;
      ctx.report({
        kind: 'oscillation',
        message: `the combinational loop through ${loopNames[l]} doesn't settle: X`,
      });
    }
  };
  /** A flip-flop loading an `X` that a floating pin's value led to reports that pin. */
  const reportLoad = (ctx: EvalContext<HdlState>, k: number) => {
    const cone = flipFlopCones[k]!;
    if (cone.length > 0 && loadsUnknown(flipFlops[k]!, ctx.state.next)) {
      reportCone(ctx, cone, ctx.state.floating, readPins);
    }
  };

  const pinClocked = clockPins.some((pin) => pin >= 0);

  /**
   * Pin clocks' edges, each next state from the planes before this delta (a shift chain shifts by
   * one). A flip-flop whose sampled data changed in this delta too races (`resolveRaces`).
   */
  const pinEdges = (ctx: EvalContext<HdlState>): PinEdges => {
    const { val, unk, next, edges } = ctx.state;
    let result: PinEdges = NO_EDGE;
    // Whether a pin other than a clock changed in this delta: most edges come alone.
    let dataChanged = false;
    for (let k = 0; k < flipFlops.length; k++) {
      const pin = clockPins[k]!;
      if (pin < 0) continue;
      const ff = flipFlops[k]!;
      const edge = clockEdge(ctx, pin, ff.rising ? 'rise' : 'fall');
      if (edge === ClockEdge.NONE) continue;
      if (result === NO_EDGE) {
        result = EDGED;
        for (let p = 0; p < readPins.length; p++) {
          const c = ctx.changed(readPins[p]!) ? 1 : 0;
          changed[p] = c;
          if (c && !clockReads[p]) dataChanged = true;
        }
      }
      nextState(ff, edge === ClockEdge.UNCERTAIN, val, unk, next);
      edges[k] = edge;
      reportLoad(ctx, k);
      if (!dataChanged && !dataSeesClock[k]) continue;
      const cone = dataCones[k]!;
      for (let i = 0; i < cone.length; i++) {
        if (changed[cone[i]!]) {
          racing[k] = 1;
          result = RACES;
          break;
        }
      }
    }
    return result;
  };

  /** Reads the pins into the planes without reporting a floating one; says how many float. */
  const readInputs = (ctx: EvalContext<HdlState>): number => {
    const { val, unk, floating } = ctx.state;
    let floats = 0;
    for (let i = 0; i < readPins.length; i++) {
      const level = ctx.level(readPins[i]!);
      const f = level === Level.Z ? 1 : 0;
      floating[i] = f;
      floats += f;
      const t = toInput(level);
      const b = readBits[i]!;
      unk[b] = t === Level.X ? 1 : 0;
      val[b] = t === Level.L1 ? 1 : 0;
    }
    return floats;
  };

  /** A race at the pins: each racing next state with the data after the change too, merged. */
  const resolveRaces = (ctx: EvalContext<HdlState>) => {
    const { val, unk, next, edges } = ctx.state;
    for (let k = 0; k < flipFlops.length; k++) {
      if (!racing[k]) continue;
      racing[k] = 0;
      const ff = flipFlops[k]!;
      nextState(ff, edges[k] === ClockEdge.UNCERTAIN, val, unk, other);
      if (!mergeRace(ff, next, other)) continue;
      const cone = dataCones[k]!;
      let pin = -1;
      for (let i = 0; i < cone.length && pin < 0; i++) {
        if (changed[cone[i]!]) pin = readPins[cone[i]!]!;
      }
      ctx.report({
        kind: 'setup-violation',
        message: `${pinNames[pin] ?? 'an input'} changed at the clock edge of ${flipFlopNames[k]}: it loads X where that matters`,
        ...(pin >= 0 ? { pin } : {}),
      });
    }
    loadEdges(ctx.state);
    settle(ctx);
  };

  /**
   * Rounds of edges of clocks made by logic: a divider's output clocks the next stage. Inside one
   * evaluation everything is one instant, so a flip-flop whose data changed in it (since the
   * evaluation began) races its clock.
   */
  const internalRounds = (ctx: EvalContext<HdlState>) => {
    const { val, unk, next, edges, seen } = ctx.state;
    for (let round = 0; ; round++) {
      let any = false;
      for (let j = 0; j < internal.length; j++) {
        const k = internal[j]!;
        const ff = flipFlops[k]!;
        const now = tri(val, unk, ff.clk);
        const edge = edgeOf(seen[k]!, now, ff.rising);
        seen[k] = now;
        if (edge === ClockEdge.NONE) continue;
        const uncertain = edge === ClockEdge.UNCERTAIN;
        if (round >= roundLimit) {
          // Still clocking after every stage could have: it oscillates inside the module.
          next.fill(TX, ff.offset, ff.offset + ff.q.length);
          ctx.report({
            kind: 'oscillation',
            message: `${flipFlopNames[k]} keeps clocking inside the module: X`,
          });
        } else {
          nextState(ff, uncertain, val, unk, next);
          // An uncertain edge already merged what it could load; a certain one is checked.
          if (!uncertain) nextState(ff, false, before!.val, before!.unk, other);
          if (!uncertain && mergeRace(ff, next, other)) {
            ctx.report({
              kind: 'race-violation',
              message: clocked[k]
                ? `${flipFlopNames[k]} is clocked again in the same instant (its clock glitches inside the module): it loads X where that matters`
                : `${flipFlopNames[k]} is clocked by logic, and its data changed at the same instant: it loads X where that matters — use a clock enable`,
            });
          }
        }
        edges[k] = edge;
        clocked[k] = 1;
        any = true;
        reportLoad(ctx, k);
      }
      if (!any) return;
      loadEdges(ctx.state);
      settle(ctx);
    }
  };

  /** An open latch holding `X`, or an asynchronous control at `X`, reports the pins behind it. */
  const reportFloating = (ctx: EvalContext<HdlState>) => {
    const { val, unk, floating } = ctx.state;
    for (let k = 0; k < latches.length; k++) {
      const latch = latches[k]!;
      if (active(tri(val, unk, latch.en), latch.enPolarity) === 0) continue;
      let unknown = false;
      for (let i = 0; i < latch.q.length && !unknown; i++) unknown = unk[latch.q[i]!] === 1;
      if (unknown) reportCone(ctx, latch.cone, floating, readPins);
    }
    for (let j = 0; j < asyncFlops.length; j++) {
      const k = asyncFlops[j]!;
      if (asyncUnknown(flipFlops[k]!, val, unk)) {
        reportCone(ctx, asyncCones[k]!, floating, readPins);
      }
    }
  };

  /** Drives every output with the delay; one driven `X` reports the floating pins behind it. */
  const driveOutputs = (ctx: EvalContext<HdlState>, floats: number) => {
    const { val, unk, floating } = ctx.state;
    for (let i = 0; i < drivePins.length; i++) {
      let drive: Drive;
      if (driveKinds[i] === STRONG) drive = DRIVES[tri(val, unk, driveBits[i]!)]!;
      else {
        const e = tri(val, unk, driveEnables[i]!);
        drive =
          e === 0 ? Drive.Z : e === 1 ? DRIVES[tri(val, unk, driveBits[i]!)]! : Drive.STRONG_X;
      }
      ctx.drive(drivePins[i]!, drive, delay);
      if (floats > 0 && drive === Drive.STRONG_X)
        reportCone(ctx, driveCones[i]!, floating, readPins);
    }
  };

  return {
    createState(): HdlState {
      const planes = newPlanes(bitCount);
      const { initBits, initValues } = program;
      for (let i = 0; i < initBits.length; i++) {
        planes.unk[initBits[i]!] = 0;
        planes.val[initBits[i]!] = initValues[i]!;
      }
      // The logic settles from the power-up values (the pins unknown), so a clock made from an
      // initialized register (`~div`) is known before anything happens.
      settlePlanes(program, planes.val, planes.unk);
      program.loopFailed.fill(0);
      return {
        ...planes,
        next: new Uint8Array(program.nextSize),
        edges: new Uint8Array(flipFlops.length),
        floating: new Uint8Array(readPins.length),
        // Clocks start where power-up left them: `reg div = 0` makes no edge.
        seen: Uint8Array.from(flipFlops, (ff) => tri(planes.val, planes.unk, ff.clk)),
      };
    },
    evaluate(ctx: EvalContext<HdlState>) {
      const state = ctx.state;
      if (before) {
        before.val.set(state.val);
        before.unk.set(state.unk);
        clocked.fill(0);
      }
      // Each phase is its own function, run only where the module needs it: an evaluation of a
      // decoder reads its pins, settles and drives, as in HDL-1.
      const edges = pinClocked ? pinEdges(ctx) : NO_EDGE;
      // Flip-flops load now — unless one races: then all wait, so it sees the others as before.
      if (edges === EDGED) loadEdges(state);
      const floats = readInputs(ctx);
      settle(ctx);
      if (edges === RACES) resolveRaces(ctx);
      if (internal.length > 0) internalRounds(ctx);
      if (floats > 0) reportFloating(ctx);
      driveOutputs(ctx, floats);
    },
  };
}

/**
 * Whether a flip-flop's asynchronous controls are unknown, or active with its state unknown: the
 * floating rule reports the pins behind them then.
 */
function asyncUnknown(ff: FlipFlop, val: Uint8Array, unk: Uint8Array): boolean {
  let activeControl = false;
  const control = (bit: number, polarity: number) => {
    const t = active(tri(val, unk, bit), polarity);
    if (t === 1) activeControl = true;
    return t === TX;
  };
  if (ff.arst >= 0 && control(ff.arst, ff.arstPolarity)) return true;
  if (ff.aload >= 0 && control(ff.aload, ff.aloadPolarity)) return true;
  for (let i = 0; i < ff.set.length; i++) {
    if (control(ff.set[i]!, ff.setPolarity) || control(ff.clr[i]!, ff.clrPolarity)) return true;
  }
  if (!activeControl) return false;
  for (let i = 0; i < ff.q.length; i++) if (unk[ff.q[i]!]) return true;
  return false;
}
