import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../document';
import { functionScriptHost } from './function-host';
import { type BenchRequest, type BenchResponse, benchService } from './service';
import { benchTestDocument } from './test-circuits';
import { benchTestRegistry } from './test-parts';

const serve = benchService(benchTestRegistry(), functionScriptHost());

/** Every response to `request`, in order. */
function answers(request: BenchRequest): BenchResponse[] {
  const replies: BenchResponse[] = [];
  serve(request, (r) => replies.push(r));
  return replies;
}

/** The test document with these test scripts by circuit id. */
function withScripts(scripts: Readonly<Record<string, string>>): CircuitDocument {
  const document = benchTestDocument();
  return {
    ...document,
    circuits: document.circuits.map((c) =>
      scripts[c.id] === undefined ? c : { ...c, testScript: scripts[c.id]!.split('\n') },
    ),
  };
}

const PASSING = "bench('and', (b) => b.row({ A: 1, B: 1 }, { Y: 1 }));";
const TWO = [
  "bench('high', (b) => b.row({ A: 1, B: 1 }, { Y: 1 }));",
  "bench('wrong', (b) => b.row({ A: 0, B: 1 }, { Y: 1 }));",
].join('\n');

describe('benchService', () => {
  it('loads a script to list its benches, or says why it doesn’t load', () => {
    expect(answers({ kind: 'load', job: 1, source: TWO })).toEqual([
      {
        kind: 'loaded',
        job: 1,
        script: {
          benches: [
            { name: 'high', line: 1 },
            { name: 'wrong', line: 2 },
          ],
        },
      },
      { kind: 'done', job: 1 },
    ]);
    expect(answers({ kind: 'load', job: 2, source: 'nope();' })[0]).toEqual({
      kind: 'loaded',
      job: 2,
      script: { benches: [], error: { message: 'ReferenceError: nope is not defined', line: 1 } },
    });
  });

  it('runs every bench of the circuits asked for, in order, planned first', () => {
    const document = withScripts({ cell: TWO, main: '' });
    const replies = answers({
      kind: 'run',
      job: 7,
      document,
      targets: [{ circuit: 'cell' }, { circuit: 'main' }],
    });
    expect(replies.map((r) => r.kind)).toEqual([
      'planned',
      'started',
      'result',
      'started',
      'result',
      'done',
    ]);
    expect(replies[0]).toEqual({
      kind: 'planned',
      job: 7,
      benches: [
        { circuit: 'cell', bench: 'high', line: 1 },
        { circuit: 'cell', bench: 'wrong', line: 2 },
      ],
    });
    expect(replies.every((r) => r.job === 7)).toBe(true);
    const results = replies.flatMap((r) => (r.kind === 'result' ? [r] : []));
    expect(results.map((r) => [r.circuit, r.result.name, r.result.status])).toEqual([
      ['cell', 'high', 'pass'],
      ['cell', 'wrong', 'fail'],
    ]);
    expect(replies[3]).toEqual({ kind: 'started', job: 7, index: 1 });
  });

  it('runs the benches asked for by name, a lost one as an error', () => {
    const document = withScripts({ cell: TWO });
    const replies = answers({
      kind: 'run',
      job: 1,
      document,
      targets: [{ circuit: 'cell', benches: ['wrong', 'gone'] }],
    });
    const results = replies.flatMap((r) => (r.kind === 'result' ? [r.result] : []));
    expect(results.map((r) => [r.name, r.status, r.error?.message])).toEqual([
      ['wrong', 'fail', undefined],
      ['gone', 'error', 'no bench "gone" in the script'],
    ]);
  });

  it('reports a script that doesn’t load and a missing circuit, running the others', () => {
    const document = withScripts({ cell: PASSING, memory: 'bench(' });
    const replies = answers({
      kind: 'run',
      job: 3,
      document,
      targets: [{ circuit: 'memory' }, { circuit: 'nowhere' }, { circuit: 'cell' }],
    });
    expect(replies.filter((r) => r.kind === 'script-error')).toEqual([
      {
        kind: 'script-error',
        job: 3,
        circuit: 'memory',
        error: { message: expect.stringMatching(/^SyntaxError: /) },
      },
      {
        kind: 'script-error',
        job: 3,
        circuit: 'nowhere',
        error: { message: 'no circuit "nowhere"' },
      },
    ]);
    expect(replies.flatMap((r) => (r.kind === 'result' ? [r.result.status] : []))).toEqual([
      'pass',
    ]);
    expect(replies.at(-1)).toEqual({ kind: 'done', job: 3 });
  });

  it('gives the same answers twice (deterministic)', () => {
    const request: BenchRequest = {
      kind: 'run',
      job: 1,
      document: withScripts({ cell: TWO }),
      targets: [{ circuit: 'cell' }],
    };
    expect(answers(request)).toEqual(answers(request));
  });

  it('answers with plain data a worker can post (structured clone)', () => {
    const replies = answers({
      kind: 'run',
      job: 1,
      document: withScripts({ cell: TWO }),
      targets: [{ circuit: 'cell' }],
    });
    expect(structuredClone(replies)).toEqual(replies);
  });
});
