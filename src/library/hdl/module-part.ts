/**
 * A Verilog module as a part (HDL-1, ADR-0030; tri-states HDL-8; on words, HDL-10): the
 * definition made from a module's IR — a pin per port bit, one delay (`delay`) for every output —
 * and its behavior. The IR is compiled once per module into code over 32-bit words (`layout.ts`,
 * `codegen.ts`, `settle.ts`, `flip-flops.ts`) shared by its instances. Each `evaluate`: the
 * flip-flops whose clock had an edge load from the words before it, the input and inout pins are
 * read, the combinational cells downstream of what changed run once each in topological order (no
 * events inside a module), asynchronous controls apply, and every output is driven with the delay
 * — released (`Z`) where its tri-state buffer is off (inertial, so an unchanged output costs
 * nothing). A floating pin reads `X`, and is reported only where that `X` reaches something the
 * module drives or stores. Memories (HDL-6) are read by steps in that order and written on clock
 * edges with the flip-flops' loads (`memory-cells.ts`). State is the words, the memories' words
 * and a few bytes in typed arrays — plain data, so snapshots, rewind and replicas work as for any
 * part. Spec: docs/components.md#verilog-modules-hdl.
 */
import {
  type AnyComponentDefinition,
  type Behavior,
  type ComponentDefinition,
  Drive,
  defineComponent,
  type EvalContext,
  HDL_CELLS,
  type HdlBit,
  type HdlModule,
  type HdlPartResult,
  type HdlPortBit,
  hdlCellOutput,
  hdlDelayProp,
  hdlModuleProblems,
  hdlPinDirs,
  hdlPortName,
  hdlPortPins,
  isPokeAction,
  Level,
  type MemoryDef,
  type PinDef,
  type PokeAction,
  type SignalsDef,
  strong,
  toInput,
} from '../../core';
import { ClockEdge, clockEdge } from '../74xx/edge-triggered';
import { analyzeHdlModule, type HdlAnalysis, outputName, PIN } from './analyze';
import {
  type AsyncControls,
  compileAsyncControls,
  compileLoads,
  compileNextStates,
  isAsync,
  type Loads,
  type NextStates,
} from './flip-flops';
import { type Layout, layoutModule, setBit, usedBits } from './layout';
import {
  type CompiledMemory,
  compileMemory,
  compileWordWritePorts,
  type MemoryState,
  mergeWrite,
  newMemoryState,
  newWriteSamples,
  readClosure,
  sampleWriteWords,
  spoilWrite,
  stampReads,
  storeWrite,
  type WordWritePort,
  writesUnknown,
} from './memory-cells';
import { type CompiledCheck, compileChecks, type ModuleChecks } from './module-checks';
import { compilePathDelays, DRIVE_Z, type ModulePathDelays } from './path-delays';
import { TX } from './planes';
import { compileSettle, markAll, markWord, type Settle } from './settle';
import { int } from './source';
import { hdlTiming } from './timing';

type HdlProps = { delay: number };

interface HdlState extends MemoryState {
  /**
   * The module's bits in 32-bit words (`layout.ts`): values (0 where unknown) and unknowns; the
   * constants' word last.
   */
  readonly v: Int32Array;
  readonly u: Int32Array;
  /** A byte per read pin: 1 where it was floating when last read; how many did. */
  readonly floating: Uint8Array;
  readonly floats: Int32Array;
  /** Per flip-flop, the value (0, 1, 2 = X) its clock had when it last looked (HDL-9). */
  readonly seen: Uint8Array;
  /** The same per memory write port (HDL-6). */
  readonly wseen: Uint8Array;
  /** The timing checks' pin times (HDL-2; `TimingChecks`), empty without checks. */
  readonly times: Float64Array;
  /** The checks' snapshots of `Q` words (`ModuleChecks` slots): values and unknowns. */
  readonly snapV: Int32Array;
  readonly snapU: Int32Array;
}

/** A driving pin's value: a bit's (or a constant's), push-pull. */
const STRONG = 0;
/** A driving pin's value: a `$tribuf`'s — its `A` bit while `EN`, released while not, `X` while unknown. */
const BUFFER = 1;

/** The drive of each value a bit can have (0, 1, `X`). */
const DRIVES = [strong(Level.L0), strong(Level.L1), strong(Level.X)] as const;

/**
 * A bit's place for a quick read: its word and its position. The constants have a word of their
 * own after the layout's (0 at bit 0, 1 at bit 1, `X` at bit 2), so a read never asks which.
 */
interface Places {
  readonly word: Int32Array;
  readonly pos: Int32Array;
}

/** The constants' word's values and unknowns. */
const CONSTANT_V = 0b010;
const CONSTANT_U = 0b100;

function places(layout: Layout, bits: readonly HdlBit[]): Places {
  return {
    word: Int32Array.from(bits, (bit) =>
      typeof bit === 'number' ? layout.word[bit]! : layout.words,
    ),
    pos: Int32Array.from(bits, (bit) =>
      typeof bit === 'number' ? layout.pos[bit]! : bit === '0' ? 0 : bit === '1' ? 1 : 2,
    ),
  };
}

/** A bit of the words: 0, 1, or 2 (`X`). */
function levelAt(v: Int32Array, u: Int32Array, w: number, p: number): number {
  return (u[w]! >>> p) & 1 ? TX : (v[w]! >>> p) & 1;
}

/** Whether a control at level `t` is active for `polarity` (1: HIGH): 1, 0, or `X`. */
const active = (t: number, polarity: number) => (t === TX ? TX : t === polarity ? 1 : 0);

/** A latch, for the floating rule: open (or maybe open) and holding `X` from a floating pin. */
interface Latch {
  readonly en: Places;
  readonly enPolarity: number;
  readonly q: Places;
  readonly cone: Int32Array;
}

/** A flip-flop with asynchronous controls, for the floating rule. */
interface AsyncFlop {
  readonly arst: Places;
  readonly arstPolarity: number;
  readonly aload: Places;
  readonly aloadPolarity: number;
  readonly set: Places;
  readonly setPolarity: number;
  readonly clr: Places;
  readonly clrPolarity: number;
  readonly q: Places;
}

/** Flip-flops sharing their functions: those of one pin and edge, or one clocked by logic. */
interface Group {
  readonly members: Int32Array;
  readonly next: NextStates;
  readonly load: Loads;
  /** Its clock's pin; −1 for a clock made by logic or a constant. */
  readonly pin: number;
  readonly rising: boolean;
  /** Whether a member's data cone holds a clock pin (`q <= clk`): it races any edge. */
  readonly seesClock: boolean;
}

/** Everything an instance runs, made once per module. */
interface Program {
  readonly layout: Layout;
  readonly settle: Settle;
  /** The pins read into the words — inputs, inouts no logic drives — and their bits' places. */
  readonly readPins: Int32Array;
  readonly readWord: Int32Array;
  readonly readPos: Int32Array;
  /** The pins that drive (outputs, inouts), how (`STRONG`, `BUFFER`), from which bit. */
  readonly drivePins: Int32Array;
  readonly driveKinds: Uint8Array;
  readonly driveBits: Places;
  /** A buffer's enable. */
  readonly driveEnables: Places;
  /** Per driving pin, the read pins (positions in `readPins`) its value can come from. */
  readonly driveCones: readonly Int32Array[];
  /** The flip-flops in analysis order: their groups, `Q` words, clocks, names, cones. */
  readonly groups: readonly Group[];
  readonly groupOf: Int32Array;
  readonly qFirst: Int32Array;
  readonly qCount: Int32Array;
  readonly clocks: Places;
  readonly rising: Uint8Array;
  readonly flipFlopNames: readonly string[];
  /** Per flip-flop, the read pins its next state can come from. */
  readonly flipFlopCones: readonly Int32Array[];
  /** Per flip-flop, the read pins what its edge samples (D, EN, SRST) comes from: races. */
  readonly dataCones: readonly Int32Array[];
  /** Per read pin, whether it clocks a flip-flop or a write port. */
  readonly clockReads: Uint8Array;
  /** The flip-flops clocked by logic inside the module (HDL-9). */
  readonly internal: Int32Array;
  /** The flip-flops with asynchronous controls, their controls in one function, their cones. */
  readonly asyncFlops: Int32Array;
  readonly asyncFlopInfo: readonly AsyncFlop[];
  readonly applyAsync: AsyncControls | undefined;
  readonly asyncCones: readonly Int32Array[];
  /** The most rounds of clock edges one evaluation runs (a ripple chain of n takes n). */
  readonly roundLimit: number;
  /** The names of the part's pins, for messages. */
  readonly pinNames: readonly string[];
  /** Per combinational loop, a signal on it. */
  readonly loopNames: readonly string[];
  readonly latches: readonly Latch[];
  /** Bits with a power-up value (`init`, HDL-9) and their values, 0 or 1. */
  readonly initBits: Int32Array;
  readonly initValues: Uint8Array;
  /** The memories (HDL-6), and per read port (in step order) the memory it reads. */
  readonly memories: readonly CompiledMemory[];
  readonly readMemory: Int32Array;
  /** Per memory, the (group, mask) marks of the steps reading it. */
  readonly memoryReaders: readonly Int32Array[];
  /** The memories' write ports, edge-triggered like flip-flops, and their clocks' pins (−1: logic). */
  readonly writes: readonly WordWritePort[];
  readonly writeClocks: Places;
  readonly writeClockPins: Int32Array;
  /** The write ports clocked by logic inside the module. */
  readonly writeInternal: Int32Array;
  /** Per write port, the read pins what it stores can come from, and what its edges sample. */
  readonly writeCones: readonly Int32Array[];
  readonly writeDataCones: readonly Int32Array[];
  /** Per write port, whether what it samples comes from a clock pin: it races any edge. */
  readonly writeDataSeesClock: Uint8Array;
  /** Per write port, what it writes, for messages: `memory buffer`. */
  readonly writeNames: readonly string[];
  /** The driving pins' delays by the module's `specify` paths (HDL-2); none without paths. */
  readonly pathDelays: ModulePathDelays | undefined;
  /** Its `specify` timing checks (HDL-2); none without checks. */
  readonly checks: ModuleChecks | undefined;
}

/**
 * Where a library part puts a module's pins (HDL-2): its own pin list (a data sheet's, with
 * numbers, descriptions and power pins) and, per module pin (`hdlPins` order), its index there.
 */
export interface HdlPinMap {
  readonly pins: readonly PinDef[];
  readonly at: readonly number[];
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

function compile(module: HdlModule, analysis: HdlAnalysis, map?: HdlPinMap): Program {
  const { bitCount, cells } = module;
  const { driver, cones } = analysis;
  const layout = layoutModule(module, analysis);
  /** A module pin's index among the part's pins. */
  const partPin = (pin: number) => (map ? map.at[pin]! : pin);

  // The pins read into the words: the inputs, then the inouts' bits no logic drives (an inout
  // sharing an input's bit drives it instead).
  const readPins: number[] = [];
  const readBits: number[] = [];
  const readPos = new Int32Array(bitCount).fill(-1);
  const pinOfBit = new Int32Array(bitCount).fill(-1);
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
    for (const [i, bit] of port.bits.entries()) read(partPin(firstPin[p]! + i), bit as number);
  }
  for (const [p, port] of module.ports.entries()) {
    if (port.dir !== 'inout') continue;
    for (const [i, bit] of port.bits.entries()) {
      if (typeof bit === 'number' && driver[bit] === PIN && readPos[bit]! < 0) {
        read(partPin(firstPin[p]! + i), bit);
      }
    }
  }
  /** The pin a clock bit is read from; −1 for a bit made by logic or a constant. */
  const pinOf = (bit: HdlBit) => (typeof bit === 'number' ? pinOfBit[bit]! : -1);

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

  // The buffer driving each inout's bit through its pin (its word's driver is the pin).
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
  const driveBits: HdlBit[] = [];
  const driveEnables: HdlBit[] = [];
  const driveCones: Int32Array[] = [];
  /** Per driving pin, its port's bit there: what `specify` paths name (HDL-2). */
  const drivePortBits: HdlPortBit[] = [];
  let portBit: HdlPortBit = 'z';
  const drives = (pin: number, kind: number, bit: HdlBit, enable: HdlBit, cone: Int32Array) => {
    drivePins.push(pin);
    drivePortBits.push(portBit);
    driveKinds.push(kind);
    driveBits.push(bit);
    driveEnables.push(enable);
    driveCones.push(cone);
  };
  const buffer = (pin: number, cell: number, i: number) => {
    const ports = cells[cell]!.ports;
    drives(pin, BUFFER, ports.A![i]!, ports.EN![0]!, toReadPins(cones[cell]!));
  };
  for (const [p, port] of module.ports.entries()) {
    if (port.dir === 'in') continue;
    for (const [i, bit] of port.bits.entries()) {
      const pin = partPin(firstPin[p]! + i);
      portBit = bit;
      if (bit === 'z') continue; // never driven: tristate and bidir pins start released
      if (typeof bit !== 'number') {
        drives(pin, STRONG, bit, '0', new Int32Array(0));
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
        drives(pin, STRONG, bit, '0', coneOfBit(bit));
      }
    }
  }

  // Pin-to-pin delays (HDL-2): a path starts where its bit enters by an input's or inout's pin.
  const entering = new Map<number, number[]>();
  for (const [p, port] of module.ports.entries()) {
    if (port.dir === 'out') continue;
    for (const [i, bit] of port.bits.entries()) {
      if (typeof bit !== 'number') continue;
      const list = entering.get(bit) ?? [];
      list.push(partPin(firstPin[p]! + i));
      entering.set(bit, list);
    }
  }
  const pathDelays = compilePathDelays(
    module.specify?.paths ?? [],
    layout,
    drivePortBits,
    (bit) => entering.get(bit) ?? [],
  );

  // The memories (HDL-6): read ports as steps of the settle, write ports on edges.
  const memories = module.memories.map(compileMemory);
  const readMemory: number[] = [];
  const settle = compileSettle(module, analysis, layout, (index) => {
    const cell = cells[index]!;
    const m = cell.params.MEMORY as number;
    const port = readMemory.length;
    readMemory.push(m);
    return readClosure(cell, m, memories[m]!, port, layout, layout.cellWord[index]!);
  });
  const memoryReaders = memories.map((_, m) => {
    const marks: number[] = [];
    for (const [index, cell] of cells.entries()) {
      if (cell.type !== '$memrd' || cell.params.MEMORY !== m) continue;
      const s = settle.stepOf[index]!;
      marks.push(s >>> 5, (1 << (s & 31)) | 0);
    }
    return Int32Array.from(marks);
  });

  /** The source marking the readers of a flip-flop's words. */
  const marksOf = (index: number): string => {
    const first = layout.cellWord[index]!;
    const out: string[] = [];
    for (let w = first; w < first + layout.cellWords[index]!; w++) {
      for (let i = settle.readerStart[w]!; i < settle.readerStart[w + 1]!; i++) {
        out.push(`D[${int(settle.readerGroup[i]!)}] |= ${int(settle.readerMask[i]!)};`);
      }
    }
    return out.join(' ');
  };

  // Flip-flops: grouped by pin and edge; one clocked by logic or a constant is a group of its own.
  const flipFlops = analysis.flipFlops;
  const clockBits = flipFlops.map((index) => cells[index]!.ports.CLK![0]!);
  const rising = Uint8Array.from(flipFlops, (index) =>
    cells[index]!.params.CLK_POLARITY === 1 ? 1 : 0,
  );
  const clockReads = new Uint8Array(readPins.length);
  for (const bit of clockBits)
    if (typeof bit === 'number' && readPos[bit]! >= 0) clockReads[readPos[bit]!] = 1;
  const writeCells = analysis.writePorts.map((index) => cells[index]!);
  for (const cell of writeCells) {
    const bit = cell.ports.CLK![0]!;
    if (typeof bit === 'number' && readPos[bit]! >= 0) clockReads[readPos[bit]!] = 1;
  }
  const dataCones = analysis.dataCones.map(toReadPins);
  const dataSeesClock = dataCones.map((cone) => cone.some((p) => clockReads[p]));
  const byPin = new Map<string, number[]>();
  const groupsOfMembers: number[][] = [];
  const groupPins: number[] = [];
  const groupRising: boolean[] = [];
  for (const [k, bit] of clockBits.entries()) {
    const pin = pinOf(bit);
    if (pin < 0) {
      groupsOfMembers.push([k]);
      groupPins.push(-1);
      groupRising.push(rising[k] === 1);
      continue;
    }
    const key = `${pin}:${rising[k]}`;
    let members = byPin.get(key);
    if (!members) {
      members = [];
      byPin.set(key, members);
      groupsOfMembers.push(members);
      groupPins.push(pin);
      groupRising.push(rising[k] === 1);
    }
    members.push(k);
  }
  const groupOf = new Int32Array(flipFlops.length);
  const groups: Group[] = groupsOfMembers.map((members, g) => {
    for (const k of members) groupOf[k] = g;
    const indices = members.map((k) => flipFlops[k]!);
    return {
      members: Int32Array.from(members),
      next: compileNextStates(cells, layout, indices),
      load: compileLoads(layout, indices, marksOf),
      pin: groupPins[g]!,
      rising: groupRising[g]!,
      seesClock: members.some((k) => dataSeesClock[k]),
    };
  });
  const internal = Int32Array.from(
    clockBits.flatMap((bit, k) => (typeof bit === 'number' && pinOf(bit) < 0 ? [k] : [])),
  );
  const asyncList = flipFlops.flatMap((index, k) => (isAsync(cells[index]!) ? [k] : []));
  const asyncFlopInfo = asyncList.map((k): AsyncFlop => {
    const cell = cells[flipFlops[k]!]!;
    const polarity = (name: string) => (cell.params[name] as number | undefined) ?? 1;
    return {
      arst: places(layout, cell.ports.ARST ?? []),
      arstPolarity: polarity('ARST_POLARITY'),
      aload: places(layout, cell.ports.ALOAD ?? []),
      aloadPolarity: polarity('ALOAD_POLARITY'),
      set: places(layout, cell.ports.SET ?? []),
      setPolarity: polarity('SET_POLARITY'),
      clr: places(layout, cell.ports.CLR ?? []),
      clrPolarity: polarity('CLR_POLARITY'),
      q: places(layout, cell.ports.Q!),
    };
  });

  // Timing checks (HDL-2) on the part's pins, with the groups and cones they act on.
  const partPins = map ? map.pins : hdlPins(module);
  const readOf = new Int32Array(partPins.length).fill(-1);
  readPins.forEach((pin, r) => {
    readOf[pin] = r;
  });
  const qFirst = Int32Array.from(flipFlops, (index) => layout.cellWord[index]!);
  const qCount = Int32Array.from(flipFlops, (index) => layout.cellWords[index]!);
  const checks = compileChecks(module.specify?.checks ?? [], {
    pins: partPins,
    layout,
    entering: (bit) => entering.get(bit) ?? [],
    readOf,
    groups,
    qFirst,
    qCount,
    asyncCones: analysis.asyncCones.map(toReadPins),
  });

  // The memories' write ports (HDL-6): edges as the flip-flops', clocks from pins or from logic.
  const writes = compileWordWritePorts(writeCells, layout);
  const writeClockBits = writeCells.map((cell) => cell.ports.CLK![0]!);
  const writeClockPins = Int32Array.from(writeClockBits, pinOf);
  const writeInternal = Int32Array.from(
    writeClockBits.flatMap((bit, p) => (typeof bit === 'number' && pinOf(bit) < 0 ? [p] : [])),
  );
  const writeDataCones = analysis.writeDataCones.map(toReadPins);

  // Steps' and loops' bookkeeping: latches for the floating rule, a name per loop.
  const latches: Latch[] = [];
  for (const index of analysis.order) {
    const cell = cells[index]!;
    if (HDL_CELLS[cell.type].kind === 'latch' && cell.ports.EN) {
      latches.push({
        en: places(layout, cell.ports.EN),
        enPolarity: cell.params.EN_POLARITY as number,
        q: places(layout, cell.ports.Q!),
        cone: toReadPins(cones[index]!),
      });
    }
  }
  const loopNames = analysis.loops.map((members) =>
    outputName(module, hdlCellOutput(cells[members[0]!]!)),
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
    layout,
    settle,
    readPins: Int32Array.from(readPins),
    readWord: Int32Array.from(readBits, (b) => layout.word[b]!),
    readPos: Int32Array.from(readBits, (b) => layout.pos[b]!),
    drivePins: Int32Array.from(drivePins),
    driveKinds: Uint8Array.from(driveKinds),
    driveBits: places(layout, driveBits),
    driveEnables: places(layout, driveEnables),
    driveCones,
    groups,
    groupOf,
    qFirst,
    qCount,
    clocks: places(layout, clockBits),
    rising,
    flipFlopNames: flipFlops.map((index) => outputName(module, cells[index]!.ports.Q!)),
    flipFlopCones: flipFlops.map((index) => toReadPins(cones[index]!)),
    dataCones,
    clockReads,
    internal,
    asyncFlops: Int32Array.from(asyncList),
    asyncFlopInfo,
    applyAsync:
      asyncList.length > 0
        ? compileAsyncControls(
            cells,
            layout,
            asyncList.map((k) => flipFlops[k]!),
            marksOf,
          )
        : undefined,
    asyncCones: analysis.asyncCones.map(toReadPins),
    roundLimit: 2 * (internal.length + writeInternal.length) + 4,
    pinNames: partPins.map((pin) => pin.name),
    loopNames,
    latches,
    initBits: Int32Array.from(initBits),
    initValues: Uint8Array.from(initValues),
    memories,
    readMemory: Int32Array.from(readMemory),
    memoryReaders,
    writes,
    writeClocks: places(layout, writeClockBits),
    writeClockPins,
    pathDelays,
    checks,
    writeInternal,
    writeCones: analysis.writePorts.map((index) => toReadPins(cones[index]!)),
    writeDataCones,
    writeDataSeesClock: Uint8Array.from(writeDataCones, (cone) =>
      cone.some((p) => clockReads[p]) ? 1 : 0,
    ),
    writeNames: writes.map((wp) => `memory ${module.memories[wp.memory]!.name}`),
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
  // HDL-2: a module's specify block times its outputs and shows in the Part tab; the one delay
  // times the outputs no path reaches (all of them without a specify block).
  const timing = hdlTiming(module, {
    conditions: "as the module's specify block gives them, in ns: typical delays simulated",
    source: `the specify block of module ${module.top}`,
  });
  const definition = defineComponent<HdlProps, HdlState>({
    type,
    name,
    title: `Verilog module ${module.top}`,
    keywords: ['verilog', 'module', module.top],
    pins: hdlPins(module),
    props: [hdlDelayProp],
    ...(timing && { timing }),
    signals: innerSignals(module, program.layout),
    ...(program.memories.some((m) => m.width <= 32) && { memories: memoryViews(program) }),
    create: (props) => behavior(program, props.delay),
  });
  return { definition, messages: analysis.messages };
}

/** What a library part made from a module takes from its data sheet (HDL-2). */
export type HdlLibraryInfo = Pick<
  ComponentDefinition<Record<string, never>, HdlState>,
  | 'type'
  | 'name'
  | 'title'
  | 'keywords'
  | 'datasheet'
  | 'package'
  | 'units'
  | 'timing'
  | 'functionTable'
>;

/**
 * A library part made from a module (HDL-2): the module run on the data sheet's pins (`map`),
 * every output timed by its `specify` paths — no delay property. Throws where the module can't be
 * one: errors, a pin whose direction differs from the module's, an output no path reaches.
 */
export function hdlLibraryPart(
  module: HdlModule,
  map: HdlPinMap,
  info: HdlLibraryInfo,
): AnyComponentDefinition {
  const fail = (why: string): never => {
    throw new Error(`${info.name} (Verilog ${module.top}): ${why}`);
  };
  const shape = hdlModuleProblems(module);
  if (shape.length > 0) fail(shape.join('; '));
  const analysis = analyzeHdlModule(module);
  const errors = analysis.messages.filter((m) => m.severity === 'error');
  if (errors.length > 0) fail(errors.map((m) => m.message).join('; '));
  const modulePins = hdlPins(module);
  if (map.at.length !== modulePins.length) fail('the pin map does not cover every module pin');
  for (const [i, pin] of modulePins.entries()) {
    const placed = map.pins[map.at[i]!];
    if (placed?.dir !== pin.dir) {
      fail(`${pin.name} is ${pin.dir}, the data sheet's pin ${placed?.name} ${placed?.dir}`);
    }
  }
  const program = compile(module, analysis, map);
  const unreached = [...program.drivePins].filter((_, i) => !program.pathDelays?.reached[i]);
  if (unreached.length > 0) {
    fail(`no specify path reaches ${unreached.map((p) => map.pins[p]!.name).join(', ')}`);
  }
  return defineComponent<Record<string, never>, HdlState>({
    ...info,
    pins: [...map.pins],
    signals: innerSignals(module, program.layout),
    create: () => behavior(program, 0),
  });
}

/**
 * The module's named signals as the part shows them (HDL-4): each bit read from the words, where
 * a register's or latch's state is its `Q` bits — 0, 1 and `X` are `Level`'s numbers.
 */
function innerSignals(module: HdlModule, layout: Layout): SignalsDef<HdlState> {
  const named = module.signals.filter((s) => s.bits.length > 0);
  const list = named.map((s) => ({
    name: s.name,
    lsb: s.lsb,
    width: s.bits.length,
    ...(s.src !== undefined && { src: s.src }),
  }));
  const at = named.map((s) => places(layout, s.bits));
  return {
    list,
    level: (state, signal, bit) => {
      const p = at[signal]!;
      return levelAt(state.v, state.u, p.word[bit]!, p.pos[bit]!) as Level;
    },
  };
}

/**
 * The module's memories as the part shows them (HDL-6): each one's words read in place from the
 * instance's state, the power-up contents from the IR; memories wider than 32 bits run but aren't
 * shown.
 */
function memoryViews(program: Program): MemoryDef<HdlState>[] {
  return program.memories.flatMap((m, i): MemoryDef<HdlState>[] =>
    m.width > 32
      ? []
      : [
          {
            name: m.name,
            words: m.size,
            width: m.width,
            offset: m.base,
            volatile: true,
            powerUp: () => ({ data: m.init.val, unknown: m.init.unk }),
            view: (state) => ({
              data: state.mval[i]!,
              unknown: state.munk[i]!,
              readAt: state.readAt[i]!,
              writtenAt: state.writtenAt[i]!,
            }),
          },
        ],
  );
}

/**
 * A debug write into a memory (`PokeAction`): known words from `address` on, written now — or
 * an error for a memory, address or word the module doesn't have. Says which memory.
 */
function pokeMemory(program: Program, ctx: EvalContext<HdlState>, poke: PokeAction): number {
  const m = program.memories.findIndex((memory) => memory.name === poke.memory);
  const memory = program.memories[m];
  if (!memory || memory.width > 32) {
    throw new Error(`${ctx.id}: no memory ${JSON.stringify(poke.memory)} to poke`);
  }
  const { size, width } = memory;
  if (
    !Number.isInteger(poke.address) ||
    poke.address < 0 ||
    poke.address + poke.data.length > size
  ) {
    throw new Error(
      `${ctx.id}: poke of ${poke.data.length} words at ${poke.address} outside ${memory.name} (${size} words)`,
    );
  }
  const max = 2 ** width - 1;
  const words = ctx.state.mval[m]!;
  const unknown = ctx.state.munk[m]!;
  const written = ctx.state.writtenAt[m]!;
  for (const [k, value] of poke.data.entries()) {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new Error(`${ctx.id}: ${memory.name} holds words of ${width} bits, not ${value}`);
    }
    words[poke.address + k] = value;
    unknown[poke.address + k] = 0;
    written[poke.address + k] = ctx.now;
  }
  return m;
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

function behavior(program: Program, delay: number): Behavior<HdlState> {
  const { layout, settle, readPins, readWord, readPos, groups, groupOf } = program;
  const { qFirst, qCount, clocks, rising, flipFlopNames, flipFlopCones, dataCones } = program;
  const { drivePins, driveKinds, driveBits, driveEnables, driveCones, latches } = program;
  const { internal, asyncFlops, asyncFlopInfo, applyAsync, asyncCones } = program;
  const { roundLimit, pinNames, clockReads, loopNames } = program;
  const { memories, readMemory, memoryReaders, writes, writeClocks, writeClockPins } = program;
  const { writeInternal, writeCones, writeDataCones, writeDataSeesClock, writeNames } = program;
  const words = layout.words;
  // Scratch for one evaluation (nothing is kept between them): the marks of the steps to run,
  // the next states between an edge's phases and those seen at another moment of a race, the
  // words as the evaluation found them (for clocks made by logic), which groups had an edge.
  const marks = new Int32Array(settle.groups);
  const NV = new Int32Array(words);
  const NU = new Int32Array(words);
  const OV = new Int32Array(words);
  const OU = new Int32Array(words);
  const hasInternal = internal.length > 0 || writeInternal.length > 0;
  const BV = hasInternal ? new Int32Array(words + 1) : NV;
  const BU = hasInternal ? new Int32Array(words + 1) : NU;
  const groupEdge = new Uint8Array(groups.length);
  const racing = new Uint8Array(qFirst.length);
  /** Which flip-flops clocked by logic had an edge in this evaluation already. */
  const clocked = new Uint8Array(qFirst.length);
  /** Per read pin, whether it changed in this delta (filled at the first edge). */
  const changed = new Uint8Array(readPins.length);
  // The same for the memories' write ports (HDL-6): what their edges write between the phases,
  // which wait to store (`pending`), race, were clocked by logic.
  const samples = newWriteSamples(writes);
  const otherSamples = newWriteSamples(writes);
  const pending = new Uint8Array(writes.length);
  const writeRacing = new Uint8Array(writes.length);
  const writeClocked = new Uint8Array(writes.length);
  const { loopFailed } = settle;

  /** Marks the steps reading memory `m` (a write or a poke changed it). */
  const markMemory = (m: number) => {
    const list = memoryReaders[m]!;
    for (let i = 0; i < list.length; i += 2) {
      marks[list[i]!] = marks[list[i]!]! | list[i + 1]!;
    }
  };

  /** Whether flip-flop `k`'s next state has an unknown bit. */
  const loadsUnknown = (k: number) => {
    for (let w = qFirst[k]!; w < qFirst[k]! + qCount[k]!; w++) if (NU[w] !== 0) return true;
    return false;
  };

  /**
   * Merges the next state flip-flop `k` computed (in `NV`/`NU`) with the one in `OV`/`OU` (the
   * same edge seen at another moment of a race): the bits that differ become `X`. Says whether one
   * did.
   */
  const mergeRace = (k: number) => {
    let differ = false;
    for (let w = qFirst[k]!; w < qFirst[k]! + qCount[k]!; w++) {
      const diff = (NV[w]! ^ OV[w]!) | (NU[w]! ^ OU[w]!);
      if (diff === 0) continue;
      NU[w] = NU[w]! | diff;
      NV[w] = NV[w]! & ~diff;
      differ = true;
    }
    return differ;
  };

  /** Flip-flop `k`'s next state all `X`: every bit of its `Q` unknown, nothing else. */
  const used = usedBits(layout);
  const allUnknown = (k: number) => {
    for (let w = qFirst[k]!; w < qFirst[k]! + qCount[k]!; w++) {
      NU[w] = used[w]!;
      NV[w] = 0;
    }
  };

  // Timing checks (HDL-2): what each found in this evaluation (a mask of late or early data pins,
  // or 1), and a copy of the words for "what if a pin were X".
  const { checks } = program;
  const checkList = checks ? checks.list : [];
  const flagged = new Int32Array(checkList.length);
  const SV = checks ? new Int32Array(words + 1) : NV;
  const SU = checks ? new Int32Array(words + 1) : NU;
  const scratchReads = new Int32Array(readMemory.length);

  /** Whether a check's condition (0: the clock's, 1: the data's) may hold in `v`, `u`. */
  const armedBy = (v: Int32Array, u: Int32Array, c: CompiledCheck, side: number) => {
    const w = c.whenWord[side]!;
    return w < 0 || (((u[w]! | v[w]!) >>> c.whenPos[side]!) & 1) === 1;
  };

  /**
   * Group `g`'s next states, into `OV`/`OU`, from the words with the read pins `reads[n]` for the
   * bits `n` of `mask` unknown: a copy of the words, settled (combinational steps only, its own
   * memory read stamps) — nothing of the instance changes.
   */
  const nextWithUnknown = (state: HdlState, g: number, reads: Int32Array, mask: number) => {
    SV.set(state.v);
    SU.set(state.u);
    for (let n = 0; n < reads.length; n++) {
      const r = reads[n]!;
      if (((mask >>> n) & 1) === 0 || r < 0) continue;
      const w = readWord[r]!;
      const m = 1 << readPos[r]!;
      SU[w] = SU[w]! | m;
      SV[w] = SV[w]! & ~m;
      markWord(settle, marks, w);
    }
    settle.run(SV, SU, marks, { mval: state.mval, munk: state.munk, readWord: scratchReads });
    loopFailed.fill(0);
    groups[g]!.next(SV, SU, OV, OU, 0);
  };

  /** Whether flip-flop `k` samples one of the read pins `reads[n]` for the bits `n` of `mask`. */
  const sampledBy = (k: number, reads: Int32Array, mask: number) => {
    const cone = dataCones[k]!;
    for (let n = 0; n < reads.length; n++) {
      if (((mask >>> n) & 1) !== 0 && reads[n]! >= 0 && cone.includes(reads[n]!)) return true;
    }
    return false;
  };

  /** Makes `X` the bits of flip-flop `k`'s `Q` where `NV`/`NU` and `OV`/`OU` differ. */
  const spoilWhereDiffer = (v: Int32Array, u: Int32Array, k: number) => {
    let any = false;
    for (let w = qFirst[k]!; w < qFirst[k]! + qCount[k]!; w++) {
      const diff = (NV[w]! ^ OV[w]!) | (NU[w]! ^ OU[w]!);
      if (diff === 0) continue;
      u[w] = u[w]! | diff;
      v[w] = v[w]! & ~diff;
      markWord(settle, marks, w);
      any = true;
    }
    return any;
  };

  /**
   * The timing checks, on the words before this delta: each reports what it finds (`flagged`); a
   * hold violation makes `X` the bits its data pin may have changed (the next states from the
   * words as they are and with the pin unknown differ there); pins starting a pulse save the
   * `Q` words they drive.
   */
  const runChecks = (ctx: EvalContext<HdlState>) => {
    const state = ctx.state;
    const { v, u, times, snapV, snapU } = state;
    const { slotPin, slotRising, slotStart, slotWords } = checks!;
    for (let s = 0; s < slotPin.length; s++) {
      const pin = slotPin[s]!;
      if (!ctx.changed(pin)) continue;
      const to = slotRising[s] ? Level.L1 : Level.L0;
      if (ctx.level(pin) !== to || ctx.prev(pin) === to) continue;
      for (let j = slotStart[s]!; j < slotStart[s + 1]!; j++) {
        snapV[j] = v[slotWords[j]!]!;
        snapU[j] = u[slotWords[j]!]!;
      }
    }
    let spoiled = false;
    for (let i = 0; i < checkList.length; i++) {
      const c = checkList[i]!;
      const armed = armedBy(v, u, c, 0) && armedBy(v, u, c, 1);
      let found = 0;
      if (c.kind === 'setup') found = c.setupHold!.setup(ctx, times, armed);
      else if (c.kind === 'hold' || c.kind === 'removal')
        found = c.setupHold!.hold(ctx, times, armed);
      else if (c.kind === 'width') found = c.width!.check(ctx, times, armed) ? 1 : 0;
      else found = armed && c.recovery!.check(ctx, times) ? 1 : 0;
      flagged[i] = found;
      if (found === 0 || c.kind !== 'hold') continue;
      for (let j = 0; j < c.groups.length; j++) {
        const g = c.groups[j]!;
        groups[g]!.next(v, u, NV, NU, 0);
        nextWithUnknown(state, g, c.dataReads, found);
        const members = groups[g]!.members;
        for (let m = 0; m < members.length; m++) {
          const k = members[m]!;
          if (sampledBy(k, c.dataReads, found)) spoiled = spoilWhereDiffer(v, u, k) || spoiled;
        }
      }
    }
    checks!.checks.track(ctx, times);
    if (spoiled) settleAll(ctx);
  };

  /**
   * At the edges of this delta, before they load: a recovery violation makes its clock's edge
   * uncertain; a set-up violation merges the next states with those the late pins unknown give
   * (`X` where they could matter) — the check reports it, so the race doesn't.
   */
  const edgeChecks = (ctx: EvalContext<HdlState>) => {
    const state = ctx.state;
    for (let i = 0; i < checkList.length; i++) {
      const c = checkList[i]!;
      if (flagged[i] === 0 || c.kind !== 'recovery') continue;
      for (let j = 0; j < c.groups.length; j++) {
        const g = c.groups[j]!;
        if (groupEdge[g]) groups[g]!.next(state.v, state.u, NV, NU, 1);
      }
    }
    for (let i = 0; i < checkList.length; i++) {
      const c = checkList[i]!;
      const late = flagged[i]!;
      if (late === 0 || c.kind !== 'setup') continue;
      for (let j = 0; j < c.groups.length; j++) {
        const g = c.groups[j]!;
        if (!groupEdge[g]) continue;
        nextWithUnknown(state, g, c.dataReads, late);
        const members = groups[g]!.members;
        for (let m = 0; m < members.length; m++) {
          const k = members[m]!;
          if (!sampledBy(k, c.dataReads, late)) continue;
          mergeRace(k);
          racing[k] = 0;
        }
      }
    }
  };

  /**
   * After the loads: a short pulse, or a control released too soon after an edge (removal), makes
   * `X` what changed since the pulse began (the edge): `Q` where it differs from the snapshot.
   */
  const endChecks = (ctx: EvalContext<HdlState>) => {
    const { v, u, snapV, snapU } = ctx.state;
    const { slotStart, slotWords } = checks!;
    let any = false;
    for (let i = 0; i < checkList.length; i++) {
      const c = checkList[i]!;
      if (flagged[i] === 0 || c.slot < 0) continue;
      for (let j = slotStart[c.slot]!; j < slotStart[c.slot + 1]!; j++) {
        const w = slotWords[j]!;
        const diff = (v[w]! ^ snapV[j]!) | (u[w]! ^ snapU[j]!);
        if (diff === 0) continue;
        u[w] = u[w]! | diff;
        v[w] = v[w]! & ~diff;
        markWord(settle, marks, w);
        any = true;
      }
    }
    if (any) settleAll(ctx);
  };

  /** Loads every group and stores every write with an edge waiting, all at once. */
  const loadEdges = (ctx: EvalContext<HdlState>) => {
    const state = ctx.state;
    const { v, u } = state;
    for (let g = 0; g < groups.length; g++) {
      if (!groupEdge[g]) continue;
      groups[g]!.load(v, u, NV, NU, marks);
      groupEdge[g] = 0;
    }
    if (writes.length === 0) return;
    // In port order, so a port that wins over an earlier one stores after it.
    for (let p = 0; p < writes.length; p++) {
      if (!pending[p]) continue;
      storeWrite(writes, p, samples, pending, memories, state, ctx.now);
      markMemory(writes[p]!.memory);
    }
    pending.fill(0);
  };

  /**
   * The marked combinational steps, then the asynchronous controls (level-sensitive, from pins or
   * from logic), again while those change a flip-flop. Says whether they kept changing past the
   * limit.
   */
  const settleWords = (state: HdlState): boolean => {
    const { v, u } = state;
    settle.run(v, u, marks, state);
    if (!applyAsync) return false;
    for (let round = 0; ; round++) {
      if (!applyAsync(v, u, marks)) return false;
      if (round >= roundLimit) {
        // Leave nothing marked: the next settle starts clean.
        settle.run(v, u, marks, state);
        return true;
      }
      settle.run(v, u, marks, state);
    }
  };
  const settleAll = (ctx: EvalContext<HdlState>) => {
    if (settleWords(ctx.state)) {
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
    if (cone.length > 0 && loadsUnknown(k)) reportCone(ctx, cone, ctx.state.floating, readPins);
  };
  /** The same for a write port storing an `X`. */
  const reportWrite = (ctx: EvalContext<HdlState>, p: number) => {
    const cone = writeCones[p]!;
    if (cone.length > 0 && writesUnknown(writes, p, samples)) {
      reportCone(ctx, cone, ctx.state.floating, readPins);
    }
  };

  const pinClocked = groups.some((g) => g.pin >= 0) || writeClockPins.some((pin) => pin >= 0);

  /** Notes which read pins changed in this delta; says whether one that clocks nothing did. */
  const noteChanges = (ctx: EvalContext<HdlState>): boolean => {
    let dataChanged = false;
    for (let p = 0; p < readPins.length; p++) {
      const c = ctx.changed(readPins[p]!) ? 1 : 0;
      changed[p] = c;
      if (c && !clockReads[p]) dataChanged = true;
    }
    return dataChanged;
  };

  /** Whether a cone holds a read pin that changed in this delta. */
  const coneChanged = (cone: Int32Array) => {
    for (let i = 0; i < cone.length; i++) if (changed[cone[i]!]) return true;
    return false;
  };

  /**
   * Pin clocks' edges, each next state from the words before this delta (a shift chain shifts by
   * one). A flip-flop whose sampled data changed in this delta too races (`resolveRaces`).
   */
  const pinEdges = (ctx: EvalContext<HdlState>): PinEdges => {
    const { v, u } = ctx.state;
    let result: PinEdges = NO_EDGE;
    // Whether a pin other than a clock changed in this delta: most edges come alone.
    let dataChanged = false;
    let floats = false;
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]!;
      if (group.pin < 0) continue;
      const edge = clockEdge(ctx, group.pin, group.rising ? 'rise' : 'fall');
      if (edge === ClockEdge.NONE) continue;
      if (result === NO_EDGE) {
        result = EDGED;
        dataChanged = noteChanges(ctx);
        floats = ctx.state.floats[0]! > 0;
      }
      group.next(v, u, NV, NU, edge === ClockEdge.UNCERTAIN ? 1 : 0);
      groupEdge[g] = edge;
      const members = group.members;
      if (floats) for (let i = 0; i < members.length; i++) reportLoad(ctx, members[i]!);
      if (!dataChanged && !group.seesClock) continue;
      for (let i = 0; i < members.length; i++) {
        const k = members[i]!;
        if (coneChanged(dataCones[k]!)) {
          racing[k] = 1;
          result = RACES;
        }
      }
    }
    for (let p = 0; p < writes.length; p++) {
      const pin = writeClockPins[p]!;
      if (pin < 0) continue;
      const edge = clockEdge(ctx, pin, writes[p]!.rising ? 'rise' : 'fall');
      if (edge === ClockEdge.NONE) continue;
      if (result === NO_EDGE) {
        result = EDGED;
        dataChanged = noteChanges(ctx);
      }
      sampleWriteWords(writes, p, edge === ClockEdge.UNCERTAIN, v, u, samples);
      pending[p] = 1;
      reportWrite(ctx, p);
      if (!dataChanged && !writeDataSeesClock[p]) continue;
      if (coneChanged(writeDataCones[p]!)) {
        writeRacing[p] = 1;
        result = RACES;
      }
    }
    return result;
  };

  /**
   * Reads the pins into the words, a word at a time (a port's pins share theirs), marking what
   * reads a word that changed; says how many float.
   */
  const readInputs = (ctx: EvalContext<HdlState>): number => {
    const { v, u, floating } = ctx.state;
    let floats = 0;
    let w = -1;
    let nv = 0;
    let nu = 0;
    for (let i = 0; i < readPins.length; i++) {
      const level = ctx.level(readPins[i]!);
      const f = level === Level.Z ? 1 : 0;
      floating[i] = f;
      floats += f;
      const t = toInput(level);
      if (readWord[i] !== w) {
        if (w >= 0 && (nv !== v[w] || nu !== u[w])) {
          v[w] = nv;
          u[w] = nu;
          markWord(settle, marks, w);
        }
        w = readWord[i]!;
        nv = v[w]!;
        nu = u[w]!;
      }
      const m = 1 << readPos[i]!;
      nu = t === Level.X ? nu | m : nu & ~m;
      nv = t === Level.L1 ? nv | m : nv & ~m;
    }
    if (w >= 0 && (nv !== v[w] || nu !== u[w])) {
      v[w] = nv;
      u[w] = nu;
      markWord(settle, marks, w);
    }
    ctx.state.floats[0] = floats;
    return floats;
  };

  /** A race at the pins: each racing next state with the data after the change too, merged. */
  const resolveRaces = (ctx: EvalContext<HdlState>) => {
    const { v, u } = ctx.state;
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]!;
      const members = group.members;
      let any = false;
      for (let i = 0; i < members.length && !any; i++) any = racing[members[i]!] === 1;
      if (!any) continue;
      group.next(v, u, OV, OU, groupEdge[g] === ClockEdge.UNCERTAIN ? 1 : 0);
      for (let i = 0; i < members.length; i++) {
        const k = members[i]!;
        if (!racing[k]) continue;
        racing[k] = 0;
        if (!mergeRace(k)) continue;
        const cone = dataCones[k]!;
        let pin = -1;
        for (let j = 0; j < cone.length && pin < 0; j++) {
          if (changed[cone[j]!]) pin = readPins[cone[j]!]!;
        }
        ctx.report({
          kind: 'setup-violation',
          message: `${pinNames[pin] ?? 'an input'} changed at the clock edge of ${flipFlopNames[k]}: it loads X where that matters`,
          ...(pin >= 0 ? { pin } : {}),
        });
      }
    }
    for (let p = 0; p < writes.length; p++) {
      if (!writeRacing[p]) continue;
      writeRacing[p] = 0;
      sampleWriteWords(writes, p, false, v, u, otherSamples);
      if (!mergeWrite(writes, p, samples, otherSamples)) continue;
      const cone = writeDataCones[p]!;
      let pin = -1;
      for (let i = 0; i < cone.length && pin < 0; i++) {
        if (changed[cone[i]!]) pin = readPins[cone[i]!]!;
      }
      ctx.report({
        kind: 'setup-violation',
        message: `${pinNames[pin] ?? 'an input'} changed at the clock edge of ${writeNames[p]}'s write: it writes X where that matters`,
        ...(pin >= 0 ? { pin } : {}),
      });
    }
    loadEdges(ctx);
    settleAll(ctx);
  };

  /**
   * Rounds of edges of clocks made by logic: a divider's output clocks the next stage. Inside one
   * evaluation everything is one instant, so a flip-flop whose data changed in it (since the
   * evaluation began) races its clock.
   */
  const internalRounds = (ctx: EvalContext<HdlState>) => {
    const { v, u, seen } = ctx.state;
    for (let round = 0; ; round++) {
      let any = false;
      for (let j = 0; j < internal.length; j++) {
        const k = internal[j]!;
        const g = groupOf[k]!;
        const now = levelAt(v, u, clocks.word[k]!, clocks.pos[k]!);
        const edge = edgeOf(seen[k]!, now, rising[k] === 1);
        seen[k] = now;
        if (edge === ClockEdge.NONE) continue;
        const uncertain = edge === ClockEdge.UNCERTAIN;
        const group = groups[g]!;
        if (round >= roundLimit) {
          // Still clocking after every stage could have: it oscillates inside the module.
          allUnknown(k);
          ctx.report({
            kind: 'oscillation',
            message: `${flipFlopNames[k]} keeps clocking inside the module: X`,
          });
        } else {
          group.next(v, u, NV, NU, uncertain ? 1 : 0);
          // An uncertain edge already merged what it could load; a certain one is checked.
          if (!uncertain) {
            group.next(BV, BU, OV, OU, 0);
            if (mergeRace(k)) {
              ctx.report({
                kind: 'race-violation',
                message: clocked[k]
                  ? `${flipFlopNames[k]} is clocked again in the same instant (its clock glitches inside the module): it loads X where that matters`
                  : `${flipFlopNames[k]} is clocked by logic, and its data changed at the same instant: it loads X where that matters — use a clock enable`,
              });
            }
          }
        }
        groupEdge[g] = edge;
        clocked[k] = 1;
        any = true;
        reportLoad(ctx, k);
      }
      if (writeRounds(ctx, round)) any = true;
      if (!any) return;
      loadEdges(ctx);
      settleAll(ctx);
    }
  };

  /** A round's edges of write ports clocked by logic (`internalRounds`); says whether one had one. */
  const writeRounds = (ctx: EvalContext<HdlState>, round: number): boolean => {
    const { v, u, wseen } = ctx.state;
    let any = false;
    for (let j = 0; j < writeInternal.length; j++) {
      const p = writeInternal[j]!;
      const wp = writes[p]!;
      const now = levelAt(v, u, writeClocks.word[p]!, writeClocks.pos[p]!);
      const edge = edgeOf(wseen[p]!, now, wp.rising);
      wseen[p] = now;
      if (edge === ClockEdge.NONE) continue;
      const uncertain = edge === ClockEdge.UNCERTAIN;
      sampleWriteWords(writes, p, uncertain, v, u, samples);
      if (round >= roundLimit) {
        spoilWrite(writes, p, samples);
        ctx.report({
          kind: 'oscillation',
          message: `${writeNames[p]}'s write keeps clocking inside the module: X`,
        });
      } else if (!uncertain) {
        sampleWriteWords(writes, p, false, BV, BU, otherSamples);
        if (mergeWrite(writes, p, samples, otherSamples)) {
          ctx.report({
            kind: 'race-violation',
            message: writeClocked[p]
              ? `${writeNames[p]}'s write is clocked again in the same instant (its clock glitches inside the module): it writes X where that matters`
              : `${writeNames[p]}'s write is clocked by logic, and what it writes changed at the same instant: it writes X where that matters — use a write enable`,
          });
        }
      }
      pending[p] = 1;
      writeClocked[p] = 1;
      any = true;
      reportWrite(ctx, p);
    }
    return any;
  };

  /** An open latch holding `X`, or an asynchronous control at `X`, reports the pins behind it. */
  const reportFloating = (ctx: EvalContext<HdlState>) => {
    const { v, u, floating } = ctx.state;
    for (let k = 0; k < latches.length; k++) {
      const latch = latches[k]!;
      const e = levelAt(v, u, latch.en.word[0]!, latch.en.pos[0]!);
      if (active(e, latch.enPolarity) === 0) continue;
      let unknown = false;
      for (let i = 0; i < latch.q.word.length && !unknown; i++) {
        unknown = levelAt(v, u, latch.q.word[i]!, latch.q.pos[i]!) === TX;
      }
      if (unknown) reportCone(ctx, latch.cone, floating, readPins);
    }
    for (let j = 0; j < asyncFlops.length; j++) {
      if (asyncUnknown(asyncFlopInfo[j]!, v, u)) {
        reportCone(ctx, asyncCones[asyncFlops[j]!]!, floating, readPins);
      }
    }
  };

  /**
   * Drives every output with the delay — its `specify` paths' where it has some (HDL-2); one
   * driven `X` reports the floating pins behind it.
   */
  const { word: bitWord, pos: bitPos } = driveBits;
  const { word: enableWord, pos: enablePos } = driveEnables;
  const { pathDelays } = program;
  const driveOutputs = (ctx: EvalContext<HdlState>, floats: number) => {
    const { v, u, floating } = ctx.state;
    for (let i = 0; i < drivePins.length; i++) {
      let drive: Drive;
      let level: number;
      const t = levelAt(v, u, bitWord[i]!, bitPos[i]!);
      if (driveKinds[i] === STRONG) {
        drive = DRIVES[t]!;
        level = t;
      } else {
        const e = levelAt(v, u, enableWord[i]!, enablePos[i]!);
        drive = e === 0 ? Drive.Z : e === 1 ? DRIVES[t]! : Drive.STRONG_X;
        level = e === 0 ? DRIVE_Z : e === 1 ? t : TX;
      }
      const after = pathDelays ? pathDelays.delay(ctx, v, u, i, level, delay) : delay;
      ctx.drive(drivePins[i]!, drive, after);
      if (floats > 0 && drive === Drive.STRONG_X)
        reportCone(ctx, driveCones[i]!, floating, readPins);
    }
  };

  return {
    createState(): HdlState {
      // Every bit unknown but those with a power-up value (`init`), as an FPGA's bitstream loads
      // its flip-flops.
      const v = new Int32Array(words + 1);
      const u = new Int32Array(words + 1);
      u.set(usedBits(layout));
      v[words] = CONSTANT_V;
      u[words] = CONSTANT_U;
      const { initBits, initValues } = program;
      for (let i = 0; i < initBits.length; i++) {
        setBit(layout, v, u, initBits[i]!, initValues[i]!);
      }
      // Memories start with their power-up contents (`initial`, `$readmemh`), as an FPGA's
      // bitstream loads its block RAMs.
      const memoryState = newMemoryState(memories, readMemory.length);
      const state: HdlState = {
        v,
        u,
        ...memoryState,
        floating: new Uint8Array(readPins.length),
        floats: new Int32Array(1),
        seen: new Uint8Array(qFirst.length),
        wseen: new Uint8Array(writes.length),
        times: checks ? checks.checks.createTimes() : new Float64Array(0),
        snapV: new Int32Array(checks ? checks.slotWords.length : 0),
        snapU: new Int32Array(checks ? checks.slotWords.length : 0),
      };
      // The logic settles from the power-up values (the pins unknown), so a clock made from an
      // initialized register (`~div`) is known before anything happens.
      markAll(settle, marks);
      settleWords(state);
      loopFailed.fill(0);
      // Clocks start where power-up left them: `reg div = 0` makes no edge.
      for (let k = 0; k < qFirst.length; k++) {
        state.seen[k] = levelAt(v, u, clocks.word[k]!, clocks.pos[k]!);
      }
      for (let p = 0; p < writes.length; p++) {
        state.wseen[p] = levelAt(v, u, writeClocks.word[p]!, writeClocks.pos[p]!);
      }
      return state;
    },
    evaluate(ctx: EvalContext<HdlState>) {
      const state = ctx.state;
      if (hasInternal) {
        BV.set(state.v);
        BU.set(state.u);
        clocked.fill(0);
        writeClocked.fill(0);
      }
      // Each phase is its own function, run only where the module needs it: an evaluation of a
      // decoder reads its pins, settles and drives, as in HDL-1.
      if (checks) runChecks(ctx);
      const edges = pinClocked ? pinEdges(ctx) : NO_EDGE;
      if (checks && edges !== NO_EDGE) edgeChecks(ctx);
      // Flip-flops load now — unless one races: then all wait, so it sees the others as before.
      if (edges === EDGED) loadEdges(ctx);
      const floats = readInputs(ctx);
      settleAll(ctx);
      if (edges === RACES) resolveRaces(ctx);
      if (hasInternal) internalRounds(ctx);
      if (checks) endChecks(ctx);
      if (floats > 0) reportFloating(ctx);
      driveOutputs(ctx, floats);
      if (readMemory.length > 0) stampReads(readMemory, state, ctx.now);
    },
    action(ctx: EvalContext<HdlState>, payload: unknown) {
      if (!isPokeAction(payload)) {
        throw new Error(`${ctx.id}: unknown action ${JSON.stringify(payload)}`);
      }
      markMemory(pokeMemory(program, ctx, payload));
      // What reads the memory follows at once, the outputs after their delay.
      settleAll(ctx);
      driveOutputs(ctx, 0);
      stampReads(readMemory, ctx.state, ctx.now);
    },
  };
}

/**
 * Whether a flip-flop's asynchronous controls are unknown, or active with its state unknown: the
 * floating rule reports the pins behind them then.
 */
function asyncUnknown(ff: AsyncFlop, v: Int32Array, u: Int32Array): boolean {
  let activeControl = false;
  const control = (at: Places, i: number, polarity: number) => {
    const t = active(levelAt(v, u, at.word[i]!, at.pos[i]!), polarity);
    if (t === 1) activeControl = true;
    return t === TX;
  };
  if (ff.arst.word.length > 0 && control(ff.arst, 0, ff.arstPolarity)) return true;
  if (ff.aload.word.length > 0 && control(ff.aload, 0, ff.aloadPolarity)) return true;
  for (let i = 0; i < ff.set.word.length; i++) {
    if (control(ff.set, i, ff.setPolarity) || control(ff.clr, i, ff.clrPolarity)) return true;
  }
  if (!activeControl) return false;
  for (let i = 0; i < ff.q.word.length; i++) {
    if (levelAt(v, u, ff.q.word[i]!, ff.q.pos[i]!) === TX) return true;
  }
  return false;
}
