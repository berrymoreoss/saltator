import { describe, expect, it } from 'vitest';
import { ns } from '../../core';
import { Bench, functionTable, truthTable } from '../../core/testing';
import { PRIM_DEFAULT_DELAY } from './gates';
import { tristateBuffer } from './tristate-buffer';

describe('prim/tristate-buffer', () => {
  it('follows its function table (EN active high)', () => {
    functionTable(new Bench(tristateBuffer), {
      inputs: ['A', 'EN'],
      outputs: ['Y'],
      rows: ['X L | Z', 'L H | L', 'H H | H'],
    });
  });

  it('drives X when enabled with an unknown input or when the enable is unknown', () => {
    truthTable(
      new Bench(tristateBuffer),
      ['A', 'EN'],
      ['Y'],
      [
        ['X', 1, 'X'],
        ['Z', 1, 'X'],
        [1, 'X', 'X'],
        [0, 'Z', 'X'],
        ['X', 0, 'Z'],
      ],
    );
  });

  it('enables, disables and passes data after the delay', () => {
    const bench = new Bench(tristateBuffer, { delay: ns(3) });
    bench.set({ A: 1, EN: 0 }).settle();
    bench.expect({ Y: 'Z' });
    expect(bench.measure({ EN: 1 }, 'Y')).toBe(ns(3)); // Z → 1 (enable)
    expect(bench.measure({ A: 0 }, 'Y')).toBe(ns(3)); // 1 → 0 (data)
    expect(bench.measure({ EN: 0 }, 'Y')).toBe(ns(3)); // 0 → Z (disable)
    bench.expect({ Y: 'Z' });
  });

  it('uses the primitive default delay', () => {
    const bench = new Bench(tristateBuffer);
    bench.set({ A: 1, EN: 0 }).settle();
    expect(bench.measure({ EN: 1 }, 'Y')).toBe(PRIM_DEFAULT_DELAY);
  });
});
