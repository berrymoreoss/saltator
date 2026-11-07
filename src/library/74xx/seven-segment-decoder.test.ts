import { describe, expect, it } from 'vitest';
import { Level, ns, pinsOf } from '../../core';
import { Bench, functionTable } from '../../core/testing';
import { hc4511 } from './seven-segment-decoder';

const nameAt = (number: number) => pinsOf(hc4511, {}).find((p) => p.number === number)!.name;
const bit = (value: number, n: number) => ((value >> n) & 1 ? Level.L1 : Level.L0);
const code = (value: number) => ({
  A: bit(value, 0),
  B: bit(value, 1),
  C: bit(value, 2),
  D: bit(value, 3),
});
const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
/** Segment levels as a string a … g: `'1111110'` is a 0. */
const shown = (bench: Bench) => SEGMENTS.map((s) => bench.levels([s])[s]).join('');

describe('74HC4511', () => {
  // From the pinning figure: LE, BI, LT, D, C, B, A, then a … g; the Display column is text.
  const TABLE_PINS = [5, 4, 3, 6, 2, 1, 7, 13, 12, 11, 10, 9, 15, 14];

  it('follows its data sheet function table, by pin number', () => {
    const bench = new Bench(hc4511);
    const columns = [...TABLE_PINS.map(nameAt), null];
    // 2⁶ lamp test + 2⁵ blanked + 16 codes.
    expect(functionTable(bench, hc4511.functionTable!, columns)).toBe(112);
  });

  it('latches the code while LE is high', () => {
    const bench = new Bench(hc4511);
    bench.set({ LT: 1, BI: 1, LE: 0, ...code(5) }).settle();
    expect(shown(bench)).toBe('1011011');
    bench.set({ LE: 1 }).settle();
    bench.set(code(2)).settle();
    expect(shown(bench)).toBe('1011011'); // still 5
    bench.set({ LE: 0 }).settle();
    expect(shown(bench)).toBe('1101101'); // 2
  });

  it('does not take a code that arrives as LE rises (hold time 0)', () => {
    const bench = new Bench(hc4511);
    bench.set({ LT: 1, BI: 1, LE: 0, ...code(7) }).settle();
    bench.set({ LE: 1, ...code(1) }).settle();
    expect(shown(bench)).toBe('1110000'); // 7
  });

  it('lamp test overrides blanking', () => {
    const bench = new Bench(hc4511);
    bench.set({ LT: 0, BI: 0, LE: 0, ...code(12) }).settle();
    expect(shown(bench)).toBe('1111111');
    bench.set({ LT: 1 }).settle();
    expect(shown(bench)).toBe('0000000');
  });

  it('shows X only on segments the possible displays disagree on', () => {
    const bench = new Bench(hc4511);
    bench.set({ LT: 1, BI: 1, LE: 0, ...code(0), A: 'X' }).settle(); // 0 or 1
    expect(shown(bench)).toBe('X11XXX0');
    bench.set({ ...code(8), BI: 'X' }).settle(); // 8 or blank
    expect(shown(bench)).toBe('XXXXXXX');
    bench.set({ BI: 1, LT: 'X' }).settle(); // 8 either way
    expect(shown(bench)).toBe('1111111');
  });

  it('starts with nothing latched: X while LE is high, until it goes low', () => {
    const bench = new Bench(hc4511);
    bench.set({ LT: 1, BI: 1, LE: 1, ...code(3) }).settle();
    expect(shown(bench)).toBe('XXXXXXX');
    bench.set({ LE: 0 }).settle();
    expect(shown(bench)).toBe('1111001');
  });

  it('latches X where an unknown LE might have let a different bit through', () => {
    const bench = new Bench(hc4511);
    bench.set({ LT: 1, BI: 1, LE: 0, ...code(4) }).settle();
    bench.set({ LE: 'X', ...code(5) }).settle(); // 4 or 5 latched
    bench.set({ LE: 1, ...code(9) }).settle();
    expect(shown(bench)).toBe('XX1X011'); // 4 = 0110011, 5 = 1011011
  });

  it('delays the segments by path: D, LE, BI, LT to a-g', () => {
    const bench = new Bench(hc4511);
    bench.set({ LT: 1, BI: 1, LE: 0, ...code(1) }).settle();
    expect(bench.measure({ A: 0 }, 'a')).toBe(ns(28)); // 1 → 0: a lights
    bench.set({ LE: 1 }).settle();
    bench.set({ A: 1 }).settle(); // held: still 0
    expect(bench.measure({ LE: 0 }, 'a')).toBe(ns(27)); // shows the 1 now: a goes out
    expect(bench.measure({ BI: 0 }, 'b')).toBe(ns(22));
    bench.set({ BI: 1 }).settle();
    expect(bench.measure({ LT: 0 }, 'a')).toBe(ns(15));
  });
});
