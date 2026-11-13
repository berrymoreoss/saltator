/**
 * The test runner inside the sandbox (R15b): this module, bundled into one script
 * (`virtual:bench-runner`, scripts/vite-bench-runner.ts), runs in a Worker started from a blob
 * inside an opaque-origin iframe (ui/test-runner.ts). The first message brings a port to the
 * app; requests come on it and every response goes back on it, in order. Spec:
 * docs/editor.md#tests.
 */
import {
  type BenchRequest,
  type BenchResponse,
  type BenchService,
  benchService,
  functionScriptHost,
} from '../circuit';
import { createDefaultRegistry, verilogChips } from '../library';

/** The message that connects the worker to the app: the port comes as its first port. */
export const CONNECT = 'connect';

/** What the worker needs of its global scope. */
export interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: { readonly data: unknown; readonly ports: readonly MessagePort[] }) => void,
  ): void;
}

/**
 * The parts a bench can run: the library's, and in dev builds the library parts written in
 * Verilog (`dev/*-verilog`), as the app's registry has them — or a document with one opened in
 * a dev build would show its parts and fail its benches (feat/hdl-timing).
 */
function benchRegistry() {
  const registry = createDefaultRegistry();
  if (import.meta.env.DEV) registry.register(...verilogChips());
  return registry;
}

/** Finds the line of a syntax error in a script (V8's `new Function` gives none). */
export type SyntaxLine = (source: string) => Promise<number | undefined>;

/**
 * Serves bench requests from the port the first `connect` message brings. Responses keep their
 * order; a syntax error without a line waits for `syntaxLine` to find it.
 */
export function startBenchWorker(
  scope: WorkerScope,
  syntaxLine: SyntaxLine,
  serve: BenchService = benchService(benchRegistry(), functionScriptHost()),
): void {
  scope.addEventListener('message', ({ data, ports }) => {
    const port = ports[0];
    if (data !== CONNECT || !port) return;
    // Responses go out at once — a bench that never ends must not hold up its `started` — unless
    // one before them waits for its syntax error's line.
    let queue: Promise<void> | undefined;
    let waiting = 0;
    const post = (response: BenchResponse) => port.postMessage(response);
    port.onmessage = ({ data: request }: MessageEvent<BenchRequest>) => {
      const sources = new Map<string, string>();
      if (request.kind === 'load') sources.set('', request.source);
      else {
        for (const c of request.document.circuits) sources.set(c.id, c.testScript.join('\n'));
      }
      serve(request, (response) => {
        const located = withSyntaxLine(response, sources, syntaxLine);
        if (!located && waiting === 0) {
          post(response);
          return;
        }
        waiting++;
        const send = located ?? Promise.resolve(response);
        queue = (queue ?? Promise.resolve()).then(() =>
          send.then((r) => {
            waiting--;
            post(r);
          }),
        );
      });
    };
  });
}

/** The response with its syntax error's line found, if it has one without a line. */
function withSyntaxLine(
  response: BenchResponse,
  sources: ReadonlyMap<string, string>,
  syntaxLine: SyntaxLine,
): Promise<BenchResponse> | undefined {
  const error =
    response.kind === 'loaded'
      ? response.script.error
      : response.kind === 'script-error'
        ? response.error
        : undefined;
  if (!error || error.line !== undefined || !error.message.startsWith('SyntaxError')) return;
  const source = sources.get(response.kind === 'script-error' ? response.circuit : '');
  if (source === undefined) return;
  return syntaxLine(source)
    .catch(() => undefined)
    .then((line) => {
      if (line === undefined) return response;
      const located = { ...error, line };
      return response.kind === 'loaded'
        ? { ...response, script: { ...response.script, error: located } }
        : { ...response, error: located };
    });
}

/**
 * A syntax error's line, as a worker of its own reports it: the script parsed (never run) as
 * the body of a function on the same lines, strict as the bench's loader runs it.
 */
export const workerSyntaxLine: SyntaxLine = (source) =>
  new Promise((resolve) => {
    const code = `(function () {'use strict'; ${source}\n}); postMessage(0);`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const checker = new Worker(url);
    const done = (line: number | undefined) => {
      clearTimeout(timer);
      checker.terminate();
      URL.revokeObjectURL(url);
      resolve(line);
    };
    const timer = setTimeout(() => done(undefined), 2000);
    checker.onmessage = () => done(undefined);
    checker.onerror = (event) => {
      event.preventDefault();
      done(event.lineno > 0 ? event.lineno : undefined);
    };
  });
