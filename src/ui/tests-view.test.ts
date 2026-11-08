import { describe, expect, it } from 'vitest';
import {
  type BenchResult,
  type CircuitDocument,
  compileCircuit,
  documentRegistry,
  replaceCircuit,
  updateComponent,
} from '../circuit';
import { ns, us } from '../core';
import { testDriver } from '../core/testing';
import { registerDesign } from '../editor/test-documents';
import { createDefaultRegistry } from '../library';
import {
  benchFinished,
  benchNote,
  benchStarted,
  EMPTY_TESTS,
  isStale,
  marksOf,
  pruneTests,
  refItems,
  resultLines,
  runEnded,
  runPlanned,
  runStarted,
  scriptFailed,
  starterScript,
  testCounts,
  testsBadge,
} from './tests-view';

const library = createDefaultRegistry().register(testDriver);
const design = (): CircuitDocument => registerDesign(library);

function result(name: string, status: BenchResult['status'], more: Partial<BenchResult> = {}) {
  return {
    name,
    status,
    failures: [],
    failureCount: 0,
    warnings: [],
    logs: [],
    time: us(3),
    events: 10,
    ...more,
  } as BenchResult;
}

/** A run of every bench of `reg`: two benches, one failing. */
function ranReg(document: CircuitDocument) {
  let state = runStarted(EMPTY_TESTS, document, [{ circuit: 'reg' }]);
  const plan = [
    { circuit: 'reg', bench: 'latches', line: 1 },
    { circuit: 'reg', bench: 'holds', line: 5 },
  ];
  state = runPlanned(state, document, plan);
  state = benchStarted(state, plan[0]!);
  state = benchFinished(state, 'reg', result('latches', 'pass', { line: 1 }));
  state = benchStarted(state, plan[1]!);
  state = benchFinished(state, 'reg', result('holds', 'fail', { line: 5, failureCount: 1 }));
  return runEnded(state, { status: 'done' });
}

describe('the Tests tab’s results', () => {
  it('follows a run: planned, started, finished, ended', () => {
    const document = design();
    let state = runStarted(EMPTY_TESTS, document, [{ circuit: 'reg' }]);
    expect(state.run).toEqual({ total: 0, done: 0 });
    state = runPlanned(state, document, [{ circuit: 'reg', bench: 'latches', line: 1 }]);
    expect(state.circuits[0]!.benches.map((r) => [r.name, r.state, r.line])).toEqual([
      ['latches', 'queued', 1],
    ]);
    state = benchStarted(state, { circuit: 'reg', bench: 'latches' });
    expect(state.circuits[0]!.benches[0]!.state).toBe('running');
    expect(state.run).toMatchObject({ total: 1, done: 0, current: { bench: 'latches' } });
    state = benchFinished(state, 'reg', result('latches', 'pass'));
    expect(state.run).toEqual({ total: 1, done: 1 });
    state = runEnded(state, { status: 'done' });
    expect(state.run).toBeUndefined();
    expect(state.notice).toBeUndefined();
    expect(testCounts(state, document)).toEqual({ passed: 1, failed: 0, stale: 0 });
  });

  it('counts passes and failures for the badge, per circuit too', () => {
    const document = design();
    const state = ranReg(document);
    expect(testCounts(state, document)).toEqual({ passed: 1, failed: 1, stale: 0 });
    expect(testCounts(state, document, 'main')).toEqual({ passed: 0, failed: 0, stale: 0 });
    expect(testsBadge(testCounts(state, document))).toBe('✗ 1');
    expect(testsBadge({ passed: 9, failed: 0, stale: 0 })).toBe('✓ 9');
    expect(testsBadge(testCounts(EMPTY_TESTS, document))).toBeUndefined();
  });

  it('marks results stale when the circuit, one inside it or its script changes', () => {
    const document = design();
    const state = ranReg(document);
    const reg = document.circuits[1]!;
    const main = document.circuits[0]!;
    const row = state.circuits[0]!.benches[0]!;
    expect(isStale(row.basis, document, 'reg')).toBe(false);
    // Probes and the circuit around it don't matter to a bench of `reg`.
    const probed = replaceCircuit(document, { ...reg, probes: [{ ref: 'Q' }] });
    expect(isStale(row.basis, probed, 'reg')).toBe(false);
    const moved = replaceCircuit(document, updateComponent(main, 'D1', { x: 4 }));
    expect(isStale(row.basis, moved, 'reg')).toBe(false);
    const edited = replaceCircuit(document, updateComponent(reg, 'U1', { x: 12 }));
    expect(isStale(row.basis, edited, 'reg')).toBe(true);
    const scripted = replaceCircuit(document, { ...reg, testScript: ['// new'] });
    expect(isStale(row.basis, scripted, 'reg')).toBe(true);
    expect(testCounts(state, scripted)).toEqual({ passed: 1, failed: 1, stale: 2 });
    // Main's benches simulate reg inside it: an edit of reg makes them stale.
    const top = runStarted(EMPTY_TESTS, document, [{ circuit: 'main' }]);
    const planned = runPlanned(top, document, [{ circuit: 'main', bench: 'all' }]);
    expect(isStale(planned.circuits[0]!.benches[0]!.basis, edited, 'main')).toBe(true);
    expect(isStale(planned.circuits[0]!.benches[0]!.basis, scripted, 'main')).toBe(false);
  });

  it('runs one bench again, keeping the others', () => {
    const document = design();
    let state = ranReg(document);
    state = runStarted(state, document, [{ circuit: 'reg', benches: ['holds'] }]);
    expect(state.circuits[0]!.benches.map((r) => [r.name, r.state])).toEqual([
      ['latches', 'pass'],
      ['holds', 'queued'],
    ]);
    state = runPlanned(state, document, [{ circuit: 'reg', bench: 'holds', line: 5 }]);
    state = benchFinished(state, 'reg', result('holds', 'pass'));
    expect(state.circuits[0]!.benches.map((r) => r.state)).toEqual(['pass', 'pass']);
  });

  it('starts a circuit’s results afresh on a full run, others kept', () => {
    const document = design();
    let state = ranReg(document);
    state = runStarted(state, document, [{ circuit: 'main' }, { circuit: 'reg' }]);
    expect(state.circuits.map((c) => [c.circuit, c.benches.length])).toEqual([
      ['reg', 0],
      ['main', 0],
    ]);
  });

  it('says what didn’t run when a run is cancelled or the sandbox fails', () => {
    const document = design();
    let state = runStarted(EMPTY_TESTS, document, [{ circuit: 'reg' }]);
    state = runPlanned(state, document, [
      { circuit: 'reg', bench: 'a' },
      { circuit: 'reg', bench: 'b' },
    ]);
    state = benchStarted(state, { circuit: 'reg', bench: 'a' });
    const cancelled = runEnded(state, { status: 'cancelled', notRun: [] });
    expect(cancelled.circuits[0]!.benches.map((r) => r.state)).toEqual(['not-run', 'not-run']);
    expect(cancelled.notice).toBe("Cancelled: 2 benches didn't run");
    expect(runEnded(state, { status: 'failed', message: 'no sandbox' }).notice).toBe('no sandbox');
    expect(benchNote(cancelled.circuits[0]!.benches[0]!)).toBe('not run');
  });

  it('keeps a script’s error, counted as a failure, until the next run', () => {
    const document = design();
    let state = runStarted(EMPTY_TESTS, document, [{ circuit: 'reg' }]);
    state = scriptFailed(state, document, 'reg', { message: 'SyntaxError: …', line: 2 });
    state = runEnded(state, { status: 'done' });
    expect(state.circuits[0]).toMatchObject({
      benches: [],
      scriptError: { message: 'SyntaxError: …', line: 2 },
    });
    expect(testCounts(state, document)).toEqual({ passed: 0, failed: 1, stale: 0 });
  });

  it('drops the results of circuits deleted', () => {
    const document = design();
    const state = ranReg(document);
    const without = { ...document, circuits: [document.circuits[0]!] };
    expect(pruneTests(state, without).circuits).toEqual([]);
    expect(pruneTests(state, document)).toBe(state);
  });
});

describe('result lines', () => {
  it('shows logs, failures with line and instant, how many more, the error and warnings', () => {
    const lines = resultLines(
      result('counts', 'error', {
        logs: [{ line: 2, time: 0, text: 'started' }],
        failures: [
          {
            line: 7,
            time: ns(1250),
            message: 'Q[0..3] is 0x5, expected 0x4',
            ref: 'Q[0..3]',
            expected: '0x4',
            actual: '0x5',
          },
        ],
        failureCount: 13,
        error: { message: 'U9: no part or net named U9', line: 9 },
        warnings: [
          {
            time: ns(10),
            lastTime: ns(10),
            kind: 'floating-input',
            message: 'U1.A floats',
            count: 3,
            severity: 'warning',
          } as BenchResult['warnings'][number],
        ],
      }),
    );
    expect(lines).toEqual([
      { kind: 'log', text: 'line 2 at 0 ps: started', line: 2 },
      {
        kind: 'failure',
        text: 'line 7 at 1.25 µs: Q[0..3] is 0x5, expected 0x4',
        line: 7,
        ref: 'Q[0..3]',
      },
      { kind: 'more', text: '… and 12 more' },
      { kind: 'error', text: 'line 9: U9: no part or net named U9', line: 9 },
      { kind: 'warning', text: 'at 10 ns: U1.A floats (3×)' },
    ]);
  });

  it('notes a bench’s failures and time, or where it stands', () => {
    const document = design();
    const state = ranReg(document);
    expect(state.circuits[0]!.benches.map(benchNote)).toEqual(['3 µs', '1 failure, 3 µs']);
  });
});

describe('starterScript', () => {
  it('names a subcircuit’s ports and starts a bench driving the first input', () => {
    const reg = design().circuits[1]!;
    expect(starterScript(reg, library)).toBe(
      [
        '// Test benches for Register: bench(name, (b) => { … }), each on a fresh simulation.',
        '// b.set, b.row, b.table, b.clock, b.wait, b.expect, b.memory — see docs/circuit.md.',
        '// Inputs: D, CP',
        '// Outputs: Q',
        '',
        "bench('does what it should', (b) => {",
        "  b.set({ 'D': 0 });",
        '  b.wait(us(1));',
        "  b.expect({ 'Q': 'X' }); // 'X': don't care yet",
        '});',
        '',
      ].join('\n'),
    );
  });

  it('names a top circuit’s switches and buttons, or says what is missing', () => {
    const top = {
      ...design().circuits[0]!,
      components: [
        { id: 'SW1', type: 'io/switch', x: 0, y: 0, rotation: 0, flip: false, props: {} },
        { id: 'S1', type: 'io/button', x: 0, y: 4, rotation: 0, flip: false, props: {} },
        { id: 'X1', type: 'io/clock', x: 0, y: 8, rotation: 0, flip: false, props: {} },
      ] as const,
    };
    expect(starterScript(top, library)).toContain('// Switches, buttons and clocks: SW1, S1\n');
    expect(starterScript({ ...top, components: [] }, library)).toContain('No ports or switches');
  });
});

describe('marksOf', () => {
  const failing = (document: CircuitDocument) => {
    let state = runStarted(EMPTY_TESTS, document, [{ circuit: 'reg' }]);
    state = runPlanned(state, document, [{ circuit: 'reg', bench: 'holds', line: 5 }]);
    return benchFinished(
      state,
      'reg',
      result('holds', 'error', {
        failures: [{ line: 6, time: us(1), message: 'Q is 0, expected 1' }],
        failureCount: 1,
        error: { message: 'U9: no part or net named U9', line: 8 },
      }),
    );
  };

  it('marks the failures and errors of the circuit’s results at their lines', () => {
    const document = design();
    expect(marksOf(failing(document), undefined, document, 'reg', '')).toEqual([
      { line: 6, severity: 'error', message: 'holds: at 1 µs: Q is 0, expected 1' },
      { line: 8, severity: 'error', message: 'holds: U9: no part or net named U9' },
    ]);
    expect(marksOf(failing(document), undefined, document, 'main', '')).toEqual([]);
  });

  it('marks the script’s error as listed instead, and nothing of stale results', () => {
    const document = design();
    const listing = {
      circuit: 'reg',
      source: 'bench(',
      script: { benches: [], error: { message: 'SyntaxError: …', line: 1 } },
    };
    expect(marksOf(failing(document), listing, document, 'reg', 'bench(')).toEqual([
      { line: 1, severity: 'error', message: 'SyntaxError: …' },
    ]);
    // A listing of another text is old: the results' marks show.
    expect(marksOf(failing(document), listing, document, 'reg', 'other')).toHaveLength(2);
    const reg = document.circuits[1]!;
    const edited = replaceCircuit(document, { ...reg, testScript: ['// changed'] });
    expect(marksOf(failing(document), undefined, edited, 'reg', '// changed')).toEqual([]);
  });
});

describe('refItems', () => {
  it('names a part for an instance path, a pin or a memory cell', () => {
    const document = design();
    const main = document.circuits[0]!;
    const compiled = compileCircuit(main, documentRegistry(document, library));
    expect(refItems('A1/U1.1Q', main, compiled)).toEqual({ parts: ['A1'], wires: [] });
    expect(refItems('D1.Y', main, compiled)).toEqual({ parts: ['D1'], wires: [] });
    expect(refItems('A2[1F]', main, compiled)).toEqual({ parts: ['A2'], wires: [] });
  });

  it('names a net’s wires, or its labels where it has none', () => {
    const document = design();
    const main = document.circuits[0]!;
    const compiled = compileCircuit(main, documentRegistry(document, library));
    expect(refItems('CLOCK', main, compiled)).toEqual({
      parts: ['NLCLOCK0', 'NLCLOCK1', 'NLCLOCK2'],
      wires: [],
    });
    expect(refItems('NOWHERE', main, compiled)).toEqual({ parts: [], wires: [] });
    // A range of bits by name: with DA and DB renamed Q0 and Q1, Q[0..1] is both.
    const named = (n: string) =>
      compileCircuit(
        {
          ...main,
          components: main.components.map((c) =>
            c.type === 'net/label' && c.props.name === 'DA'
              ? { ...c, props: { name: `${n}0` } }
              : c.type === 'net/label' && c.props.name === 'DB'
                ? { ...c, props: { name: `${n}1` } }
                : c,
          ),
        },
        documentRegistry(document, library),
      );
    expect(refItems('Q[0..1]', main, named('Q')).parts).toEqual([
      'NLDA0',
      'NLDA1',
      'NLDB0',
      'NLDB1',
    ]);
    expect(refItems('Q[1]', main, named('Q')).parts).toEqual(['NLDB0', 'NLDB1']);
  });
});
