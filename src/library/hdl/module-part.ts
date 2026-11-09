/**
 * A Verilog module as a part (HDL-1, ADR-0030): the definition made from a module's IR — a pin
 * per port bit, one output delay (`delay`) — and its behavior, the interpreter. Each `evaluate`:
 * the flip-flops whose clock had an edge load from the values before it, the inputs are read,
 * asynchronous resets apply, the combinational cells and latches run once each in topological
 * order (no events inside a module), and every output is driven with the delay (inertial, so an
 * unchanged output costs nothing). State is two byte planes over the bits — plain data, so
 * snapshots, rewind and replicas work as for any part. Spec: docs/components.md#verilog-modules.
 */
import {
  type AnyComponentDefinition,
  type Behavior,
  defineComponent,
  type EvalContext,
  type HdlMessage,
  type HdlModule,
  hdlModuleProblems,
  hdlPortName,
  hdlPortPins,
  Level,
  ns,
  type PinDef,
  type PropDef,
  strong,
  toInput,
} from '../../core';
import { ClockEdge, clockEdge } from '../74xx/edge-triggered';
import { analyzeHdlModule } from './analyze';
import {
  asyncReset,
  type CellStep,
  compileFlipFlop,
  compileStep,
  type FlipFlop,
  load,
  newPlanes,
  nextState,
  planeIndex,
} from './cells';

/** The family of the parts modules run as: `hdl/<circuit id>` (reserved, like `sub`). */
export const HDL_FAMILY = 'hdl';

/** The output delay of a module without timing: an ATF22V10C-15's tPD (the plan's Q4). */
export const HDL_DEFAULT_DELAY = ns(15);

export const hdlDelayProp: PropDef = {
  key: 'delay',
  label: 'Delay',
  type: 'time',
  default: HDL_DEFAULT_DELAY,
  min: 0,
};

/** What making a module's part gave: the definition unless it has errors, and the messages. */
export interface HdlPartResult {
  readonly definition?: AnyComponentDefinition;
  /** The module's errors (it can't run) and warnings (latches, `init` values). */
  readonly messages: readonly HdlMessage[];
}

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
}

/** Everything an instance runs, made once per module. */
interface Program {
  readonly bitCount: number;
  readonly inputPins: Int32Array;
  readonly inputBits: Int32Array;
  readonly outputPins: Int32Array;
  readonly outputBits: Int32Array;
  readonly steps: readonly CellStep[];
  readonly flipFlops: readonly FlipFlop[];
  /** Flip-flops with an asynchronous reset. */
  readonly resets: readonly FlipFlop[];
  /** The plane index of each pin's bit (−1 for outputs), for clocks: pin by bit. */
  readonly pinOfBit: Int32Array;
  readonly nextSize: number;
}

/** The pins of a module: each port's bits in declaration order, least significant first. */
export function hdlPins(module: HdlModule): PinDef[] {
  return module.ports.flatMap((port) => {
    const word = port.dir === 'in' ? 'input' : 'output';
    const bus = hdlPortName(port);
    return hdlPortPins(port).map(
      (name, i): PinDef => ({
        name,
        dir: port.dir,
        description:
          port.bits.length === 1 ? `${word} ${bus}` : `${word} ${bus}, bit ${port.lsb + i}`,
      }),
    );
  });
}

function compile(
  module: HdlModule,
  order: readonly number[],
  flipFlopCells: readonly number[],
): Program {
  const { bitCount } = module;
  const inputPins: number[] = [];
  const inputBits: number[] = [];
  const outputPins: number[] = [];
  const outputBits: number[] = [];
  const pinOfBit = new Int32Array(bitCount + 3).fill(-1);
  let pin = 0;
  for (const port of module.ports) {
    for (const bit of port.bits) {
      const index = planeIndex(bit, bitCount);
      if (port.dir === 'in') {
        inputPins.push(pin);
        inputBits.push(index);
        pinOfBit[index] = pin;
      } else {
        outputPins.push(pin);
        outputBits.push(index);
      }
      pin++;
    }
  }
  let offset = 0;
  const flipFlops = flipFlopCells.map((index) => {
    const ff = compileFlipFlop(module.cells[index]!, bitCount, offset);
    offset += ff.q.length;
    return ff;
  });
  return {
    bitCount,
    inputPins: Int32Array.from(inputPins),
    inputBits: Int32Array.from(inputBits),
    outputPins: Int32Array.from(outputPins),
    outputBits: Int32Array.from(outputBits),
    steps: order.map((index) => compileStep(module.cells[index]!, bitCount)),
    flipFlops,
    resets: flipFlops.filter((ff) => ff.arst >= 0),
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
  const program = compile(module, analysis.order, analysis.flipFlops);
  const counts = new Map<string, number>();
  for (const cell of module.cells) counts.set(cell.type, (counts.get(cell.type) ?? 0) + 1);
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

function behavior(program: Program, delay: number): Behavior<HdlState> {
  const { bitCount, inputPins, inputBits, outputPins, outputBits, steps, flipFlops, resets } =
    program;
  return {
    createState(): HdlState {
      return {
        ...newPlanes(bitCount),
        next: new Uint8Array(program.nextSize),
        edges: new Uint8Array(flipFlops.length),
      };
    },
    evaluate(ctx: EvalContext<HdlState>) {
      const { val, unk, next, edges } = ctx.state;
      // Clock edges: every next state from the values before the edge, then all loaded at once.
      let edged = false;
      for (let k = 0; k < flipFlops.length; k++) {
        const ff = flipFlops[k]!;
        const pin = program.pinOfBit[ff.clk]!;
        if (pin < 0) continue; // a clock tied to a constant never ticks
        const edge = clockEdge(ctx, pin, ff.rising ? 'rise' : 'fall');
        if (edge === ClockEdge.NONE) continue;
        nextState(ff, edge === ClockEdge.UNCERTAIN, val, unk, next);
        edges[k] = 1;
        edged = true;
      }
      if (edged) {
        for (let k = 0; k < flipFlops.length; k++) {
          if (!edges[k]) continue;
          load(flipFlops[k]!, val, unk, next);
          edges[k] = 0;
        }
      }
      for (let i = 0; i < inputPins.length; i++) {
        const level = toInput(ctx.read(inputPins[i]!));
        const b = inputBits[i]!;
        unk[b] = level === Level.X ? 1 : 0;
        val[b] = level === Level.L1 ? 1 : 0;
      }
      for (let k = 0; k < resets.length; k++) asyncReset(resets[k]!, val, unk);
      for (let k = 0; k < steps.length; k++) steps[k]!(val, unk);
      for (let i = 0; i < outputPins.length; i++) {
        const b = outputBits[i]!;
        ctx.drive(outputPins[i]!, strong(unk[b] ? Level.X : val[b] ? Level.L1 : Level.L0), delay);
      }
    },
  };
}
