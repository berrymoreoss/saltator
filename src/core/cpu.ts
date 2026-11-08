/**
 * What a CPU part shows of itself to tools (`ComponentDefinition.cpu`): its registers as its
 * programming model names them, and a view of an instance's state — register values with their
 * unknown bits, what it is doing, the instruction under way. The CPU tab, watches and test
 * benches read it (R17b); scenario tests read registers through it. Spec:
 * docs/simulation.md#observability.
 */

/** A register of a CPU's programming model. */
export interface CpuRegisterDef {
  /** As the data sheet names it: `A`, `X`, `PC`, `P`. */
  readonly name: string;
  /** Bits, 1–32. */
  readonly width: number;
  /**
   * A status register's bits, one character each, the highest bit first; `-` for a bit without
   * a name (the 65C02's `P` is `NV-BDIZC`).
   */
  readonly flags?: string;
}

/**
 * What a CPU is doing: executing instructions; held in reset; waiting for an interrupt (`WAI`);
 * stopped until reset (`STP`); or in a state nobody knows (power-on before a reset, or lost
 * after acting on unknown bits) — its outputs are then `X`.
 */
export type CpuMode = 'running' | 'reset' | 'waiting' | 'stopped' | 'unknown';

/** The instruction a CPU is executing. */
export interface CpuInstruction {
  /** Where its opcode was fetched. */
  readonly address: number;
  readonly opcode: number;
  /** The bus cycle in it, 0 for the opcode fetch. */
  readonly cycle: number;
}

/** A CPU instance's state as tools see it. */
export interface CpuView {
  /** One value per register, in `CpuDef.registers` order. */
  readonly values: readonly number[];
  /** Unknown bits per register (a set bit is `X`: that bit of the value means nothing). */
  readonly unknown: readonly number[];
  readonly mode: CpuMode;
  /** The instruction under way, while `running` (undefined in an interrupt or reset sequence). */
  readonly instruction?: CpuInstruction;
}

/** What a CPU part shows of itself (`ComponentDefinition.cpu`). */
export interface CpuDef<State = unknown> {
  readonly registers: readonly CpuRegisterDef[];
  /** The register that holds the program counter (`PC`). */
  readonly programCounter: string;
  /** The address bus pins, A0 first. */
  readonly addressPins: readonly string[];
  /** The data bus pins, D0 first. */
  readonly dataPins: readonly string[];
  /** A view of an instance's state (`sim.stateOf(id)`), for inspection only. */
  view(state: State): CpuView;
}

/** A register name: a letter, then letters and digits. */
const REGISTER_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * The problems of a CPU definition, for the registry: register names unique and well-formed,
 * widths 1–32, flag strings one character per bit, the program counter one of the registers,
 * the bus pins pins of the part that carry signals.
 */
export function cpuProblems(
  cpu: CpuDef<never>,
  pins: readonly { readonly name: string; readonly dir: string }[],
): string[] {
  const problems: string[] = [];
  if (cpu.registers.length === 0) problems.push('a CPU needs registers');
  const names = new Set<string>();
  for (const { name, width, flags } of cpu.registers) {
    if (!REGISTER_NAME.test(name)) problems.push(`invalid register name "${name}"`);
    if (names.has(name)) problems.push(`duplicate register "${name}"`);
    names.add(name);
    if (!Number.isInteger(width) || width < 1 || width > 32) {
      problems.push(`register ${name} must be 1 to 32 bits wide, got ${width}`);
    }
    if (flags !== undefined && [...flags].length !== width) {
      problems.push(`register ${name}'s flags "${flags}" must name ${width} bits`);
    }
  }
  if (!names.has(cpu.programCounter)) {
    problems.push(`program counter "${cpu.programCounter}" is not a register`);
  }
  const bus = (label: string, list: readonly string[]) => {
    if (list.length === 0) problems.push(`a CPU needs ${label} pins`);
    for (const name of list) {
      const pin = pins.find((p) => p.name === name);
      if (!pin || pin.dir === 'power' || pin.dir === 'nc') {
        problems.push(`${label} pin "${name}" is not a signal pin of the part`);
      }
    }
  };
  bus('address', cpu.addressPins);
  bus('data', cpu.dataPins);
  return problems;
}
