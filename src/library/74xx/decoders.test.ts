import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, KernelDiagnosticKind, Level, ns, pinsOf } from '../../core';
import { Bench, functionTable } from '../../core/testing';
import { hcDecoders } from './decoders';

const chip = (number: string) => hcDecoders.find((d) => d.name === `74HC${number}`)!;
const nameAt = (d: AnyComponentDefinition, number: number) =>
  pinsOf(d, {}).find((p) => p.number === number)!.name;
const names = (d: AnyComponentDefinition, numbers: readonly number[]) =>
  numbers.map((n) => nameAt(d, n));
const bit = (value: number, n: number) => ((value >> n) & 1 ? Level.L1 : Level.L0);

describe('74HC138', () => {
  const hc138 = chip('138');
  // From the pinning figure: E1, E2, E3, A2, A1, A0, then Y7 … Y0.
  const TABLE_PINS = [4, 5, 6, 3, 2, 1, 7, 9, 10, 11, 12, 13, 14, 15];
  const Y = ['Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7'];
  const outputs = (low: readonly number[]) =>
    Object.fromEntries(Y.map((y, n) => [y, low.includes(n) ? Level.L0 : Level.L1]));

  it('follows its data sheet function table, by pin number', () => {
    const bench = new Bench(hc138);
    expect(names(hc138, TABLE_PINS)).toEqual([
      ...hc138.functionTable!.inputs,
      ...hc138.functionTable!.outputs,
    ]);
    // 3 disabling rows × 2⁵ don't-care combinations + 8 addresses.
    expect(functionTable(bench, hc138.functionTable!, names(hc138, TABLE_PINS))).toBe(104);
  });

  it('decodes every address to exactly one low output while enabled', () => {
    const bench = new Bench(hc138);
    for (let address = 0; address < 8; address++) {
      bench.set({
        E1: 0,
        E2: 0,
        E3: 1,
        A0: bit(address, 0),
        A1: bit(address, 1),
        A2: bit(address, 2),
      });
      bench.settle();
      bench.expect(outputs([address]));
    }
  });

  it('drives X only on the outputs an unknown address bit could select', () => {
    const bench = new Bench(hc138);
    bench.set({ E1: 0, E2: 0, E3: 1, A0: 0, A1: 'X', A2: 1 }).settle();
    bench.expect({ ...outputs([]), Y4: 'X', Y6: 'X' });
    bench.set({ A1: 'Z' }).settle(); // floating: read as X, and reported
    bench.expect({ ...outputs([]), Y4: 'X', Y6: 'X' });
    expect(bench.diagnostics.some((d) => d.kind === KernelDiagnosticKind.FLOATING_INPUT)).toBe(
      true,
    );
  });

  it('drives X on the addressed output while an enable is unknown', () => {
    const bench = new Bench(hc138);
    bench.set({ E1: 0, E2: 'X', E3: 1, A0: 1, A1: 0, A2: 1 }).settle();
    bench.expect({ ...outputs([]), Y5: 'X' });
    bench.set({ E2: 0, E3: 'X' }).settle();
    bench.expect({ ...outputs([]), Y5: 'X' });
    bench.set({ E1: 1 }).settle(); // one enable decides: disabled
    bench.expect(outputs([]));
  });

  it('switches after the delay of the path that changed', () => {
    const bench = new Bench(hc138);
    bench.set({ E1: 0, E2: 0, E3: 1, A0: 0, A1: 0, A2: 0 }).settle();
    expect(bench.measure({ A0: 1 }, 'Y1')).toBe(ns(15)); // An to Yn
    expect(bench.measure({ E3: 0 }, 'Y1')).toBe(ns(17)); // E3 to Yn
    expect(bench.measure({ E3: 1 }, 'Y1')).toBe(ns(17));
    expect(bench.measure({ E1: 1 }, 'Y1')).toBe(ns(17)); // En to Yn
    expect(bench.measure({ E1: 0 }, 'Y1')).toBe(ns(17));
    expect(bench.measure({ E2: 1 }, 'Y1')).toBe(ns(17));
    bench.set({ E2: 0 }).settle();
    // Address and enable at once: the slower path.
    expect(bench.measure({ A1: 1, E3: 0 }, 'Y1')).toBe(ns(17));
  });
});

describe('74HC139', () => {
  const hc139 = chip('139');
  // Each decoder by pin number, from the pinning figure: nE, nA1, nA0, nY3, nY2, nY1, nY0.
  const DECODERS_BY_PIN = [
    [1, 3, 2, 7, 6, 5, 4],
    [15, 13, 14, 9, 10, 11, 12],
  ];

  it('follows its data sheet function table on both decoders, by pin number', () => {
    const bench = new Bench(hc139);
    for (const decoder of DECODERS_BY_PIN) {
      expect(functionTable(bench, hc139.functionTable!, names(hc139, decoder))).toBe(8);
    }
    expect(hc139.units!.map((u) => u.pins)).toEqual(
      DECODERS_BY_PIN.map((decoder) => names(hc139, decoder)),
    );
  });

  it('keeps the decoders independent', () => {
    const bench = new Bench(hc139);
    bench.set({ '1E': 0, '1A0': 1, '1A1': 1, '2E': 1, '2A0': 'X', '2A1': 'X' }).settle();
    bench.expect({ '1Y3': 0, '1Y0': 1, '2Y0': 1, '2Y1': 1, '2Y2': 1, '2Y3': 1 });
    bench.set({ '2E': 0, '2A0': 0, '2A1': 0 }).settle();
    bench.expect({ '1Y3': 0, '2Y0': 0 });
    bench.set({ '1A1': 'X' }).settle();
    bench.expect({ '1Y1': 'X', '1Y3': 'X', '1Y0': 1, '1Y2': 1, '2Y0': 0 });
  });

  it('drives X on the addressed output while its enable floats', () => {
    const bench = new Bench(hc139);
    bench.set({ '1E': 'Z', '1A0': 0, '1A1': 1, '2E': 1, '2A0': 0, '2A1': 0 }).settle();
    bench.expect({ '1Y2': 'X', '1Y0': 1, '1Y1': 1, '1Y3': 1, '2Y0': 1 });
  });

  it('switches after tpd(nAn to nYn) and tpd(nE to nYn)', () => {
    const bench = new Bench(hc139);
    bench.set({ '1E': 0, '1A0': 0, '1A1': 0, '2E': 0, '2A0': 0, '2A1': 0 }).settle();
    expect(bench.measure({ '1A0': 1 }, '1Y1')).toBe(ns(14));
    expect(bench.measure({ '1E': 1 }, '1Y1')).toBe(ns(12));
    expect(bench.measure({ '2A1': 1 }, '2Y2')).toBe(ns(14));
    expect(bench.measure({ '2E': 1 }, '2Y2')).toBe(ns(12));
  });
});
