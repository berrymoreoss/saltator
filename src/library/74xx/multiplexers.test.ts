import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, ns, pinsOf } from '../../core';
import { Bench, functionTable } from '../../core/testing';
import { hcMultiplexers } from './multiplexers';

const chip = (number: string) => hcMultiplexers.find((d) => d.name === `74HC${number}`)!;
const nameAt = (d: AnyComponentDefinition, number: number) =>
  pinsOf(d, {}).find((p) => p.number === number)!.name;
const names = (d: AnyComponentDefinition, numbers: readonly number[]) =>
  numbers.map((n) => nameAt(d, n));

describe('74HC151', () => {
  const hc151 = chip('151');
  // From the pinning figure: E, S2, S1, S0, I0 … I7, then Y̅ (6) and Y (5).
  const TABLE_PINS = [7, 9, 10, 11, 4, 3, 2, 1, 15, 14, 13, 12, 6, 5];

  it('follows its data sheet function table, by pin number', () => {
    const bench = new Bench(hc151);
    // 2¹¹ disabled combinations + 16 rows × 2⁷.
    expect(functionTable(bench, hc151.functionTable!, names(hc151, TABLE_PINS))).toBe(4096);
  });

  it('draws its complementary output as Y with an overline', () => {
    expect(pinsOf(hc151, {}).find((p) => p.number === 6)).toMatchObject({
      name: 'YN',
      label: 'Y',
      activeLow: true,
    });
  });

  it('is as precise as the inputs allow with an unknown select or enable', () => {
    const bench = new Bench(hc151);
    bench.set({ E: 0, S0: 'X', S1: 0, S2: 0, I0: 1, I1: 1, I2: 0, I3: 0 }).settle();
    bench.expect({ Y: 1, YN: 0 }); // I0 and I1 agree
    bench.set({ I1: 0 }).settle();
    bench.expect({ Y: 'X', YN: 'X' });
    bench.set({ S0: 1, S1: 'Z' }).settle(); // floating select: I1 or I3, both 0
    bench.expect({ Y: 0, YN: 1 });
    bench.set({ S1: 0, E: 'X' }).settle(); // I1 = 0: low whether enabled or not
    bench.expect({ Y: 0, YN: 1 });
    bench.set({ I1: 1 }).settle();
    bench.expect({ Y: 'X', YN: 'X' });
  });

  it('switches after the delay of the path that changed, on each output', () => {
    const bench = new Bench(hc151);
    bench.set({ E: 0, S0: 0, S1: 0, S2: 0, I0: 0, I1: 1, I2: 0, I3: 0 });
    bench.set({ I4: 0, I5: 0, I6: 0, I7: 0 }).settle();
    expect(bench.measure({ I0: 1 }, 'Y')).toBe(ns(19));
    expect(bench.measure({ I0: 0 }, 'YN')).toBe(ns(21));
    expect(bench.measure({ S0: 1 }, 'Y')).toBe(ns(22));
    expect(bench.measure({ S0: 0 }, 'YN')).toBe(ns(22));
    bench.set({ I0: 1 }).settle();
    expect(bench.measure({ E: 1 }, 'Y')).toBe(ns(15));
    expect(bench.measure({ E: 0 }, 'YN')).toBe(ns(17));
  });
});

describe('74HC153', () => {
  const hc153 = chip('153');
  // Each multiplexer by pin number: S0, S1, nI0 … nI3, nE, nY.
  const MUXES_BY_PIN = [
    [14, 2, 6, 5, 4, 3, 1, 7],
    [14, 2, 10, 11, 12, 13, 15, 9],
  ];

  it('follows its data sheet function table on both multiplexers, by pin number', () => {
    const bench = new Bench(hc153);
    for (const mux of MUXES_BY_PIN) {
      expect(functionTable(bench, hc153.functionTable!, names(hc153, mux))).toBe(128);
    }
  });

  it('shares the select inputs, not the enables', () => {
    const bench = new Bench(hc153);
    bench.set({ S0: 1, S1: 1, '1I3': 1, '2I3': 1, '1E': 0, '2E': 1 }).settle();
    bench.expect({ '1Y': 1, '2Y': 0 });
    bench.set({ '2E': 0 }).settle();
    bench.expect({ '1Y': 1, '2Y': 1 });
  });

  it('switches after tpd(nIn to nY), tpd(Sn to nY) and tpd(nE to nY)', () => {
    const bench = new Bench(hc153);
    bench.set({ S0: 0, S1: 0, '1I0': 0, '1I1': 1, '1I2': 0, '1I3': 0, '1E': 0 }).settle();
    expect(bench.measure({ '1I0': 1 }, '1Y')).toBe(ns(17));
    expect(bench.measure({ S1: 1 }, '1Y')).toBe(ns(18));
    bench.set({ '1I2': 1 }).settle();
    expect(bench.measure({ '1E': 1 }, '1Y')).toBe(ns(12));
  });
});

describe.each([
  ['157', [13, 15, 14]],
  ['158', [15, 17, 17]],
] as const)('74HC%s', (number, [tData, tSelect, tEnable]) => {
  const def = chip(number);
  const inverting = number === '158';
  const level = (y: 0 | 1) => (inverting ? 1 - y : y) as 0 | 1;
  // Each multiplexer by pin number: E, S, nI0, nI1, nY.
  const MUXES_BY_PIN = [
    [15, 1, 2, 3, 4],
    [15, 1, 5, 6, 7],
    [15, 1, 11, 10, 9],
    [15, 1, 14, 13, 12],
  ];

  it('follows its data sheet function table on every multiplexer, by pin number', () => {
    const bench = new Bench(def);
    for (const mux of MUXES_BY_PIN) {
      expect(functionTable(bench, def.functionTable!, names(def, mux))).toBe(16);
    }
  });

  it('gives the inputs’ common value under an unknown select, X if they differ', () => {
    const bench = new Bench(def);
    bench.set({ E: 0, S: 'X', '1I0': 1, '1I1': 1, '2I0': 0, '2I1': 1 }).settle();
    bench.expect({ '1Y': level(1), '2Y': 'X' });
    bench.set({ S: 'Z' }).settle();
    bench.expect({ '1Y': level(1), '2Y': 'X' });
  });

  it('switches after the delay of the path that changed', () => {
    const bench = new Bench(def);
    bench.set({ E: 0, S: 0, '3I0': 0, '3I1': 1 }).settle();
    expect(bench.measure({ '3I0': 1 }, '3Y')).toBe(ns(tData));
    bench.set({ '3I0': 0 }).settle();
    expect(bench.measure({ S: 1 }, '3Y')).toBe(ns(tSelect));
    expect(bench.measure({ E: 1 }, '3Y')).toBe(ns(tEnable));
    bench.expect({ '3Y': level(0) });
  });
});
