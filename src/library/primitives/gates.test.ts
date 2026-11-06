import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, ns } from '../../core';
import {
  Bench,
  type BenchValue,
  type BenchValues,
  functionTable,
  truthTable,
} from '../../core/testing';
import {
  andGate,
  buffer,
  gatePins,
  inverter,
  MAX_GATE_INPUTS,
  MIN_GATE_INPUTS,
  nandGate,
  norGate,
  orGate,
  PRIM_DEFAULT_DELAY,
  xnorGate,
  xorGate,
} from './gates';

type Gate = {
  def: AnyComponentDefinition;
  /** Reference function over known inputs. */
  ref: (bits: number[]) => boolean;
  /** Textbook 2-input table in datasheet letters (A B | Y). */
  table: string[];
  /** 2-input rows with unknown/floating inputs: [A, B, Y]. */
  unknown: BenchValue[][];
};

const count = (bits: number[]) => bits.filter(Boolean).length;

const GATES: Gate[] = [
  {
    def: andGate,
    ref: (b) => b.every(Boolean),
    table: ['L X | L', 'X L | L', 'H H | H'],
    unknown: [
      [0, 'X', 0],
      ['Z', 0, 0],
      [1, 'X', 'X'],
      ['Z', 1, 'X'],
      ['X', 'X', 'X'],
    ],
  },
  {
    def: orGate,
    ref: (b) => b.some(Boolean),
    table: ['H X | H', 'X H | H', 'L L | L'],
    unknown: [
      [1, 'X', 1],
      ['Z', 1, 1],
      [0, 'X', 'X'],
      ['Z', 0, 'X'],
      ['X', 'Z', 'X'],
    ],
  },
  {
    def: nandGate,
    ref: (b) => !b.every(Boolean),
    table: ['L X | H', 'X L | H', 'H H | L'],
    unknown: [
      [0, 'X', 1],
      ['Z', 0, 1],
      [1, 'X', 'X'],
      ['Z', 1, 'X'],
    ],
  },
  {
    def: norGate,
    ref: (b) => !b.some(Boolean),
    table: ['H X | L', 'X H | L', 'L L | H'],
    unknown: [
      [1, 'X', 0],
      ['Z', 1, 0],
      [0, 'X', 'X'],
      ['Z', 0, 'X'],
    ],
  },
  {
    def: xorGate,
    ref: (b) => count(b) % 2 === 1,
    table: ['L L | L', 'L H | H', 'H L | H', 'H H | L'],
    unknown: [
      [0, 'X', 'X'],
      [1, 'Z', 'X'],
      ['X', 'X', 'X'],
    ],
  },
  {
    def: xnorGate,
    ref: (b) => count(b) % 2 === 0,
    table: ['L L | H', 'L H | L', 'H L | L', 'H H | H'],
    unknown: [
      [0, 'X', 'X'],
      ['Z', 1, 'X'],
    ],
  },
];

const names = (n: number) =>
  gatePins(n)
    .slice(0, n)
    .map((p) => p.name);

describe.each(GATES)('$def.type', ({ def, ref, table, unknown }) => {
  it('follows its 2-input truth table', () => {
    functionTable(new Bench(def), { inputs: ['A', 'B'], outputs: ['Y'], rows: table });
  });

  it('handles unknown and floating inputs conservatively', () => {
    truthTable(new Bench(def), ['A', 'B'], ['Y'], unknown);
  });

  it.each(
    Array.from({ length: MAX_GATE_INPUTS - MIN_GATE_INPUTS + 1 }, (_, i) => i + MIN_GATE_INPUTS),
  )('computes every combination with %i inputs', (n) => {
    const bench = new Bench(def, { inputs: n });
    const inputs = names(n);
    const rows: BenchValue[][] = [];
    for (let v = 0; v < 1 << n; v++) {
      const bits = inputs.map((_, i) => (v >> i) & 1);
      rows.push([...(bits as BenchValue[]), ref(bits) ? 1 : 0]);
    }
    expect(truthTable(bench, inputs, ['Y'], rows)).toBe(1 << n);
    bench.expectNoDiagnostics();
  });

  it(`switches after the delay prop (default ${PRIM_DEFAULT_DELAY} ps)`, () => {
    // From A = 1, B = 0, raising B changes the output of every 2-input gate except OR/NOR;
    // from A = 0, B = 0, raising A changes all but AND/NAND.
    const isAndLike = def === andGate || def === nandGate;
    const start: BenchValues = isAndLike ? { A: 1, B: 0 } : { A: 0, B: 0 };
    const stimulus: BenchValues = isAndLike ? { B: 1 } : { A: 1 };
    for (const [props, expected] of [
      [{}, PRIM_DEFAULT_DELAY],
      [{ delay: ns(4.5) }, ns(4.5)],
      [{ delay: 0 }, 0],
    ] as const) {
      const bench = new Bench(def, props);
      bench.set(start).settle();
      expect(bench.measure(stimulus, 'Y')).toBe(expected);
    }
  });

  it('rejects input counts outside 2–8', () => {
    expect(() => new Bench(def, { inputs: 1 })).toThrow('prop "inputs" must be ≥ 2');
    expect(() => new Bench(def, { inputs: 9 })).toThrow('prop "inputs" must be ≤ 8');
  });
});

describe('N-input gates', () => {
  it('name inputs A… and put Y last', () => {
    expect(gatePins(3).map((p) => `${p.name}:${p.dir}`)).toEqual(['A:in', 'B:in', 'C:in', 'Y:out']);
  });

  it('let one controlling input decide despite unknown others', () => {
    const bench = new Bench(nandGate, { inputs: 8 });
    bench.set({ A: 'X', B: 'X', C: 'Z', D: 'X', E: 0, F: 'X', G: 'X', H: 'X' }).settle();
    bench.expect({ Y: 1 });
    bench.set({ E: 1 }).settle();
    bench.expect({ Y: 'X' });
  });
});

describe.each([
  { def: buffer, table: ['L | L', 'H | H'] },
  { def: inverter, table: ['L | H', 'H | L'] },
])('$def.type', ({ def, table }) => {
  it('follows its truth table', () => {
    functionTable(new Bench(def), { inputs: ['A'], outputs: ['Y'], rows: table });
  });

  it('turns unknown and floating inputs into X', () => {
    truthTable(
      new Bench(def),
      ['A'],
      ['Y'],
      [
        ['X', 'X'],
        ['Z', 'X'],
      ],
    );
  });

  it('switches after the delay prop', () => {
    const bench = new Bench(def, { delay: ns(2) });
    bench.set({ A: 0 }).settle();
    expect(bench.measure({ A: 1 }, 'Y')).toBe(ns(2));
    expect(bench.measure({ A: 0 }, 'Y')).toBe(ns(2));
  });
});
