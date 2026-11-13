import { benchRunnerSource } from 'virtual:bench-runner';
import { afterEach, describe, expect, it } from 'vitest';
import type { BenchRequest, BenchResponse, CircuitDocument } from '../circuit';
import { CONNECT, type SyntaxLine, startBenchWorker, type WorkerScope } from './bench-worker';
import { exampleDocument } from './example-files';

type Listener = Parameters<WorkerScope['addEventListener']>[1];

const open: MessagePort[] = [];
afterEach(() => {
  for (const port of open.splice(0)) port.close();
});

/** A worker started by `start` on a fake scope, connected to a port of a real channel. */
function connect(start: (scope: WorkerScope) => void) {
  let listener: Listener | undefined;
  start({ addEventListener: (_type, l) => (listener = l) });
  const channel = new MessageChannel();
  open.push(channel.port1, channel.port2);
  listener!({ data: CONNECT, ports: [channel.port2] });
  /** Every response to `request`, up to its `done`. */
  const ask = (request: BenchRequest) =>
    new Promise<BenchResponse[]>((resolve) => {
      const replies: BenchResponse[] = [];
      channel.port1.onmessage = ({ data }: MessageEvent<BenchResponse>) => {
        if (data.job !== request.job) return;
        replies.push(data);
        if (data.kind === 'done') resolve(replies);
      };
      channel.port1.postMessage(request);
    });
  return ask;
}

const ramByHand = (): CircuitDocument => exampleDocument('ram-by-hand');
const noLine: SyntaxLine = () => Promise.resolve(undefined);

describe('startBenchWorker', () => {
  it('serves the requests of the port it is connected to', async () => {
    const ask = connect((scope) => startBenchWorker(scope, noLine));
    const replies = await ask({
      kind: 'run',
      job: 1,
      document: ramByHand(),
      targets: [{ circuit: 'main' }],
    });
    expect(replies.flatMap((r) => (r.kind === 'result' ? [r.result.status] : []))).toEqual([
      'pass',
      'pass',
    ]);
  });

  it('runs a document with a Verilog dev part in dev builds, as the app shows it (feat/hdl-timing)', async () => {
    expect(import.meta.env.DEV).toBe(true); // vitest, like `pnpm dev`
    // The 6502 example with its address decoder's 74HC00 written in Verilog (HDL-2).
    const document = exampleDocument('6502-rom-ram');
    const verilog: CircuitDocument = {
      ...document,
      circuits: document.circuits.map((c) => ({
        ...c,
        components: c.components.map((part) =>
          part.type === '74xx/74hc00' ? { ...part, type: 'dev/74hc00-verilog' } : part,
        ),
      })),
    };
    expect(JSON.stringify(verilog)).toContain('dev/74hc00-verilog');
    const ask = connect((scope) => startBenchWorker(scope, noLine));
    const replies = await ask({
      kind: 'run',
      job: 1,
      document: verilog,
      targets: [{ circuit: 'main' }],
    });
    expect(replies.flatMap((r) => (r.kind === 'result' ? [r.result.status] : []))).toEqual([
      'pass',
    ]);
  });

  it('finds a syntax error’s line, keeping the responses in order', async () => {
    const lines: string[] = [];
    // Slow on purpose: what comes after the error must still come after it.
    const syntaxLine: SyntaxLine = (source) => {
      lines.push(source);
      return new Promise((resolve) => setTimeout(() => resolve(2), 20));
    };
    const ask = connect((scope) => startBenchWorker(scope, syntaxLine));
    const loaded = await ask({
      kind: 'load',
      job: 1,
      source: "bench('a', (b) => {});\nconst x = ;",
    });
    expect(loaded[0]).toMatchObject({
      kind: 'loaded',
      script: { error: { message: expect.stringMatching(/^SyntaxError/), line: 2 } },
    });
    const document = ramByHand();
    const broken: CircuitDocument = {
      ...document,
      circuits: [{ ...document.circuits[0]!, testScript: ['', 'bench('] }],
    };
    const replies = await ask({
      kind: 'run',
      job: 2,
      document: broken,
      targets: [{ circuit: 'main' }],
    });
    expect(replies.map((r) => r.kind)).toEqual(['planned', 'script-error', 'done']);
    expect(replies[1]).toMatchObject({ circuit: 'main', error: { line: 2 } });
    expect(lines).toEqual(["bench('a', (b) => {});\nconst x = ;", '\nbench(']);
  });

  it('posts each response at once: a bench that never ends doesn’t hold up its start', () => {
    let listener: Listener | undefined;
    const posted: string[] = [];
    const port = { postMessage: (r: BenchResponse) => posted.push(r.kind), onmessage: null };
    const seen: string[][] = [];
    startBenchWorker(
      { addEventListener: (_type, l) => (listener = l) },
      noLine,
      (request, reply) => {
        reply({ kind: 'planned', job: request.job, benches: [] });
        reply({ kind: 'started', job: request.job, index: 0 });
        seen.push([...posted]); // the bench would run here, maybe for ever
        reply({ kind: 'done', job: request.job });
      },
    );
    listener!({ data: CONNECT, ports: [port as unknown as MessagePort] });
    (port.onmessage as unknown as (e: { data: BenchRequest }) => void)({
      data: { kind: 'load', job: 1, source: '' },
    });
    expect(seen).toEqual([['planned', 'started']]);
    expect(posted).toEqual(['planned', 'started', 'done']);
  });

  it('ignores messages before it is connected and other than connect', () => {
    let listener: Listener | undefined;
    startBenchWorker({ addEventListener: (_type, l) => (listener = l) }, noLine);
    const channel = new MessageChannel();
    open.push(channel.port1, channel.port2);
    listener!({ data: 'hello', ports: [channel.port2] });
    expect(channel.port2.onmessage).toBeNull();
  });
});

describe('the runner bundle', () => {
  it('is one script that runs the benches of a document as a worker would', async () => {
    expect(benchRunnerSource).not.toMatch(/^\s*import\s/m); // self-contained: no imports
    const ask = connect((scope) => new Function('self', benchRunnerSource)(scope));
    const replies = await ask({
      kind: 'run',
      job: 3,
      document: ramByHand(),
      targets: [{ circuit: 'main' }],
    });
    expect(replies.flatMap((r) => (r.kind === 'result' ? [r.result.name] : []))).toEqual([
      'reads what was loaded before power-on',
      'stores DATA at ADDRESS on WRITE in PROGRAM mode',
    ]);
  });
});
