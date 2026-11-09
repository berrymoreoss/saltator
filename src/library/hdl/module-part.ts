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
  hdlDelayProp,
  hdlModuleProblems,
  hdlPinDirs,
  hdlPortName,
  hdlPortPins,
  Level,
  type PinDef,
  strong,
  toInput,
} from '../../core';
import { ClockEdge, clockEdge } from '../74xx/edge-triggered';
import { analyzeHdlModule, type HdlAnalysis, PIN } from './analyze';
import {
  active,
  asyncReset,
  type CellStep,
  compileFlipFlop,
  compileStep,
  type FlipFlop,
  load,
  newPlanes,
  nextState,
  planeIndex,
  TX,
  tri,
} from './cells';

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
  /** Per flip-flop, the read pins its next state can come from. */
  readonly flipFlopCones: readonly Int32Array[];
  /** Flip-flops with an asynchronous reset, and the read pin of each one's (−1 for a constant). */
  readonly resets: readonly FlipFlop[];
  readonly resetPins: Int32Array;
  readonly latches: readonly Latch[];
  /** The pin that reads each plane index (−1 for others), for clocks. */
  readonly pinOfBit: Int32Array;
  readonly nextSize: number;
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

  // Steps in order; a buffer writes only the bits it is the plane driver of (not an inout's).
  const steps: CellStep[] = [];
  const latches: Latch[] = [];
  for (const index of analysis.order) {
    const cell = cells[index]!;
    if (cell.type === '$tribuf') {
      const keep = cell.ports.Y!.flatMap((bit, i) => (driver[bit as number] === index ? [i] : []));
      if (keep.length === 0) continue;
      const ports = {
        A: keep.map((i) => cell.ports.A![i]!),
        EN: cell.ports.EN!,
        Y: keep.map((i) => cell.ports.Y![i]!),
      };
      steps.push(compileStep({ ...cell, ports }, bitCount));
      continue;
    }
    steps.push(compileStep(cell, bitCount));
    if (HDL_CELLS[cell.type].kind === 'latch') {
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
  const resets = flipFlops.filter((ff) => ff.arst >= 0);
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
    flipFlopCones: analysis.flipFlops.map((index) => toReadPins(cones[index]!)),
    resets,
    resetPins: Int32Array.from(resets, (ff) => (ff.arst < bitCount ? readPos[ff.arst]! : -1)),
    latches,
    pinOfBit,
    nextSize: offset,
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
    create: (props) => behavior(program, props.delay),
  });
  return { definition, messages: analysis.messages };
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

function behavior(program: Program, delay: number): Behavior<HdlState> {
  const { bitCount, readPins, readBits, steps, flipFlops, flipFlopCones, resets, resetPins } =
    program;
  const { drivePins, driveKinds, driveBits, driveEnables, driveCones, latches, pinOfBit } = program;
  return {
    createState(): HdlState {
      return {
        ...newPlanes(bitCount),
        next: new Uint8Array(program.nextSize),
        edges: new Uint8Array(flipFlops.length),
        floating: new Uint8Array(readPins.length),
      };
    },
    evaluate(ctx: EvalContext<HdlState>) {
      const { val, unk, next, edges, floating } = ctx.state;
      // Clock edges: every next state from the values before the edge, then all loaded at once.
      // A flip-flop loading an X from a pin that was floating then uses that floating value.
      let edged = false;
      for (let k = 0; k < flipFlops.length; k++) {
        const ff = flipFlops[k]!;
        const pin = pinOfBit[ff.clk]!;
        if (pin < 0) continue; // a clock tied to a constant never ticks
        const edge = clockEdge(ctx, pin, ff.rising ? 'rise' : 'fall');
        if (edge === ClockEdge.NONE) continue;
        nextState(ff, edge === ClockEdge.UNCERTAIN, val, unk, next);
        edges[k] = 1;
        edged = true;
        const cone = flipFlopCones[k]!;
        if (cone.length > 0 && loadsUnknown(ff, next)) reportCone(ctx, cone, floating, readPins);
      }
      if (edged) {
        for (let k = 0; k < flipFlops.length; k++) {
          if (!edges[k]) continue;
          load(flipFlops[k]!, val, unk, next);
          edges[k] = 0;
        }
      }
      // Pins are read without reporting a floating one: only its use below is reported.
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
      for (let k = 0; k < resets.length; k++) {
        asyncReset(resets[k]!, val, unk);
        const p = resetPins[k]!;
        if (floats > 0 && p >= 0 && floating[p]) ctx.reportFloating(readPins[p]!);
      }
      for (let k = 0; k < steps.length; k++) steps[k]!(val, unk);
      if (floats > 0) {
        for (let k = 0; k < latches.length; k++) {
          const latch = latches[k]!;
          if (active(tri(val, unk, latch.en), latch.enPolarity) === 0) continue;
          let unknown = false;
          for (let i = 0; i < latch.q.length && !unknown; i++) unknown = unk[latch.q[i]!] === 1;
          if (unknown) reportCone(ctx, latch.cone, floating, readPins);
        }
      }
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
    },
  };
}
