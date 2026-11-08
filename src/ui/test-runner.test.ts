import { describe, expect, it } from 'vitest';
import {
  type BenchRequest,
  type BenchResponse,
  type BenchResult,
  benchService,
  type CircuitDocument,
  emptyDocument,
  functionScriptHost,
  type PlannedBench,
} from '../circuit';
import { createDefaultRegistry } from '../library';
import { type RunListener, type RunnerPort, type Sandbox, TestRunner } from './test-runner';

const serve = benchService(createDefaultRegistry(), functionScriptHost());

/**
 * A sandbox in this realm: the bench service answering asynchronously, as a worker would. A
 * bench whose name has "hangs" never ends (nothing more comes), nor does a script with HANG at
 * its top level; `fail` makes starting fail.
 */
function fakeSandbox(options: { fail?: string } = {}) {
  const stats = { starts: 0, stops: 0, requests: [] as BenchRequest[] };
  let crash: ((message: string) => void) | undefined;
  const sandbox: Sandbox = {
    async start(onFailure) {
      stats.starts++;
      if (options.fail) throw new Error(options.fail);
      crash = onFailure;
      let closed = false;
      const port: RunnerPort = {
        onmessage: null,
        postMessage(request) {
          stats.requests.push(request);
          if (request.kind === 'load' && request.source.includes('HANG')) return;
          const replies: BenchResponse[] = [];
          serve(request, (r) => replies.push(r));
          let hung = false;
          const deliver = () => {
            const reply = replies.shift();
            if (!reply || closed || hung) return;
            port.onmessage?.({ data: reply });
            if (reply.kind === 'started' && request.kind === 'run') {
              if (benchAt(request, reply.index)?.includes('hangs')) hung = true;
            }
            queueMicrotask(deliver);
          };
          queueMicrotask(deliver);
        },
        close() {
          closed = true;
        },
      };
      return port;
    },
    stop() {
      stats.stops++;
    },
  };
  return { sandbox, stats, crash: (message: string) => crash?.(message) };
}

/** The name of bench `index` a run request will run (its benches by name, or the plan's). */
function benchAt(request: BenchRequest & { kind: 'run' }, index: number): string | undefined {
  const names: string[] = [];
  serve(request, (r) => {
    if (r.kind === 'planned') names.push(...r.benches.map((b) => b.bench));
  });
  return names[index];
}

/** Timers run by hand. */
function fakeTimers() {
  let now = 0;
  const timers: { at: number; callback: () => void; live: boolean }[] = [];
  return {
    schedule: (callback: () => void, ms: number) => {
      const timer = { at: now + ms, callback, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers.splice(0)) {
        if (!timer.live) continue;
        if (timer.at <= now) timer.callback();
        else timers.push(timer);
      }
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function withScript(script: string): CircuitDocument {
  const document = emptyDocument();
  return {
    ...document,
    circuits: [{ ...document.circuits[0]!, testScript: script.split('\n') }],
  };
}

/** A listener recording what a run tells. */
function recorder() {
  const heard = {
    planned: [] as PlannedBench[],
    started: [] as number[],
    results: [] as [string, BenchResult['status'], string | undefined][],
    errors: [] as string[],
  };
  const listener: RunListener = {
    planned: (benches) => heard.planned.push(...benches),
    started: (index) => heard.started.push(index),
    result: (_circuit, r) => heard.results.push([r.name, r.status, r.error?.message]),
    scriptError: (circuit, error) => heard.errors.push(`${circuit}: ${error.message}`),
  };
  return { heard, listener };
}

const PASS = "bench('passes', (b) => b.wait('1us'));";

describe('TestRunner', () => {
  it('lists a script’s benches in the sandbox, started once', async () => {
    const { sandbox, stats } = fakeSandbox();
    const runner = new TestRunner(sandbox);
    expect(await runner.load(PASS)).toEqual({ benches: [{ name: 'passes', line: 1 }] });
    expect(await runner.load('nope();')).toMatchObject({ error: { line: 1 } });
    expect(stats.starts).toBe(1);
  });

  it('drops a waiting load for a newer one', async () => {
    const { sandbox, stats } = fakeSandbox();
    const runner = new TestRunner(sandbox);
    const first = runner.load(PASS);
    const second = runner.load('// two');
    const third = runner.load('// three');
    expect(await first).toBeDefined(); // sent at once
    expect(await second).toBeUndefined();
    expect(await third).toEqual({ benches: [] });
    expect(stats.requests).toHaveLength(2);
  });

  it('runs benches, telling the plan, each start and each result', async () => {
    const { sandbox } = fakeSandbox();
    const runner = new TestRunner(sandbox);
    const { heard, listener } = recorder();
    const run = runner.run(withScript(PASS), [{ circuit: 'main' }], listener);
    expect(runner.running).toBe(true);
    expect(await run).toEqual({ status: 'done' });
    expect(runner.running).toBe(false);
    expect(heard).toEqual({
      planned: [{ circuit: 'main', bench: 'passes', line: 1 }],
      started: [0],
      results: [['passes', 'pass', undefined]],
      errors: [],
    });
  });

  it('stops a bench at the time limit and runs the rest in a fresh sandbox', async () => {
    const { sandbox, stats } = fakeSandbox();
    const timers = fakeTimers();
    const runner = new TestRunner(sandbox, { benchTimeout: 1000, schedule: timers.schedule });
    const { heard, listener } = recorder();
    const script = [PASS, "bench('hangs', (b) => {});", "bench('after', (b) => {});"].join('\n');
    const run = runner.run(withScript(script), [{ circuit: 'main' }], listener);
    await settle();
    expect(heard.started).toEqual([0, 1]);
    timers.advance(999);
    await settle();
    expect(heard.results).toHaveLength(1);
    timers.advance(1);
    expect(await run).toEqual({ status: 'done' });
    expect(heard.results).toEqual([
      ['passes', 'pass', undefined],
      ['hangs', 'error', "the bench didn't finish within 1 s: stopped"],
      ['after', 'pass', undefined],
    ]);
    expect(heard.started).toEqual([0, 1, 2]);
    expect([stats.starts, stats.stops]).toEqual([2, 1]);
    expect(stats.requests[1]).toMatchObject({ targets: [{ circuit: 'main', benches: ['after'] }] });
  });

  it('gives a script’s top level a time limit of its own', async () => {
    const { sandbox } = fakeSandbox();
    const timers = fakeTimers();
    const runner = new TestRunner(sandbox, { loadTimeout: 200, schedule: timers.schedule });
    const load = runner.load('HANG');
    await settle();
    timers.advance(200);
    expect(await load).toEqual({
      benches: [],
      error: { message: "the script's top level didn't finish within 200 ms" },
    });
    expect(await runner.load(PASS)).toMatchObject({ benches: [{ name: 'passes' }] });
  });

  it('cancels a run, listing the benches not run; the next run starts afresh', async () => {
    const { sandbox, stats } = fakeSandbox();
    const runner = new TestRunner(sandbox);
    const { heard, listener } = recorder();
    const script = ["bench('hangs', (b) => {});", PASS].join('\n');
    const run = runner.run(withScript(script), [{ circuit: 'main' }], listener);
    const waiting = runner.run(withScript(PASS), [{ circuit: 'main' }]);
    await settle();
    runner.cancel();
    expect(await run).toEqual({
      status: 'cancelled',
      notRun: [
        { circuit: 'main', bench: 'hangs', line: 1 },
        { circuit: 'main', bench: 'passes', line: 2 },
      ],
    });
    expect(await waiting).toEqual({ status: 'cancelled', notRun: [] });
    expect(heard.started).toEqual([0]);
    expect(heard.results).toEqual([]);
    expect(runner.running).toBe(false);
    expect(await runner.run(withScript(PASS), [{ circuit: 'main' }])).toEqual({ status: 'done' });
    expect(stats.starts).toBe(2);
  });

  it('keeps loads going through a cancel', async () => {
    const { sandbox } = fakeSandbox();
    const runner = new TestRunner(sandbox);
    const run = runner.run(withScript("bench('hangs', (b) => {});"), [{ circuit: 'main' }]);
    const load = runner.load(PASS);
    await settle();
    runner.cancel();
    await run;
    expect(await load).toMatchObject({ benches: [{ name: 'passes' }] });
  });

  it('reports a sandbox that doesn’t start, and one that fails, never running elsewhere', async () => {
    const broken = new TestRunner(fakeSandbox({ fail: 'no Worker here' }).sandbox);
    expect(await broken.run(withScript(PASS), [{ circuit: 'main' }])).toEqual({
      status: 'failed',
      message: "the test sandbox didn't start: no Worker here",
    });
    expect(await broken.load(PASS)).toEqual({
      benches: [],
      error: { message: "the test sandbox didn't start: no Worker here" },
    });
    const { sandbox, crash } = fakeSandbox();
    const runner = new TestRunner(sandbox);
    const run = runner.run(withScript("bench('hangs', (b) => {});"), [{ circuit: 'main' }]);
    await settle();
    crash('the test runner failed: out of memory');
    expect(await run).toEqual({
      status: 'failed',
      message: 'the test runner failed: out of memory',
    });
  });

  it('tells script errors and runs the other circuits', async () => {
    const { sandbox } = fakeSandbox();
    const runner = new TestRunner(sandbox);
    const { heard, listener } = recorder();
    await runner.run(withScript('nope();'), [{ circuit: 'main' }], listener);
    expect(heard.errors).toEqual(['main: ReferenceError: nope is not defined']);
    expect(heard.planned).toEqual([]);
  });

  it('ends everything on dispose', async () => {
    const { sandbox, stats } = fakeSandbox();
    const runner = new TestRunner(sandbox);
    const load = runner.load('HANG');
    await settle();
    runner.dispose();
    expect(await load).toEqual({ benches: [], error: { message: 'cancelled' } });
    expect(stats.stops).toBe(1);
  });
});
