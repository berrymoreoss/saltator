/**
 * A test bench on one circuit of a document (R15a): the circuit compiled as the top, a driver on
 * every input and bidirectional port, its switches, buttons, DIP switches and manual clocks
 * operated as the Interact tool does, time passing in waits and fixed steps, outputs checked
 * against expected values. A script drives it through `benchApi` (script.ts). Pure: the clock is
 * the simulation's. Spec: docs/circuit.md#test-benches.
 */
import {
  type ComponentRegistry,
  type Diagnostic,
  type DiagnosticInput,
  Drive,
  diagnosticSeverity,
  formatTime,
  Level,
  type MemoryDef,
  type Netlist,
  type NetlistNet,
  type PropValue,
  parseTime,
  resolveProps,
  SeededRandom,
  Simulator,
  strong,
  symbolOf,
  type Time,
  testDriver,
  us,
} from '../../core';
import { portBits } from '../checks';
import { compileDesign, type Design } from '../design';
import type { CircuitDocument } from '../document';
import { Resolver } from '../resolve';
import { circuitPorts } from '../subcircuit';
import {
  BenchError,
  bitsMatch,
  bitsValue,
  type ExpectedBits,
  expectedBits,
  formatExpected,
  formatLevels,
  inputBits,
} from './values';

/** A check that failed, an error the simulation reported, or `b.fail`. */
export interface BenchFailure {
  /** The script line it happened at, when the host knows it. */
  readonly line?: number;
  readonly time: Time;
  /** The whole story: `Q[0..3] is 0x5, expected 0x4 (after the 5th pulse)`. */
  readonly message: string;
  /** For a failed check: the reference, what was expected and what was there. */
  readonly ref?: string;
  readonly expected?: string;
  readonly actual?: string;
}

/** A line `b.log` wrote. */
export interface BenchLog {
  readonly line?: number;
  readonly time: Time;
  readonly text: string;
}

export type BenchStatus = 'pass' | 'fail' | 'error';

/** What a bench found. */
export interface BenchReport {
  /** `error`: the bench couldn't go on (a bad reference, an exception, a halted simulation). */
  readonly status: BenchStatus;
  /** The first `maxFailures` failures, in order. */
  readonly failures: readonly BenchFailure[];
  /** All failures, kept or not. */
  readonly failureCount: number;
  /** Why the bench stopped, for `error`. */
  readonly error?: { readonly message: string; readonly line?: number };
  /** What the simulation warned about (floating inputs, …), merged as its log keeps them. */
  readonly warnings: readonly Diagnostic[];
  readonly logs: readonly BenchLog[];
  /** The simulated time the bench reached. */
  readonly time: Time;
  /** Events the simulation processed. */
  readonly events: number;
}

export interface BenchOptions {
  /** The script line running now, for failures and logs (the script host's). */
  readonly line?: () => number | undefined;
  /** Seeds `random()`: the same bench draws the same numbers (default 0). */
  readonly seed?: number;
  /** Failures kept in the report (default 100); later ones are counted. */
  readonly maxFailures?: number;
}

/** Thrown by `fail()`: ends the bench as failed (not as an error). */
export class BenchStop extends Error {
  constructor() {
    super('the bench stopped');
    this.name = 'BenchStop';
  }
}

/** The step a row or a clock pulse takes unless the script sets another. */
export const DEFAULT_STEP: Time = us(1);

const DRIVER = 'drv:';

/** Something a bench drives. */
type Input =
  | { readonly kind: 'port'; readonly drivers: readonly string[] }
  | { readonly kind: 'switch'; readonly part: string }
  | { readonly kind: 'button'; readonly part: string }
  | { readonly kind: 'dip-switch'; readonly part: string; readonly count: number }
  | { readonly kind: 'clock'; readonly part: string; readonly manual: boolean };

/** Something a bench reads. */
type Output =
  | { readonly kind: 'nets'; readonly nets: readonly (number | undefined)[] }
  | {
      readonly kind: 'cells';
      readonly part: string;
      readonly memory: MemoryDef;
      readonly from: number;
      readonly to: number;
    };

/**
 * One run of a bench on the circuit `circuitId` of `document`. Methods throw a `BenchError` for
 * a mistake of the script (an unknown reference, a value that doesn't fit) and record a failure
 * for a check that doesn't hold; `report()` sums it up.
 */
export class CircuitBench {
  readonly #design: Design;
  readonly #resolver: Resolver;
  readonly #registry: ComponentRegistry;
  /** Port bit name → its driver's id. */
  readonly #drivers = new Map<string, string>();
  /** Port bit name → its net id. */
  readonly #portNets = new Map<string, string>();
  readonly #options: BenchOptions;
  readonly #inputs = new Map<string, Input>();
  readonly #outputs = new Map<string, Output>();
  readonly #failures: BenchFailure[] = [];
  #failureCount = 0;
  readonly #logs: BenchLog[] = [];
  readonly #random: SeededRandom;
  #netlist: Netlist;
  #sim: Simulator | undefined;
  #step: Time = DEFAULT_STEP;

  constructor(
    document: CircuitDocument,
    circuitId: string,
    library: ComponentRegistry,
    options: BenchOptions = {},
  ) {
    this.#options = options;
    this.#random = new SeededRandom(options.seed ?? 0);
    const circuit = document.circuits.find((c) => c.id === circuitId);
    if (!circuit) throw new BenchError(`no circuit "${circuitId}"`);
    const design = compileDesign(document, library, { top: circuitId });
    const used = new Set([circuitId, ...design.instances.map((i) => i.circuit)]);
    const errors = design.issues.filter((i) => i.severity === 'error' && used.has(i.circuit));
    if (errors.length > 0) {
      const where = (circuit: string) => document.circuits.find((c) => c.id === circuit)?.name;
      throw new BenchError(
        `${circuit.name} has design errors:\n${errors.map((e) => `  ${where(e.circuit)}: ${e.message}`).join('\n')}`,
      );
    }
    this.#design = design;
    this.#resolver = new Resolver(design, design.registry);
    const registry = design.registry;
    this.#registry = {
      get: (type) => (type === testDriver.type ? testDriver : registry.get(type)),
      has: (type) => type === testDriver.type || registry.has(type),
      list: () => [...registry.list(), testDriver],
    };
    this.#netlist = this.#withDrivers(circuitPorts(circuit, registry));
  }

  /** The simulated time now. */
  get now(): Time {
    return this.#sim?.now ?? 0;
  }

  /** The step a row or a clock pulse takes. */
  get step(): Time {
    return this.#step;
  }

  /** Sets the step: positive, at least 4 ps (a pulse rises at ¼, falls at ¾). */
  setStep(time: unknown): void {
    const step = this.#time(time, 'setStep');
    if (step < 4) throw new BenchError(`setStep: a step of at least 4 ps, got ${step}`);
    this.#step = step;
  }

  /** Inputs now: ports, switches, buttons, DIP switches. */
  set(values: unknown): void {
    for (const [ref, value] of this.#entries(values, 'set')) this.#set(ref, value);
  }

  press(ref: unknown): void {
    this.#button(this.#ref(ref, 'press'), 'press');
  }

  release(ref: unknown): void {
    this.#button(this.#ref(ref, 'release'), 'release');
  }

  /** Any part's action, for parts the bench doesn't operate itself. */
  action(ref: unknown, payload: unknown): void {
    const name = this.#ref(ref, 'action');
    const target = this.#resolver.resolve(name);
    if (typeof target === 'string') throw new BenchError(target);
    if (target.kind !== 'part') throw new BenchError(`${name} is not a part`);
    this.#act(target.part, payload, name);
  }

  /** `count` steps of a clock: each rises at ¼ of the step and falls at ¾. */
  clock(ref: unknown, count: unknown = 1): void {
    const name = this.#ref(ref, 'clock');
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new BenchError(`clock: a count of pulses (0, 1, 2, …), got ${String(count)}`);
    }
    const input = this.#input(name);
    if (input.kind === 'switch' || input.kind === 'dip-switch') {
      throw new BenchError(`${name} is a switch: set it, it has no pulse`);
    }
    for (let i = 0; i < count; i++) this.#steps([], [{ name, input }]);
  }

  /** Time passes, inputs held. */
  wait(time: unknown): void {
    this.#runTo(this.now + this.#time(time, 'wait'));
  }

  /**
   * One step: inputs at its start (`'C'` pulses rise at ¼ and fall at ¾, `'-'` leaves one as it
   * is), outputs checked at its end (`'-'`: not checked).
   */
  row(inputs: unknown, outputs: unknown = {}, note?: string): void {
    const levels: [string, unknown][] = [];
    const pulses: { name: string; input: Input }[] = [];
    for (const [ref, value] of this.#entries(inputs, 'row')) {
      if (value === '-') continue;
      if (value === 'C' || value === 'c') {
        const input = this.#input(ref);
        if (input.kind === 'switch' || input.kind === 'dip-switch') {
          throw new BenchError(`${ref} is a switch: set it, it has no pulse`);
        }
        pulses.push({ name: ref, input });
      } else {
        levels.push([ref, value]);
      }
    }
    const checks = this.#entries(outputs, 'row').filter(([, value]) => value !== '-');
    // Resolve everything before time moves, so a bad reference fails the row as written.
    for (const [ref] of checks) this.#output(ref);
    this.#steps(levels, pulses);
    this.#check(checks, note);
  }

  /** Checks signals and memory cells now; a mismatch is a failure, the bench goes on. */
  expect(values: unknown, note?: unknown): void {
    if (note !== undefined && typeof note !== 'string') {
      throw new BenchError('expect: the note is text');
    }
    this.#check(this.#entries(values, 'expect'), note);
  }

  /**
   * A signal's or memory cell's value now: a number when every bit is known (a BigInt beyond
   * 2⁵³), else the levels as a report writes them (`'X'`, `'Z'`, `'0xX5'`); an array for a range
   * of cells.
   */
  get(ref: unknown): unknown {
    const name = this.#ref(ref, 'get');
    const output = this.#output(name);
    const value = (bits: readonly Level[]) => {
      const known = bitsValue(bits);
      if (known === undefined) return formatLevels(bits);
      return known <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(known) : known;
    };
    if (output.kind === 'cells' && output.to > output.from) {
      return this.#cells(output).map(value);
    }
    return value(this.#levels(output)[0]!);
  }

  /** A failure that ends the bench. */
  fail(message: unknown): never {
    this.#fail({ time: this.now, message: String(message) });
    throw new BenchStop();
  }

  /** A line in the report. */
  log(...parts: unknown[]): void {
    const text = parts.map((p) => (typeof p === 'string' ? p : show(p))).join(' ');
    this.#logs.push({ ...this.#line(), time: this.now, text });
  }

  /** A number in [0, 1) from the bench's seed: the same bench draws the same ones. */
  random(): number {
    return this.#random.nextUint32() / 2 ** 32;
  }

  /** The bench so far; `stopped` is why it ended early, if it did. */
  report(stopped?: { readonly message: string; readonly line?: number }): BenchReport {
    const sim = this.#sim;
    const warnings = sim
      ? sim.diagnostics.entries.filter((d) => diagnosticSeverity(d) === 'warning')
      : [];
    const status: BenchStatus =
      stopped !== undefined ? 'error' : this.#failureCount > 0 ? 'fail' : 'pass';
    return {
      status,
      failures: [...this.#failures],
      failureCount: this.#failureCount,
      ...(stopped && { error: stopped }),
      warnings,
      logs: [...this.#logs],
      time: this.now,
      events: sim?.stats.events ?? 0,
    };
  }

  // ── Simulation ─────────────────────────────────────────────────────────────────────────

  /** The simulator, built at first use: before that a ROM's image may still change. */
  #simulator(): Simulator {
    if (this.#sim) return this.#sim;
    const sim = new Simulator(this.#netlist, this.#registry);
    sim.diagnostics.onOccurrence((d) => {
      if (diagnosticSeverity(d) === 'error')
        this.#fail({ time: d.time, message: diagnosticText(d) });
    });
    this.#sim = sim;
    return sim;
  }

  /** Runs to `time`; a halted simulation ends the bench. */
  #runTo(time: Time): void {
    const sim = this.#simulator();
    const status = sim.runUntil(time);
    if (status === 'halted') {
      throw new BenchError(`the simulation halted at ${formatTime(sim.now)} (see the failures)`);
    }
  }

  /** One step: levels at its start, pulses from ¼ to ¾, to its end. */
  #steps(levels: readonly [string, unknown][], pulses: readonly { name: string; input: Input }[]) {
    const start = this.now;
    for (const [ref, value] of levels) this.#set(ref, value);
    const rise = start + Math.floor(this.#step / 4);
    const fall = start + Math.floor((this.#step * 3) / 4);
    this.#runTo(rise);
    for (const { name, input } of pulses) this.#pulse(name, input, 'rise');
    this.#runTo(fall);
    for (const { name, input } of pulses) this.#pulse(name, input, 'fall');
    this.#runTo(start + this.#step);
  }

  #pulse(name: string, input: Input, edge: 'rise' | 'fall'): void {
    switch (input.kind) {
      case 'port':
        this.#drive(input, [edge === 'rise' ? Level.L1 : Level.L0]);
        return;
      case 'button':
        this.#act(input.part, { type: edge === 'rise' ? 'press' : 'release' }, name);
        return;
      case 'clock':
        if (!input.manual) throw new BenchError(`${name} runs freely: only a manual clock steps`);
        if (edge === 'rise') this.#act(input.part, { type: 'step' }, name);
        return;
      default:
        throw new BenchError(`${name} has no pulse`);
    }
  }

  #set(ref: string, value: unknown): void {
    if (value === 'C' || value === 'c') {
      throw new BenchError(`${ref}: a pulse (C) takes a step: use b.clock or b.row`);
    }
    const input = this.#input(ref);
    switch (input.kind) {
      case 'port':
        this.#drive(input, inputBits(value, input.drivers.length, ref));
        return;
      case 'switch':
        this.#act(input.part, { type: 'set', on: onOff(inputBits(value, 1, ref)[0]!, ref) }, ref);
        return;
      case 'button':
        this.#button(ref, onOff(inputBits(value, 1, ref)[0]!, ref) ? 'press' : 'release');
        return;
      case 'dip-switch': {
        const bits = inputBits(value, input.count, ref);
        bits.forEach((bit, index) => {
          this.#act(input.part, { type: 'set', index, on: onOff(bit, ref) }, ref);
        });
        return;
      }
      case 'clock':
        throw new BenchError(`${ref} is a clock: pulse it with b.clock or C in a row`);
    }
  }

  #button(ref: string, type: 'press' | 'release'): void {
    const input = this.#input(ref);
    if (input.kind !== 'button') throw new BenchError(`${ref} is not a button`);
    this.#act(input.part, { type }, ref);
  }

  #drive(input: { readonly drivers: readonly string[] }, bits: readonly Level[]): void {
    const sim = this.#simulator();
    input.drivers.forEach((driver, i) => {
      sim.action(driver, bits[i] === Level.Z ? Drive.Z : strong(bits[i]!));
    });
  }

  #act(part: string, payload: unknown, ref: string): void {
    try {
      this.#simulator().action(part, payload);
    } catch (error) {
      throw new BenchError(`${ref}: ${(error as Error).message}`);
    }
  }

  // ── Checks ─────────────────────────────────────────────────────────────────────────────

  #check(checks: readonly [string, unknown][], note: string | undefined): void {
    const expected = checks.map(([ref, value]) => {
      const output = this.#output(ref);
      if (output.kind === 'cells' && output.to > output.from) {
        const count = output.to - output.from + 1;
        const values = Array.isArray(value) ? value : undefined;
        if (values?.length !== count) {
          throw new BenchError(`${ref}: expected ${count} values (an array), got ${show(value)}`);
        }
        return { ref, output, bits: values.map((v) => expectedBits(v, output.memory.width, ref)) };
      }
      return { ref, output, bits: [expectedBits(value, this.#width(output), ref)] };
    });
    for (const { ref, output, bits } of expected) {
      const actual = this.#levels(output);
      bits.forEach((want, i) => {
        const got = actual[i]!;
        if (bitsMatch(want, got)) return;
        const name = bits.length > 1 && output.kind === 'cells' ? cellName(ref, output, i) : ref;
        this.#mismatch(name, want, got, note);
      });
    }
  }

  #mismatch(ref: string, want: ExpectedBits, got: readonly Level[], note?: string): void {
    const expected = formatExpected(want);
    const actual = formatLevels(got);
    const message = `${ref} is ${actual}, expected ${expected}${note ? ` (${note})` : ''}`;
    this.#fail({ time: this.now, message, ref, expected, actual });
  }

  #fail(failure: Omit<BenchFailure, 'line'>): void {
    this.#failureCount++;
    const max = this.#options.maxFailures ?? 100;
    if (this.#failures.length < max) this.#failures.push({ ...this.#line(), ...failure });
  }

  #line(): { line?: number } {
    const line = this.#options.line?.();
    return line === undefined ? {} : { line };
  }

  /** The levels of an output now: one value, or one per cell of a range. */
  #levels(output: Output): Level[][] {
    if (output.kind === 'cells') return this.#cells(output);
    const sim = this.#simulator();
    return [output.nets.map((net) => (net === undefined ? Level.Z : (sim.level(net) as Level)))];
  }

  #cells(output: Extract<Output, { kind: 'cells' }>): Level[][] {
    const view = output.memory.view(this.#simulator().stateOf(output.part));
    const rows: Level[][] = [];
    for (let address = output.from; address <= output.to; address++) {
      const data = view.data[address]!;
      const unknown = view.unknown[address]!;
      rows.push(
        Array.from({ length: output.memory.width }, (_, bit) =>
          (unknown >> bit) & 1 ? Level.X : (((data >> bit) & 1) as Level),
        ),
      );
    }
    return rows;
  }

  #width(output: Output): number {
    return output.kind === 'cells' ? output.memory.width : output.nets.length;
  }

  // ── References ─────────────────────────────────────────────────────────────────────────

  #input(ref: string): Input {
    const known = this.#inputs.get(ref);
    if (known) return known;
    const input = this.#findInput(ref);
    this.#inputs.set(ref, input);
    return input;
  }

  #findInput(ref: string): Input {
    const driven = this.#portDrivers(ref);
    if (driven) return { kind: 'port', drivers: driven };
    const target = this.#resolver.resolve(ref);
    if (typeof target === 'string') throw new BenchError(`${ref}: ${target}`);
    const notInput = `${ref} is not an input: drive an input port, a switch, a button or a manual clock`;
    if (target.kind !== 'part') throw new BenchError(notInput);
    const component = this.#netlist.components.find((c) => c.id === target.part);
    const definition = this.#registry.get(target.type);
    if (!component || !definition) throw new BenchError(notInput);
    const props = resolveProps(definition, (component.props ?? {}) as Record<string, PropValue>);
    switch (symbolOf(definition, props)?.kind) {
      case 'switch':
        return { kind: 'switch', part: target.part };
      case 'button':
        return { kind: 'button', part: target.part };
      case 'dip-switch':
        return { kind: 'dip-switch', part: target.part, count: Number(props.count) };
      case 'clock':
        return { kind: 'clock', part: target.part, manual: props.mode === 'manual' };
      default:
        throw new BenchError(notInput);
    }
  }

  /** The drivers of a port, of one of a bus port's bits, or of its bus; else undefined. */
  #portDrivers(ref: string): string[] | undefined {
    const driver = this.#drivers.get(ref);
    if (driver) return [driver];
    if (!ref.includes('[')) return undefined;
    let bits: readonly string[];
    try {
      bits = portBits(ref);
    } catch {
      return undefined;
    }
    const drivers = bits.map((bit) => this.#drivers.get(bit));
    return drivers.every((d) => d !== undefined) ? (drivers as string[]) : undefined;
  }

  #output(ref: string): Output {
    const known = this.#outputs.get(ref);
    if (known) return known;
    const output = this.#findOutput(ref);
    this.#outputs.set(ref, output);
    return output;
  }

  #findOutput(ref: string): Output {
    const sim = this.#simulator();
    const net = this.#portNets.get(ref);
    if (net !== undefined) return { kind: 'nets', nets: [sim.netIndex(net)] };
    const target = this.#resolver.resolve(ref);
    if (typeof target !== 'string' && target.kind === 'cells') {
      const { part, memory, from, to } = target;
      return { kind: 'cells', part, memory, from, to };
    }
    const signal = this.#resolver.signal(ref);
    if (typeof signal === 'string') throw new BenchError(`${ref}: ${signal}`);
    return {
      kind: 'nets',
      nets: signal.nets.map((id) => (id === undefined ? undefined : sim.netIndex(id))),
    };
  }

  /**
   * The netlist with a driver on every bit of every `in` and `bidir` port of the top circuit, on
   * the port's net (a net of its own when nothing inside connects to the port).
   */
  #withDrivers(ports: ReturnType<typeof circuitPorts>): Netlist {
    const netlist = this.#design.netlist;
    const added = new Map<string, string>(); // net id → driver id
    const fresh: NetlistNet[] = [];
    for (const port of ports) {
      if (port.direction === 'out') continue;
      for (const bit of portBits(port.name)) {
        const driver = `${DRIVER}${bit}`;
        const target = this.#resolver.resolve(bit);
        const net = typeof target !== 'string' && target.kind === 'net' ? target.net : undefined;
        this.#drivers.set(bit, driver);
        this.#portNets.set(bit, net ?? bit);
        if (net === undefined) fresh.push({ id: bit, pins: [{ component: driver, pin: 'Y' }] });
        else added.set(net, driver);
      }
    }
    return {
      components: [
        ...netlist.components,
        ...[...this.#drivers.values()].map((id) => ({ id, type: testDriver.type })),
      ],
      nets: [
        ...netlist.nets.map((net) => {
          const driver = added.get(net.id);
          return driver ? { ...net, pins: [...net.pins, { component: driver, pin: 'Y' }] } : net;
        }),
        ...fresh,
      ],
    };
  }

  // ── Arguments ──────────────────────────────────────────────────────────────────────────

  #ref(ref: unknown, call: string): string {
    if (typeof ref !== 'string' || ref.trim() === '') {
      throw new BenchError(`${call}: a reference such as 'CLK' or 'U1.Q', got ${show(ref)}`);
    }
    return ref.trim();
  }

  #entries(values: unknown, call: string): [string, unknown][] {
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      throw new BenchError(
        `${call}: an object such as { CLK: 0, 'D[0..7]': 0x2A }, got ${show(values)}`,
      );
    }
    return Object.entries(values).map(([ref, value]) => [this.#ref(ref, call), value]);
  }

  #time(time: unknown, call: string): Time {
    const value = typeof time === 'string' ? parseTime(time) : time;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new BenchError(`${call}: a time such as us(10) or '10us', got ${show(time)}`);
    }
    return value;
  }
}

/** Whether a level turns a switch on; only 0 and 1 do anything. */
function onOff(level: Level, ref: string): boolean {
  if (level === Level.L0 || level === Level.L1) return level === Level.L1;
  throw new BenchError(`${ref}: a switch is 0 or 1`);
}

/** `U5[10..1F]`'s i-th cell as `U5[12]`. */
function cellName(ref: string, output: { from: number }, i: number): string {
  return `${ref.slice(0, ref.indexOf('['))}[${(output.from + i).toString(16).toUpperCase()}]`;
}

/** A simulation error as a failure says it: `setup-violation U1: …`. */
function diagnosticText(d: DiagnosticInput): string {
  const where = d.component
    ? ` ${d.component}${d.pin ? `.${d.pin}` : ''}`
    : d.net
      ? ` ${d.net}`
      : '';
  return `${d.kind}${where}: ${d.message}`;
}

function show(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'bigint') return `${value}n`;
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
