import { describe, expect, it } from 'vitest';
import { defineComponent } from '../component';
import { and, Drive, Level, not, strong } from '../logic';
import { testDriver } from '../test-driver';
import { ns } from '../time';
import { Bench, toLevel } from './bench';
import { functionTable, truthTable } from './function-table';

const nand = defineComponent({
  type: 'test/nand',
  name: 'NAND',
  title: 'NAND',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'B', dir: 'in' },
    { name: 'Y', dir: 'out' },
    { name: 'VCC', dir: 'power' },
  ],
  props: [{ key: 'delay', label: 'Delay', type: 'time', default: ns(7) }],
  create: ({ delay }: { delay: number }) => ({
    evaluate: (ctx) => ctx.drive(2, strong(not(and(ctx.read(0), ctx.read(1)))), delay),
  }),
});

/** Bus transceiver slice: when DIR = 1 drives B from A, else releases B (B is bidirectional). */
const transceiver = defineComponent({
  type: 'test/xcvr',
  name: 'XCVR',
  title: 'Transceiver',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'DIR', dir: 'in' },
    { name: 'B', dir: 'bidir' },
  ],
  create: () => ({
    evaluate(ctx) {
      const dir = ctx.read(1);
      ctx.drive(
        2,
        dir === Level.L1 ? strong(ctx.read(0)) : dir === Level.L0 ? Drive.Z : Drive.STRONG_X,
        ns(5),
      );
    },
    action: (ctx, payload) => ctx.report({ kind: 'note', message: String(payload) }),
  }),
});

/** Zero-delay self-oscillator (inverter feeding itself), enabled by EN. */
const buzzer = defineComponent({
  type: 'test/buzzer',
  name: 'BUZ',
  title: 'Buzzer',
  pins: [
    { name: 'EN', dir: 'in' },
    { name: 'Y', dir: 'bidir' },
  ],
  create: () => ({
    evaluate(ctx) {
      if (ctx.read(0) !== Level.L1) return ctx.drive(1, Drive.STRONG_0, 0);
      ctx.drive(1, strong(not(ctx.read(1))), 0);
    },
  }),
});

describe('Bench', () => {
  it('drives inputs, reads outputs by pin name', () => {
    const bench = new Bench(nand);
    bench.set({ A: 1, B: 1 }).settle();
    expect(bench.get('Y')).toBe(Level.L0);
    bench.expect({ Y: 0 });
    expect(bench.levels()).toEqual({ A: '1', B: '1', Y: '0' });
    expect(bench.levels(['Y'])).toEqual({ Y: '0' });
    expect(bench.now).toBe(ns(7));
    bench.expectNoDiagnostics();
  });

  it('reports mismatches readably', () => {
    const bench = new Bench(nand);
    bench.set({ A: 0, B: 1 }).settle();
    expect(bench.mismatches({ Y: 0, A: 0 })).toEqual(['Y: expected 0, got 1']);
    expect(() => bench.expect({ Y: 'X' })).toThrow(
      'bench at 7 ns: Y: expected X, got 1\n  pins: A=0 B=1 Y=1',
    );
  });

  it('leaves unset inputs floating (and reports them)', () => {
    const bench = new Bench(nand);
    bench.set({ A: 1 }).settle();
    bench.expect({ B: 'Z', Y: 'X' });
    expect(bench.diagnostics.map((d) => d.kind)).toEqual(['floating-input']);
    expect(() => bench.expectNoDiagnostics()).toThrow(
      'bench: unexpected diagnostics\n  [floating-input] floating input: DUT.B reads net "B"',
    );
  });

  it('measures propagation delay', () => {
    const bench = new Bench(nand, { delay: ns(9) });
    bench.set({ A: 0, B: 1 }).settle();
    expect(bench.measure({ A: 1 }, 'Y')).toBe(ns(9));
    expect(() => bench.measure({ B: 1 }, 'Y')).toThrow('bench: Y did not change after {"B":1}');
  });

  it('can release a bidirectional pin and drive it from the bench', () => {
    const bench = new Bench(transceiver);
    bench.set({ A: 1, DIR: 1, B: 'Z' }).settle();
    bench.expect({ B: 1 });
    bench.set({ DIR: 0 }).settle();
    bench.expect({ B: 'Z' });
    bench.set({ B: 0 }).settle();
    bench.expect({ B: 0 });
    bench.set({ DIR: 1 }).settle(); // both drive B: contention
    bench.expect({ B: 'X' });
    expect(bench.diagnostics.map((d) => d.kind)).toContain('contention');
  });

  it('forwards actions to the part', () => {
    const bench = new Bench(transceiver);
    bench.action('hello');
    expect(bench.diagnostics.map((d) => d.message)).toEqual(['hello']);
  });

  it('throws when the part halts the simulation', () => {
    const bench = new Bench(buzzer, {}, { maxDeltaCycles: 20 });
    bench.set({ EN: 0 }).settle();
    bench.set({ EN: 1, Y: 'Z' });
    expect(() => bench.settle()).toThrow(/^bench: simulation halted\n {2}\[oscillation\]/);
  });

  it('runs for a fixed time', () => {
    const bench = new Bench(nand);
    bench.set({ A: 0, B: 0 });
    expect(bench.run(ns(3))).toBe('reached');
    bench.expect({ Y: 'X' });
    expect(bench.run(ns(10))).toBe('idle');
    bench.expect({ Y: 1 });
  });

  it('rejects bad pins and values', () => {
    const bench = new Bench(nand);
    expect(() => bench.set({ Y: 1 })).toThrow('bench: pin Y is an output (out)');
    expect(() => bench.set({ Q: 1 })).toThrow('bench: no pin "Q" (pins: A, B, Y, VCC)');
    expect(() => bench.get('VCC')).toThrow('bench: pin VCC is not simulated (power)');
    expect(() => toLevel('H' as never)).toThrow(`bad bench value "H" (expected 0, 1, 'X' or 'Z')`);
  });

  it('can wrap the test driver itself', () => {
    const bench = new Bench(testDriver);
    bench.action(Drive.STRONG_1).settle();
    bench.expect({ Y: 1 });
  });
});

describe('functionTable', () => {
  const table = {
    inputs: ['A', 'B'],
    outputs: ['Y'],
    rows: ['L X | H', 'X L | H', 'H H | L'],
  };

  it('expands datasheet don’t-cares and checks each combination', () => {
    expect(functionTable(new Bench(nand), table)).toBe(5); // 2 + 2 + 1
  });

  it('lists every failing row', () => {
    const wrong = { ...table, rows: ['L L | L', 'H H | L', 'H L | L'] };
    expect(() => functionTable(new Bench(nand), wrong)).toThrow(
      '2 of 3 rows failed:\n' +
        '  row "L L | L" with A=0 B=0: Y: expected 0, got 1\n' +
        '  row "H L | L" with A=1 B=0: Y: expected 0, got 1',
    );
  });

  it('accepts Z in outputs', () => {
    const t = { inputs: ['A', 'DIR'], outputs: ['B'], rows: ['X L | Z', 'H H | H', 'L H | L'] };
    expect(functionTable(new Bench(transceiver), t)).toBe(4);
  });

  it('maps generic columns to each unit’s pins', () => {
    const generic = { inputs: ['nA', 'nB'], outputs: ['nY'], rows: table.rows };
    expect(functionTable(new Bench(nand), generic, ['A', 'B', 'Y'])).toBe(5);
    expect(() => functionTable(new Bench(nand), generic, ['B', 'A'])).toThrow(
      'function table: 2 pins [B, A] for 3 columns',
    );
    const swapped = { ...generic, rows: ['L H | L'] }; // wrong for a NAND whichever way round
    expect(() => functionTable(new Bench(nand), swapped, ['B', 'A', 'Y'])).toThrow(
      'row "L H | L" with B=0 A=1: Y: expected 0, got 1',
    );
  });

  it('rejects malformed rows and letters', () => {
    const bench = new Bench(nand);
    const run = (rows: string[]) => () => functionTable(bench, { ...table, rows });
    expect(run(['L L H'])).toThrow('row "L L H": expected 2 inputs | 1 outputs');
    expect(run(['L | H'])).toThrow('expected 2 inputs | 1 outputs');
    expect(run(['L L | H | H'])).toThrow('expected 2 inputs | 1 outputs');
    expect(run(['L L | X'])).toThrow(
      `bad output letter "X" (datasheet X means "don't care"; not allowed in outputs)`,
    );
    expect(run(['L L | 1'])).toThrow('bad output letter "1"');
    expect(run(['L Z | H'])).toThrow('bad input letter "Z"');
  });

  it('skips output columns mapped to null (display only)', () => {
    const bench = new Bench(nand);
    const shown = {
      inputs: ['A', 'B'],
      outputs: ['Y', 'Display'],
      rows: ['L X | H one', 'H H | L zero'],
    };
    expect(functionTable(bench, shown, ['A', 'B', 'Y', null])).toBe(3);
    expect(() => functionTable(bench, shown, [null, 'B', 'Y', null])).toThrow(
      'every input column needs a pin',
    );
  });
});

describe('truthTable', () => {
  it('checks simulator values, X meaning unknown', () => {
    const rows = [
      [0, 'X', 1],
      ['X', 0, 1],
      [1, 'X', 'X'],
      ['Z', 1, 'X'],
      [1, 1, 0],
    ] as const;
    expect(truthTable(new Bench(nand), ['A', 'B'], ['Y'], rows)).toBe(5);
  });

  it('reports failures and malformed rows', () => {
    const bench = new Bench(nand);
    expect(() => truthTable(bench, ['A', 'B'], ['Y'], [[1, 'X', 1]])).toThrow(
      '1 of 1 rows failed:\n  row "1 X 1" with A=1 B=X: Y: expected 1, got X',
    );
    expect(() => truthTable(bench, ['A', 'B'], ['Y'], [[1, 1]])).toThrow(
      'truth table row [1, 1]: expected 3 values',
    );
  });
});
