import { describe, expect, it } from 'vitest';
import { KernelDiagnosticKind, ns, pinsOf } from '../../core';
import { Bench, functionTable } from '../../core/testing';
import { hc245 } from './transceiver';

const nameAt = (number: number) => pinsOf(hc245, {}).find((p) => p.number === number)!.name;

/** Each bit's A and B pin numbers, from the pinning figure; DIR is pin 1, OE pin 19. */
const BITS_BY_PIN = [
  [2, 18],
  [3, 17],
  [4, 16],
  [5, 15],
  [6, 14],
  [7, 13],
  [8, 12],
  [9, 11],
];

const floatingPins = (bench: Bench) =>
  bench.diagnostics
    .filter((d) => d.kind === KernelDiagnosticKind.FLOATING_INPUT)
    .map((d) => d.pin)
    .sort();

describe('74HC245', () => {
  it('has its data sheet pinout', () => {
    expect(nameAt(1)).toBe('DIR');
    expect(nameAt(19)).toBe('OE');
    expect(BITS_BY_PIN.map((bit) => bit.map(nameAt))).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [`A${n}`, `B${n}`]),
    );
  });

  it('keeps the data sheet function table for display', () => {
    expect(hc245.functionTable).toEqual({
      inputs: ['OE', 'DIR'],
      outputs: ['An', 'Bn'],
      rows: ['L L | A=B input', 'L H | input B=A', 'H X | Z Z'],
      note: 'each bit (n = 0 to 7)',
    });
  });

  // The data sheet's rows "L H | input B=A" and "H X | Z Z" in letters, one bit at a time.
  it('DIR high: B = A on every bit, by pin number; OE high isolates', () => {
    const bench = new Bench(hc245);
    const table = {
      inputs: ['OE', 'DIR', 'An'],
      outputs: ['Bn'],
      rows: ['L H L | L', 'L H H | H', 'H X X | Z'],
    };
    for (const [a, b] of BITS_BY_PIN) {
      expect(functionTable(bench, table, ['OE', 'DIR', nameAt(a!), nameAt(b!)])).toBe(6);
    }
  });

  // The rows "L L | A=B input" and "H X | Z Z".
  it('DIR low: A = B on every bit, by pin number', () => {
    const bench = new Bench(hc245);
    const table = {
      inputs: ['OE', 'DIR', 'Bn'],
      outputs: ['An'],
      rows: ['L L L | L', 'L L H | H', 'H X X | Z'],
    };
    for (const [a, b] of BITS_BY_PIN) {
      expect(functionTable(bench, table, ['OE', 'DIR', nameAt(b!), nameAt(a!)])).toBe(6);
    }
  });

  it('never drives its input port', () => {
    const bench = new Bench(hc245);
    bench.set({ OE: 0, DIR: 1, A3: 'Z' }).settle();
    bench.expect({ A3: 'Z', B3: 'X' });
    bench.set({ DIR: 0, A3: 1, B3: 'Z' }).settle();
    bench.expect({ B3: 'Z', A3: 'X' }); // the floating B side reads as X: A sees the unknown (a fight)
  });

  it('enables after ten, passes data after tpd, isolates after tdis', () => {
    const bench = new Bench(hc245);
    bench.set({ OE: 1, DIR: 1, A0: 1 }).settle();
    expect(bench.measure({ OE: 0 }, 'B0')).toBe(ns(11));
    expect(bench.measure({ A0: 0 }, 'B0')).toBe(ns(9));
    expect(bench.measure({ OE: 1 }, 'B0')).toBe(ns(15));
    bench.expect({ B0: 'Z' });
  });

  it('turning round: the new output starts after ten, the old one stops after tdis', () => {
    const bench = new Bench(hc245);
    // Disabled; the B bus is driven from outside, the A side released, ready for B → A.
    bench.set({ OE: 1, DIR: 0, A0: 'Z', B0: 0 }).settle();
    expect(bench.measure({ OE: 0 }, 'A0')).toBe(ns(11));
    bench.expect({ A0: 0 });
    // Turning to A → B: the chip lets go of A after tdis.
    expect(bench.measure({ DIR: 1 }, 'A0')).toBe(ns(15));
  });

  it('drives X on every port that might be an output while OE or DIR is unknown', () => {
    const bench = new Bench(hc245);
    bench.set({ OE: 0, DIR: 'X', A1: 'Z', B1: 'Z' }).settle();
    bench.expect({ A1: 'X', B1: 'X' });
    bench.set({ OE: 'X', DIR: 1, A1: 1 }).settle();
    bench.expect({ A1: 1, B1: 'X' }); // A is never an output with DIR high: no fight there
  });

  it('reports a floating input bus, not an idle one', () => {
    const idle = new Bench(hc245);
    idle.set({ OE: 1, DIR: 1 }).settle();
    expect(floatingPins(idle)).toEqual([]);

    const floating = new Bench(hc245);
    floating.set({ OE: 0, DIR: 1 }).settle();
    expect(floatingPins(floating)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
  });
});
