import {
  type AnyComponentDefinition,
  isDriverPin,
  isReadPin,
  type PinDef,
  pinsOf,
  resolveProps,
} from '../component';
import type { Diagnostic } from '../diagnostics';
import { Level, levelChar, strong } from '../logic';
import { NetlistBuilder } from '../netlist';
import { Registry } from '../registry';
import { type RunStatus, type SettleOptions, Simulator, type SimulatorOptions } from '../simulator';
import { testDriver } from '../test-driver';
import { formatTime, type Time } from '../time';

/** A level as written in tests: `0`, `1`, `'X'`, `'Z'` (or a `Level` constant). */
export type BenchValue = Level | 'X' | 'Z';

/** Pin name → value. */
export type BenchValues = Readonly<Record<string, BenchValue>>;

/** Converts a test value to a `Level`. */
export function toLevel(value: BenchValue): Level {
  if (value === 'X') return Level.X;
  if (value === 'Z') return Level.Z;
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  throw new Error(`bad bench value ${JSON.stringify(value)} (expected 0, 1, 'X' or 'Z')`);
}

const DUT = 'DUT';
const driverId = (pin: string) => `drv:${pin}`;

/**
 * A single part under test. Every `in`/`bidir` pin gets a test driver; every pin's net is named
 * after the pin, so outputs are read by pin name.
 *
 * ```ts
 * const bench = new Bench(nand, { inputs: 2 });
 * bench.set({ A: 1, B: 1 });
 * bench.settle();
 * bench.expect({ Y: 0 });
 * ```
 */
export class Bench {
  readonly sim: Simulator;
  readonly pins: readonly PinDef[];

  constructor(
    definition: AnyComponentDefinition,
    props: Readonly<Record<string, unknown>> = {},
    options: SimulatorOptions = {},
  ) {
    this.pins = pinsOf(definition, resolveProps(definition, props));
    const builder = new NetlistBuilder().add(DUT, definition.type, props);
    for (const pin of this.pins) {
      if (pin.dir === 'power' || pin.dir === 'nc') continue;
      const pins = [`${DUT}.${pin.name}`];
      if (isReadPin(pin.dir)) {
        builder.add(driverId(pin.name), testDriver.type);
        pins.push(`${driverId(pin.name)}.Y`);
      }
      builder.net(pin.name, ...pins);
    }
    const registry = new Registry(
      definition.type === testDriver.type ? [definition] : [definition, testDriver],
    );
    this.sim = new Simulator(builder.build(), registry, options);
  }

  get now(): Time {
    return this.sim.now;
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.sim.diagnostics.entries;
  }

  /** Drives inputs (and bidir pins) at the current time. `'Z'` releases a pin. */
  set(values: BenchValues): this {
    for (const [name, value] of Object.entries(values)) {
      const pin = this.pin(name);
      if (!isReadPin(pin.dir)) throw new Error(`bench: pin ${name} is an output (${pin.dir})`);
      this.sim.action(driverId(name), strong(toLevel(value)));
    }
    return this;
  }

  /** Sends an action to the part under test (button press, …). */
  action(payload: unknown): this {
    this.sim.action(DUT, payload);
    return this;
  }

  /** Runs until nothing is pending; throws if the simulation halted. */
  settle(options?: SettleOptions): RunStatus {
    const status = this.sim.settle(options);
    if (status === 'halted')
      throw new Error(`bench: simulation halted\n${this.describeDiagnostics()}`);
    return status;
  }

  /** Runs for `dt` of simulated time. */
  run(dt: Time): RunStatus {
    return this.sim.runFor(dt);
  }

  /** Level of a pin's net. */
  get(name: string): Level {
    this.pin(name);
    return this.sim.level(name);
  }

  /** Levels of the given pins (default: all non-power pins) as `{ Y: '1', … }`. */
  levels(names: readonly string[] = this.signalPins()): Record<string, '0' | '1' | 'X' | 'Z'> {
    return Object.fromEntries(names.map((n) => [n, levelChar(this.get(n))]));
  }

  /** Throws a readable error unless every listed pin has the expected level. */
  expect(expected: BenchValues): this {
    const wrong = this.mismatches(expected);
    if (wrong.length > 0) {
      throw new Error(
        `bench at ${formatTime(this.now)}: ${wrong.join(', ')}\n  pins: ${this.describeLevels()}`,
      );
    }
    return this;
  }

  /** Mismatches against `expected`, e.g. `['Y: expected 1, got X']`; empty if all match. */
  mismatches(expected: BenchValues): string[] {
    const wrong: string[] = [];
    for (const [name, value] of Object.entries(expected)) {
      const want = toLevel(value);
      const got = this.get(name);
      if (got !== want) wrong.push(`${name}: expected ${levelChar(want)}, got ${levelChar(got)}`);
    }
    return wrong;
  }

  /** Throws if any diagnostic was recorded. */
  expectNoDiagnostics(): this {
    if (this.diagnostics.length > 0)
      throw new Error(`bench: unexpected diagnostics\n${this.describeDiagnostics()}`);
    return this;
  }

  /**
   * Applies `stimulus` now and returns how long it takes `output` to change. The bench should be
   * settled first. Throws if the output does not change before the circuit settles.
   */
  measure(stimulus: BenchValues, output: string, options?: SettleOptions): Time {
    const net = this.sim.netIndex(output);
    const start = this.now;
    let changedAt: Time | undefined;
    const off = this.sim.onNetChange((t, n) => {
      if (n === net && changedAt === undefined) changedAt = t;
    });
    try {
      this.set(stimulus);
      this.settle(options);
    } finally {
      off();
    }
    if (changedAt === undefined) {
      throw new Error(`bench: ${output} did not change after ${JSON.stringify(stimulus)}`);
    }
    return changedAt - start;
  }

  private pin(name: string): PinDef {
    const pin = this.pins.find((p) => p.name === name);
    if (!pin)
      throw new Error(`bench: no pin "${name}" (pins: ${this.pins.map((p) => p.name).join(', ')})`);
    if (pin.dir === 'power' || pin.dir === 'nc')
      throw new Error(`bench: pin ${name} is not simulated (${pin.dir})`);
    return pin;
  }

  private signalPins(): string[] {
    return this.pins.filter((p) => isReadPin(p.dir) || isDriverPin(p.dir)).map((p) => p.name);
  }

  private describeLevels(): string {
    return Object.entries(this.levels())
      .map(([n, l]) => `${n}=${l}`)
      .join(' ');
  }

  private describeDiagnostics(): string {
    return this.diagnostics.map((d) => `  [${d.kind}] ${d.message}`).join('\n');
  }
}
