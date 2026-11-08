/**
 * The bench service (R15b): what a test runner does, as requests and responses, so the app can
 * run it wherever the script's code may run — a Worker inside its sandbox — and talk to it by
 * messages. Pure and synchronous: `serve` answers a request through `reply`, one response at a
 * time, the last one `done`. Spec: docs/circuit.md#test-benches.
 */
import type { ComponentRegistry } from '../../core';
import type { CircuitDocument } from '../document';
import {
  type BenchResult,
  loadTestScript,
  type RunOptions,
  runBench,
  type ScriptHost,
  scriptSource,
  type TestScript,
} from './script';

/** A bench a run will run: its circuit, its name, the line of its `bench(…)` call. */
export interface PlannedBench {
  readonly circuit: string;
  readonly bench: string;
  readonly line?: number;
}

/** The benches of one circuit to run: all of them, or these by name. */
export interface RunTarget {
  readonly circuit: string;
  readonly benches?: readonly string[];
}

/** What a runner is asked; `job` comes back on every response to it. */
export type BenchRequest =
  /** Load a script to list its benches, or say why it doesn't load. */
  | { readonly kind: 'load'; readonly job: number; readonly source: string }
  /** Run benches of circuits of a document, in order. */
  | {
      readonly kind: 'run';
      readonly job: number;
      readonly document: CircuitDocument;
      readonly targets: readonly RunTarget[];
    };

/** What a runner answers. */
export type BenchResponse =
  | { readonly kind: 'loaded'; readonly job: number; readonly script: TestScript }
  /** A run's plan: every bench it will run, in order (a circuit's script error has none). */
  | {
      readonly kind: 'planned';
      readonly job: number;
      readonly benches: readonly PlannedBench[];
    }
  /** The bench `index` of the plan starts now. */
  | { readonly kind: 'started'; readonly job: number; readonly index: number }
  | {
      readonly kind: 'result';
      readonly job: number;
      readonly circuit: string;
      readonly result: BenchResult;
    }
  /** A circuit's script didn't load (or there is no such circuit): none of its benches run. */
  | {
      readonly kind: 'script-error';
      readonly job: number;
      readonly circuit: string;
      readonly error: NonNullable<TestScript['error']>;
    }
  /** The last response to a request. */
  | { readonly kind: 'done'; readonly job: number };

/** A runner: answers each request through `reply`, ending with `done`. */
export type BenchService = (
  request: BenchRequest,
  reply: (response: BenchResponse) => void,
) => void;

/** The bench service on `library` (the parts; a document's circuits are added per run). */
export function benchService(
  library: ComponentRegistry,
  host: ScriptHost,
  options: RunOptions = {},
): BenchService {
  return (request, reply) => {
    const { job } = request;
    try {
      if (request.kind === 'load') {
        reply({ kind: 'loaded', job, script: loadTestScript(request.source, host) });
      } else {
        run(job, request.document, request.targets, { library, host, options }, reply);
      }
    } finally {
      reply({ kind: 'done', job });
    }
  };
}

function run(
  job: number,
  document: CircuitDocument,
  targets: readonly RunTarget[],
  { library, host, options }: { library: ComponentRegistry; host: ScriptHost; options: RunOptions },
  reply: (response: BenchResponse) => void,
): void {
  // Each script loaded once to plan the run (its benches, or its error); each bench loads it
  // afresh when it runs, as `runBench` does.
  const plan: PlannedBench[] = [];
  const errors = new Map<string, NonNullable<TestScript['error']>>();
  for (const { circuit, benches } of targets) {
    let script: TestScript;
    try {
      script = loadTestScript(scriptSource(document, circuit), host);
    } catch (error) {
      errors.set(circuit, { message: (error as Error).message });
      continue;
    }
    if (script.error) {
      errors.set(circuit, script.error);
      continue;
    }
    // Benches asked for by name run even when the script lost them: they report the error.
    for (const bench of benches ?? script.benches.map((b) => b.name)) {
      const line = script.benches.find((b) => b.name === bench)?.line;
      plan.push({ circuit, bench, ...(line !== undefined && { line }) });
    }
  }
  reply({ kind: 'planned', job, benches: plan });
  for (const [circuit, error] of errors) reply({ kind: 'script-error', job, circuit, error });
  plan.forEach(({ circuit, bench }, index) => {
    reply({ kind: 'started', job, index });
    const result = runBench(document, circuit, bench, library, host, options);
    reply({ kind: 'result', job, circuit, result });
  });
}
