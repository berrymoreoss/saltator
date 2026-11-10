/**
 * Inner signals (HDL-4): named signals inside a part — a Verilog module's registers and wires by
 * their source names — that probes, watches, breakpoints and test benches read without bringing
 * them out to pins. A part shows them through a view on its definition
 * (`ComponentDefinition.signals`), as memories and CPUs show their contents. They are not nets:
 * a recorder samples them at the end of each instant (`Recorder`). Spec:
 * docs/simulation.md#inner-signals, ADR-0035.
 */
import type { Level } from './logic';
import type { Simulator } from './simulator';

/** A named signal inside a part: `state`, `count` (`[7:0]`: `lsb` 0, `width` 8). */
export interface InnerSignal {
  /** Its name in the source; may hold `.` (a flattened submodule's `u_core.state`). */
  readonly name: string;
  /** The source's index of its least significant bit (`addr[15:12]`: 12). */
  readonly lsb: number;
  /** Bits, 1 or more. */
  readonly width: number;
  /** Where it is declared: `uart_tx.v:8.13-8.18`. */
  readonly src?: string;
}

/** What a part shows of its inner signals (`ComponentDefinition.signals`). */
export interface SignalsDef<State = unknown> {
  readonly list: readonly InnerSignal[];
  /**
   * Bit `bit` (0: the least significant) of signal `signal` (an index into `list`) in an
   * instance's state now: `L0`, `L1` or `X`. Reads the state; never copies or allocates.
   */
  level(state: State, signal: number, bit: number): Level;
}

/** One bit of a part's inner signal, as plain data: what a channel or a watch reads. */
export interface InnerBit {
  /** The part's id in the netlist (`A1/U1`). */
  readonly part: string;
  /** Index into the part's `signals.list`. */
  readonly signal: number;
  readonly bit: number;
}

/**
 * Reads `source` in `sim`: a function that gives its level now, or undefined where `sim` has no
 * such part or bit (a recompiled module that lost the signal).
 */
export function innerReader(sim: Simulator, source: InnerBit): (() => Level) | undefined {
  const view = sim.definitionOf(source.part)?.signals;
  const signal = view?.list[source.signal];
  if (!view || !signal || source.bit < 0 || source.bit >= signal.width) return undefined;
  const { part, signal: index, bit } = source;
  // The state is looked up on every read: a restore whose state changed shape replaces it.
  return () => view.level(sim.stateOf(part), index, bit);
}

/** The problems of a part's `signals` view, for the registry: names given and unique, widths. */
export function signalsProblems(signals: SignalsDef): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const signal of signals.list) {
    if (signal.name === '') problems.push('an inner signal has no name');
    else if (seen.has(signal.name)) problems.push(`inner signal ${signal.name} twice`);
    seen.add(signal.name);
    if (!Number.isInteger(signal.width) || signal.width < 1) {
      problems.push(`inner signal ${signal.name}: width ${signal.width}`);
    }
    if (!Number.isInteger(signal.lsb))
      problems.push(`inner signal ${signal.name}: lsb ${signal.lsb}`);
  }
  return problems;
}
