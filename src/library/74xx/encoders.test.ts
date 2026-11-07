import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, ns, pinsOf } from '../../core';
import { Bench, functionTable } from '../../core/testing';
import { hcEncoders } from './encoders';

const chip = (number: string) => hcEncoders.find((d) => d.name === `74HC${number}`)!;
const nameAt = (d: AnyComponentDefinition, number: number) =>
  pinsOf(d, {}).find((p) => p.number === number)!.name;
const names = (d: AnyComponentDefinition, numbers: readonly number[]) =>
  numbers.map((n) => nameAt(d, n));

describe('74HC147', () => {
  const hc147 = chip('147');
  // From TI's pinning figure: I1 … I9, then Y3 … Y0.
  const TABLE_PINS = [11, 12, 13, 1, 2, 3, 4, 5, 10, 14, 6, 7, 9];

  it('follows its data sheet function table, by pin number', () => {
    const bench = new Bench(hc147);
    // 1 + 2⁸ + 2⁷ + … + 2⁰ combinations.
    expect(functionTable(bench, hc147.functionTable!, names(hc147, TABLE_PINS))).toBe(512);
    expect(pinsOf(hc147, {}).find((p) => p.number === 15)?.dir).toBe('nc');
  });

  it('keeps the output bits the possible winners agree on under an unknown input', () => {
    const bench = new Bench(hc147);
    const idle = { I1: 1, I2: 1, I3: 1, I4: 1, I5: 1, I6: 1, I7: 1, I8: 1, I9: 1 } as const;
    bench.set({ ...idle, I3: 0, I2: 'X' }).settle(); // 3 wins whatever I2 is
    bench.expect({ Y3: 1, Y2: 1, Y1: 0, Y0: 0 });
    bench.set({ I5: 'X' }).settle(); // 5 (0101) or 3 (0011): bits 3 and 0 agree
    bench.expect({ Y3: 1, Y2: 'X', Y1: 'X', Y0: 0 });
    bench.set({ ...idle, I1: 'Z' }).settle(); // 1 or the implied zero
    bench.expect({ Y3: 1, Y2: 1, Y1: 1, Y0: 'X' });
  });

  it('encodes after tpd', () => {
    const bench = new Bench(hc147);
    bench.set({ I1: 1, I2: 1, I3: 1, I4: 1, I5: 1, I6: 1, I7: 1, I8: 1, I9: 1 }).settle();
    expect(bench.measure({ I9: 0 }, 'Y0')).toBe(ns(18));
  });
});

describe('74HC148', () => {
  const hc148 = chip('148');
  // From TI's pinning figure: EI, 0 … 7, then A2, A1, A0, GS, EO.
  const TABLE_PINS = [5, 10, 11, 12, 13, 1, 2, 3, 4, 6, 7, 9, 14, 15];
  const idle = { '0': 1, '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1 } as const;

  it('follows its data sheet function table, by pin number', () => {
    const bench = new Bench(hc148);
    expect(names(hc148, TABLE_PINS)).toEqual([
      ...hc148.functionTable!.inputs,
      ...hc148.functionTable!.outputs,
    ]);
    // 2⁸ disabled + 1 idle + 2⁷ + … + 2⁰ combinations.
    expect(functionTable(bench, hc148.functionTable!, names(hc148, TABLE_PINS))).toBe(512);
  });

  it('keeps what the possible outcomes agree on under an unknown input or enable', () => {
    const bench = new Bench(hc148);
    bench.set({ ...idle, EI: 0, '6': 0, '4': 'X' }).settle(); // 6 wins
    bench.expect({ A2: 0, A1: 0, A0: 1, GS: 0, EO: 1 });
    bench.set({ EI: 'X' }).settle(); // 6, or disabled (all high)
    bench.expect({ A2: 'X', A1: 'X', A0: 1, GS: 'X', EO: 1 });
    bench.set({ ...idle, EI: 0, '0': 'X' }).settle(); // 0 (A = 111, GS low) or idle (EO low)
    bench.expect({ A2: 1, A1: 1, A0: 1, GS: 'X', EO: 'X' });
  });

  it('reads a floating input or enable as unknown', () => {
    const bench = new Bench(hc148);
    bench.set({ ...idle, EI: 0, '3': 'Z' }).settle(); // 3 (A = 100) or nothing (A = 111, EO low)
    bench.expect({ A2: 1, A1: 'X', A0: 'X', GS: 'X', EO: 'X' });
    bench.set({ '3': 1, '7': 0, EI: 'Z' }).settle(); // 7 (A = 000), or disabled (all high)
    bench.expect({ A2: 'X', A1: 'X', A0: 'X', GS: 'X', EO: 1 });
  });

  it('delays each output by its path', () => {
    const bench = new Bench(hc148);
    bench.set({ ...idle, EI: 0 }).settle();
    expect(bench.measure({ '7': 0 }, 'A2')).toBe(ns(23)); // 1-7 to A0-A2
    expect(bench.measure({ '7': 1 }, 'GS')).toBe(ns(25)); // 0-7 to GS
    expect(bench.measure({ '0': 0 }, 'EO')).toBe(ns(20)); // 0-7 to EO
    bench.set({ '0': 1, '5': 0 }).settle();
    expect(bench.measure({ EI: 1 }, 'A2')).toBe(ns(26)); // EI to A0-A2
    expect(bench.measure({ EI: 0 }, 'GS')).toBe(ns(19)); // EI to GS
    bench.set({ '5': 1 }).settle();
    expect(bench.measure({ EI: 1 }, 'EO')).toBe(ns(22)); // EI to EO
  });
});
