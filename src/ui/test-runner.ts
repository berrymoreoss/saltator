/**
 * Running test scripts in the app (R15b): a client of the bench service (circuit) running in a
 * sandbox — a Worker inside an opaque-origin iframe whose CSP allows no network
 * (`iframeSandbox`), so a document's script can reach neither the app's storage nor anything
 * outside. The client queues requests, keeps time limits (a script's top level, each bench),
 * restarts the sandbox when one is exceeded or a run is cancelled, and never runs a script in
 * the page. Spec: docs/editor.md#tests; decision: ADR-0026.
 */
import type {
  BenchRequest,
  BenchResponse,
  BenchResult,
  CircuitDocument,
  PlannedBench,
  RunTarget,
  TestScript,
} from '../circuit';

/** A port to a runner in a sandbox. */
export interface RunnerPort {
  postMessage(request: BenchRequest): void;
  onmessage: ((event: { readonly data: BenchResponse }) => void) | null;
  close(): void;
}

/** Where the runner runs. */
export interface Sandbox {
  /**
   * Starts a fresh runner: a port to it, or a rejection saying why it can't start.
   * `onFailure` hears it fail later (a crash in the runner).
   */
  start(onFailure: (message: string) => void): Promise<RunnerPort>;
  /** Ends the runner, whatever it is doing (a loop that never ends included). */
  stop(): void;
}

/** What a run tells as it goes. */
export interface RunListener {
  /** Every bench the run will run, in order. */
  planned?(benches: readonly PlannedBench[]): void;
  /** Bench `index` of the plan starts. */
  started?(index: number, bench: PlannedBench): void;
  result?(circuit: string, result: BenchResult): void;
  /** A circuit's script didn't load: none of its benches run. */
  scriptError?(circuit: string, error: NonNullable<TestScript['error']>): void;
}

/** How a run ended. */
export type RunOutcome =
  | { readonly status: 'done' }
  /** Cancelled: these benches of the plan didn't run (the one running included). */
  | { readonly status: 'cancelled'; readonly notRun: readonly PlannedBench[] }
  /** The sandbox didn't start or failed: nothing more runs. */
  | { readonly status: 'failed'; readonly message: string };

export interface TestRunnerOptions {
  /** How long a script's top level may take (default 5 s). */
  readonly loadTimeout?: number;
  /** How long one bench may take (default 60 s, as the Node host). */
  readonly benchTimeout?: number;
  /** Timers (tests pass fake ones). */
  readonly schedule?: (callback: () => void, ms: number) => () => void;
}

const SECOND = 1000;

/** Formats a time limit for a message: `5 s`, `1.5 s`, `200 ms`. */
function limit(ms: number): string {
  return ms >= SECOND ? `${ms / SECOND} s` : `${ms} ms`;
}

interface Job {
  readonly send: (job: number) => BenchRequest;
  readonly response: (response: BenchResponse) => void;
  /** The runner went away (a time limit, a failure, Cancel): finish with `reason`. */
  readonly abort: (reason: Abort) => void;
  /** The time limit for what it waits for now. */
  readonly timeout: () => number;
}

/** A load: dropped (resolved to undefined) when a newer one comes before it is sent. */
interface LoadJob extends Job {
  readonly load: true;
  readonly drop: () => void;
}

const isLoad = (job: Job): job is LoadJob => 'load' in job;

type Abort =
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'cancelled' };

/**
 * A test runner in a sandbox. Requests are answered one at a time, in order; time limits run
 * from when a request is sent. Use one runner for listing scripts as they are typed and another
 * for runs, so a long run doesn't hold the error marks up.
 */
export class TestRunner {
  readonly #sandbox: Sandbox;
  readonly #loadTimeout: number;
  readonly #benchTimeout: number;
  readonly #schedule: (callback: () => void, ms: number) => () => void;
  #port: Promise<RunnerPort> | undefined;
  #jobs = 0;
  #current: { readonly id: number; readonly job: Job } | undefined;
  #queue: Job[] = [];
  #cancelTimer: (() => void) | undefined;
  #runs = 0;

  constructor(sandbox: Sandbox, options: TestRunnerOptions = {}) {
    this.#sandbox = sandbox;
    this.#loadTimeout = options.loadTimeout ?? 5 * SECOND;
    this.#benchTimeout = options.benchTimeout ?? 60 * SECOND;
    this.#schedule =
      options.schedule ??
      ((callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
      });
  }

  /** True while a run is running or waiting. */
  get running(): boolean {
    return this.#runs > 0;
  }

  /**
   * Loads a script to list its benches (its top level runs in the sandbox). Resolves to
   * undefined when a newer load replaced it before it was sent.
   */
  load(source: string): Promise<TestScript | undefined> {
    return new Promise((resolve) => {
      // A load still waiting is dropped for this one: only the newest text matters.
      const index = this.#queue.findIndex(isLoad);
      if (index >= 0) (this.#queue[index] as LoadJob).drop();
      let settled = false;
      const finish = (script: TestScript) => {
        if (settled) return;
        settled = true;
        resolve(script);
      };
      const job: LoadJob = {
        load: true,
        drop: () => resolve(undefined),
        send: (id) => ({ kind: 'load', job: id, source }),
        response: (response) => {
          if (response.kind === 'loaded') finish(response.script);
        },
        abort: (reason) =>
          finish({
            benches: [],
            error: {
              message:
                reason.kind === 'timeout'
                  ? `the script's top level didn't finish within ${limit(this.#loadTimeout)}`
                  : reason.kind === 'failed'
                    ? reason.message
                    : 'cancelled',
            },
          }),
        timeout: () => this.#loadTimeout,
      };
      if (index >= 0) this.#queue.splice(index, 1, job);
      else this.#queue.push(job);
      this.#next();
    });
  }

  /** Runs benches of a document's circuits; `listener` hears the plan, each start and result. */
  run(
    document: CircuitDocument,
    targets: readonly RunTarget[],
    listener: RunListener = {},
  ): Promise<RunOutcome> {
    this.#runs++;
    return new Promise<RunOutcome>((resolve) => {
      let plan: readonly PlannedBench[] | undefined;
      /** Where the request sent last starts in the plan (after a bench timed out). */
      let offset = 0;
      /** The bench running, as an index into the plan. */
      let index: number | undefined;
      let next = 0;
      const finish = (outcome: RunOutcome) => {
        this.#runs--;
        resolve(outcome);
      };
      const job: Job = {
        send: (id) => {
          if (!plan) return { kind: 'run', job: id, document, targets };
          return { kind: 'run', job: id, document, targets: targetsOf(plan.slice(next)) };
        },
        response: (response) => {
          switch (response.kind) {
            case 'planned':
              if (!plan) {
                plan = response.benches;
                listener.planned?.(plan);
              }
              break;
            case 'script-error':
              if (offset === 0) listener.scriptError?.(response.circuit, response.error);
              break;
            case 'started':
              index = offset + response.index;
              listener.started?.(index, plan![index]!);
              break;
            case 'result':
              listener.result?.(response.circuit, response.result);
              next = (index ?? next) + 1;
              index = undefined;
              break;
            case 'done':
              finish({ status: 'done' });
              break;
            default:
              break;
          }
        },
        abort: (reason) => {
          if (reason.kind === 'timeout' && plan && index !== undefined) {
            const bench = plan[index]!;
            listener.result?.(bench.circuit, timedOut(bench, this.#benchTimeout));
            next = index + 1;
            index = undefined;
            if (next < plan.length) {
              // The rest of the plan in a fresh sandbox.
              offset = next;
              this.#queue.unshift(job);
              return;
            }
            finish({ status: 'done' });
            return;
          }
          if (reason.kind === 'timeout') {
            // A script's top level that never ends, before the plan: the run can't go on.
            finish({
              status: 'failed',
              message: `a script's top level didn't finish within ${limit(this.#loadTimeout)}`,
            });
            return;
          }
          if (reason.kind === 'failed') finish({ status: 'failed', message: reason.message });
          else finish({ status: 'cancelled', notRun: plan ? plan.slice(index ?? next) : [] });
        },
        timeout: () =>
          plan ? this.#benchTimeout : this.#loadTimeout * Math.max(1, targets.length),
      };
      this.#queue.push(job);
      this.#next();
    });
  }

  /** Cancels the runs running or waiting; loads go on in a fresh sandbox. */
  cancel(): void {
    const runs = this.#queue.filter((j) => !isLoad(j));
    this.#queue = this.#queue.filter(isLoad);
    for (const job of runs) job.abort({ kind: 'cancelled' });
    const current = this.#current;
    if (current && !isLoad(current.job)) {
      this.#current = undefined;
      this.#stop();
      current.job.abort({ kind: 'cancelled' });
      this.#next();
    }
  }

  /** Ends the sandbox and everything waiting (as cancelled). */
  dispose(): void {
    this.cancel();
    for (const job of this.#queue.splice(0)) job.abort({ kind: 'cancelled' });
    const current = this.#current;
    this.#current = undefined;
    this.#stop();
    current?.job.abort({ kind: 'cancelled' });
  }

  #next(): void {
    if (this.#current) return;
    const job = this.#queue.shift();
    if (!job) return;
    const id = ++this.#jobs;
    this.#current = { id, job };
    this.#port ??= this.#sandbox.start((message) => this.#failed(message));
    this.#port.then(
      (p) => {
        if (this.#current?.id !== id) return;
        p.onmessage = ({ data }) => this.#response(data);
        this.#arm();
        p.postMessage(job.send(id));
      },
      (error: unknown) => {
        if (this.#current?.id !== id) return;
        this.#failed(`the test sandbox didn't start: ${messageOf(error)}`);
      },
    );
  }

  #response(response: BenchResponse): void {
    const current = this.#current;
    if (!current || response.job !== current.id) return;
    current.job.response(response);
    if (response.kind === 'done') {
      this.#disarm();
      this.#current = undefined;
      this.#next();
    } else {
      this.#arm();
    }
  }

  /** (Re)starts the time limit of what the job waits for now. */
  #arm(): void {
    this.#disarm();
    const current = this.#current;
    if (!current) return;
    this.#cancelTimer = this.#schedule(() => {
      if (this.#current !== current) return;
      this.#current = undefined;
      this.#stop();
      current.job.abort({ kind: 'timeout' });
      this.#next();
    }, current.job.timeout());
  }

  #disarm(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
  }

  #failed(message: string): void {
    const current = this.#current;
    this.#current = undefined;
    this.#stop();
    current?.job.abort({ kind: 'failed', message });
    this.#next();
  }

  #stop(): void {
    this.#disarm();
    const port = this.#port;
    this.#port = undefined;
    if (!port) return;
    port.then(
      (p) => p.close(),
      () => undefined,
    );
    this.#sandbox.stop();
  }
}

/** The plan's benches as run targets, consecutive ones of a circuit together. */
function targetsOf(plan: readonly PlannedBench[]): RunTarget[] {
  const targets: { circuit: string; benches: string[] }[] = [];
  for (const { circuit, bench } of plan) {
    const last = targets.at(-1);
    if (last?.circuit === circuit) last.benches.push(bench);
    else targets.push({ circuit, benches: [bench] });
  }
  return targets;
}

function timedOut(bench: PlannedBench, ms: number): BenchResult {
  const line = bench.line === undefined ? {} : { line: bench.line };
  return {
    name: bench.bench,
    ...line,
    status: 'error',
    failures: [],
    failureCount: 0,
    error: { message: `the bench didn't finish within ${limit(ms)}: stopped`, ...line },
    warnings: [],
    logs: [],
    time: 0,
    events: 0,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── The browser sandbox ──────────────────────────────────────────────────────────────────────

/**
 * The sandbox's policy: nothing from the network, scripts only inline (its bootstrap) and from
 * blobs (the runner), `eval` for the script host's `new Function`. A worker started from a blob
 * inherits it.
 */
export const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:";

/** The message that connects the runner to its port (src/app/bench-worker.ts). */
const CONNECT = 'connect';

/** The iframe's page: takes the runner's text and a port, starts the runner, hands it the port. */
const SANDBOX_PAGE = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
<script>
addEventListener('message', (event) => {
  if (event.source !== parent) return;
  const port = event.ports[0];
  const source = event.data && event.data.source;
  if (!port || typeof source !== 'string') return;
  const fail = (message) => parent.postMessage({ kind: 'sandbox-error', message: String(message) }, '*');
  try {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onerror = (e) => { e.preventDefault(); fail(e.message || 'the test runner failed'); };
    worker.postMessage(${JSON.stringify(CONNECT)}, [port]);
    parent.postMessage({ kind: 'sandbox-ready' }, '*');
  } catch (error) {
    fail(error && error.message ? error.message : error);
  }
}, { once: true });
</script>`;

/**
 * The sandbox in a browser: a hidden `<iframe sandbox="allow-scripts">` (an opaque origin: no
 * cookies, storage or IndexedDB of the app's) under `SANDBOX_CSP` (no network), starting the
 * runner bundle — `source()`, its text — in a Worker. Stopping removes the iframe, which ends
 * the worker with it.
 */
export function iframeSandbox(
  source: () => Promise<string>,
  host: () => HTMLElement = () => document.body,
): Sandbox {
  let frame: HTMLIFrameElement | undefined;
  let listener: ((event: MessageEvent) => void) | undefined;
  const stop = () => {
    if (listener) window.removeEventListener('message', listener);
    listener = undefined;
    frame?.remove();
    frame = undefined;
  };
  return {
    async start(onFailure) {
      stop();
      const code = await source();
      const iframe = window.document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.title = 'Test sandbox';
      iframe.tabIndex = -1;
      iframe.hidden = true;
      iframe.srcdoc = SANDBOX_PAGE;
      frame = iframe;
      const loaded = new Promise<void>((resolve) => {
        iframe.addEventListener('load', () => resolve(), { once: true });
      });
      host().append(iframe);
      await loaded;
      if (frame !== iframe || !iframe.contentWindow) throw new Error('stopped');
      const channel = new MessageChannel();
      const ready = new Promise<void>((resolve, reject) => {
        listener = (event: MessageEvent) => {
          if (event.source !== iframe.contentWindow) return;
          const data = event.data as { kind?: unknown; message?: unknown } | null;
          if (data?.kind === 'sandbox-ready') resolve();
          else if (data?.kind === 'sandbox-error') {
            const message = String(data.message);
            reject(new Error(message));
            onFailure(`the test runner failed: ${message}`);
          }
        };
        window.addEventListener('message', listener);
      });
      // The iframe's origin is opaque: no origin to name, but the window is the one just made.
      iframe.contentWindow.postMessage({ source: code }, '*', [channel.port2]);
      await ready;
      return channel.port1 as unknown as RunnerPort;
    },
    stop,
  };
}
