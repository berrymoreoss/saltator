/**
 * Test scripts (R15a): a circuit's JavaScript registering benches with `bench(name, fn)`, each
 * run on a fresh `CircuitBench` through the API object `b`. The text becomes code only in a
 * `ScriptHost` — a Node `vm` context, later a browser sandbox (R15b) — so this layer stays pure.
 * Spec: docs/circuit.md#test-benches.
 */
import { type ComponentRegistry, hashString, ms, ns, ps, us } from '../../core';
import type { CircuitDocument } from '../document';
import { type BenchReport, BenchStop, CircuitBench } from './bench';
import { BenchError } from './values';

/**
 * Where a script's text runs. Each `load` is a fresh scope (one per bench run, so benches can't
 * leak state into each other); `call` runs a function the script made within the host's limits
 * (a time limit); `line` finds the script's line in a stack — of an error, or of the code
 * running now.
 */
export interface ScriptHost {
  /** Runs the script's top level with `globals` in scope. Throws what it throws. */
  load(source: string, globals: Readonly<Record<string, unknown>>): void;
  /** Calls `fn` (a function of the script) with `args`. Throws what it throws. */
  call(fn: unknown, args: readonly unknown[]): unknown;
  /** The script line of an error's stack, or of the code running now; undefined if unknown. */
  line(error?: unknown): number | undefined;
}

/** A bench a script registers. */
export interface BenchEntry {
  readonly name: string;
  /** The line of its `bench(…)` call. */
  readonly line?: number;
}

/** What a script registers, or why it didn't load. */
export interface TestScript {
  readonly benches: readonly BenchEntry[];
  /** A syntax error, an exception at its top level, a bad `bench(…)` call. */
  readonly error?: { readonly message: string; readonly line?: number };
}

/** A bench's report with its name and where the script registers it. */
export type BenchResult = BenchReport & { readonly name: string; readonly line?: number };

export interface RunOptions {
  /** Failures kept per bench (default 100). */
  readonly maxFailures?: number;
}

/** The time helpers a script sees, in picoseconds as core's: `us(1)` is 1 000 000. */
const TIME_HELPERS = { ps, ns, us, ms, s: (n: number) => ms(n * 1000) } as const;

/** The source of a circuit's test script (its lines joined). */
export function scriptSource(document: CircuitDocument, circuitId: string): string {
  const circuit = document.circuits.find((c) => c.id === circuitId);
  if (!circuit) throw new BenchError(`no circuit "${circuitId}"`);
  return circuit.testScript.join('\n');
}

/** Loads a script to list its benches (the functions are dropped). */
export function loadTestScript(source: string, host: ScriptHost): TestScript {
  const { benches, error } = register(source, host);
  return {
    benches: benches.map(({ name, line }) => (line === undefined ? { name } : { name, line })),
    ...(error && { error }),
  };
}

/**
 * Runs the bench `name` of the circuit's test script: the script loaded afresh, the bench on a
 * new simulation. Never throws for the script's sake: what goes wrong is the report's `error`.
 */
export function runBench(
  document: CircuitDocument,
  circuitId: string,
  name: string,
  library: ComponentRegistry,
  host: ScriptHost,
  options: RunOptions = {},
): BenchResult {
  let source: string;
  try {
    source = scriptSource(document, circuitId);
  } catch (error) {
    return failed(name, undefined, { message: messageOf(error) });
  }
  const script = register(source, host);
  if (script.error) return failed(name, undefined, script.error);
  const entry = script.benches.find((b) => b.name === name);
  if (!entry) return failed(name, undefined, { message: `no bench "${name}" in the script` });
  let bench: CircuitBench;
  try {
    bench = new CircuitBench(document, circuitId, library, {
      line: () => host.line(),
      seed: hashString(name),
      ...(options.maxFailures !== undefined && { maxFailures: options.maxFailures }),
    });
  } catch (error) {
    return failed(name, entry.line, { message: messageOf(error), ...at(entry.line) });
  }
  const where = at(entry.line);
  try {
    const result = host.call(entry.fn, [benchApi(bench)]);
    if (isThenable(result)) {
      return {
        ...bench.report({
          message: 'benches are synchronous: no async function, nothing to await',
          ...where,
        }),
        name,
        ...where,
      };
    }
    return { ...bench.report(), name, ...where };
  } catch (error) {
    if (error instanceof BenchStop) return { ...bench.report(), name, ...where };
    const line =
      error instanceof BenchError && error.line !== undefined ? error.line : host.line(error);
    return { ...bench.report({ message: messageOf(error), ...at(line) }), name, ...where };
  }
}

/** Every bench of the circuit's test script, in order; or why the script didn't load. */
export function runTestScript(
  document: CircuitDocument,
  circuitId: string,
  library: ComponentRegistry,
  host: ScriptHost,
  options: RunOptions = {},
): { readonly error?: TestScript['error']; readonly results: readonly BenchResult[] } {
  const script = loadTestScript(scriptSource(document, circuitId), host);
  if (script.error) return { error: script.error, results: [] };
  return {
    results: script.benches.map((b) =>
      runBench(document, circuitId, b.name, library, host, options),
    ),
  };
}

/**
 * The object a bench function gets as `b`: the bench's calls, bound, and its time; frozen, so a
 * script can't reach the bench itself.
 */
export function benchApi(bench: CircuitBench): Readonly<Record<string, unknown>> {
  return Object.freeze({
    set: (values: unknown) => bench.set(values),
    press: (ref: unknown) => bench.press(ref),
    release: (ref: unknown) => bench.release(ref),
    action: (ref: unknown, payload: unknown) => bench.action(ref, payload),
    clock: (ref: unknown, count?: unknown) => bench.clock(ref, count),
    wait: (time: unknown) => bench.wait(time),
    row: (inputs: unknown, outputs?: unknown, note?: unknown) =>
      bench.row(inputs, outputs, typeof note === 'string' ? note : undefined),
    table: (strings: unknown, ...values: unknown[]) => bench.table(strings, ...values),
    expect: (values: unknown, note?: unknown) => bench.expect(values, note),
    get: (ref: unknown) => bench.get(ref),
    memory: (ref: unknown, address: unknown, bytes: unknown) => bench.memory(ref, address, bytes),
    loadIntelHex: (ref: unknown, text: unknown) => bench.loadIntelHex(ref, text),
    setStep: (time: unknown) => bench.setStep(time),
    random: () => bench.random(),
    log: (...parts: unknown[]) => bench.log(...parts),
    fail: (message: unknown) => bench.fail(message),
    get now() {
      return bench.now;
    },
    get step() {
      return bench.step;
    },
  });
}

// ── Registration ───────────────────────────────────────────────────────────────────────────

interface Registered {
  readonly benches: (BenchEntry & { readonly fn: unknown })[];
  readonly error?: { readonly message: string; readonly line?: number };
}

/** Runs the script's top level, collecting its `bench(name, fn)` calls. */
function register(source: string, host: ScriptHost): Registered {
  const benches: (BenchEntry & { fn: unknown })[] = [];
  const bench = (name: unknown, fn: unknown) => {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new BenchError('bench(name, fn): the name is text, such as "counts to 9"');
    }
    if (typeof fn !== 'function')
      throw new BenchError(`bench "${name}": the second argument is a function (b) => { … }`);
    const line = host.line();
    const twice = benches.find((b) => b.name === name);
    if (twice) {
      throw new BenchError(
        `bench "${name}" is there twice${twice.line === undefined ? '' : ` (line ${twice.line})`}`,
      );
    }
    benches.push({ name, fn, ...at(line) });
  };
  try {
    // Strict mode: a typo assigns no global, writing to `b` throws. Same line, so lines hold.
    host.load(`'use strict'; ${source}`, { bench, ...TIME_HELPERS });
  } catch (error) {
    return { benches: [], error: { message: messageOf(error), ...at(host.line(error)) } };
  }
  return { benches };
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────

function failed(
  name: string,
  line: number | undefined,
  error: { readonly message: string; readonly line?: number },
): BenchResult {
  return {
    name,
    ...at(line),
    status: 'error',
    failures: [],
    failureCount: 0,
    error,
    warnings: [],
    logs: [],
    time: 0,
    events: 0,
  };
}

const at = (line: number | undefined) => (line === undefined ? {} : { line });

/**
 * What went wrong, said plainly: a bench's own mistakes as they are, the script's exceptions
 * with their kind (`TypeError: b.sett is not a function`). Errors may come from another realm
 * (a `vm` context), so nothing here uses `instanceof Error`.
 */
function messageOf(error: unknown): string {
  if (error instanceof BenchError) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    const text = String(message);
    return typeof name === 'string' && name !== 'Error' && name !== '' ? `${name}: ${text}` : text;
  }
  return `the script threw ${String(error)}`;
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
