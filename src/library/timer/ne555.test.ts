import { describe, expect, it } from 'vitest';
import { Level, levelChar, ns, pinsOf, type Time, us } from '../../core';
import { Bench, functionTable } from '../../core/testing';
import { ne555, timerTiming } from './ne555';

const TPD = ns(225);

/** Changes of `pin` while the bench runs for `duration`: `[time, level]` pairs. */
function edges(bench: Bench, pin: string, duration: Time): [Time, string][] {
  const net = bench.sim.netIndex(pin);
  const seen: [Time, string][] = [];
  const off = bench.sim.onNetChange((t, n) => {
    if (n === net) seen.push([t, levelChar(bench.sim.level(pin))]);
  });
  bench.run(duration);
  off();
  return seen;
}

describe('NE555', () => {
  it('has the TI pinout; the RC network’s pins are simulated only where they are logic', () => {
    const pins = (mode: string) =>
      Object.fromEntries(pinsOf(ne555, { mode }).map((p) => [`${p.number} ${p.name}`, p.dir]));
    expect(pins('astable')).toEqual({
      '1 GND': 'power',
      '2 TRIG': 'nc',
      '3 OUT': 'out',
      '4 RESET': 'in',
      '5 CONT': 'nc',
      '6 THRES': 'nc',
      '7 DISCH': 'nc',
      '8 VCC': 'power',
    });
    expect(pins('monostable')).toMatchObject({ '2 TRIG': 'in', '6 THRES': 'nc', '7 DISCH': 'nc' });
    expect(pins('bistable')).toMatchObject({
      '2 TRIG': 'in',
      '6 THRES': 'in',
      '7 DISCH': 'tristate',
    });
  });

  it('times by the data sheet equations', () => {
    const t = timerTiming(1000, 100_000, 1e-6);
    expect(t.high).toBe(69_993_000_000); // 0.693 × 101 kΩ × 1 µF ≈ 70 ms
    expect(t.low).toBe(69_300_000_000); // 0.693 × 100 kΩ × 1 µF
    expect(t.first).toBe(111_100_000_000); // 1.1 × 101 kΩ × 1 µF
    expect(t.pulse).toBe(1_100_000_000); // 1.1 × 1 kΩ × 1 µF
    expect(timerTiming(1, 1, 1e-12).low).toBe(1); // never zero
  });

  describe('astable', () => {
    // tH = 0.693 × 2 kΩ × 1 nF = 1.386 µs, tL = 0.693 µs, first high 1.1 × 2 kΩ × 1 nF = 2.2 µs.
    const props = { mode: 'astable', ra: 1000, rb: 1000, c: 1e-9 };

    it('starts high for the first charge from 0 V, then runs at tH and tL', () => {
      const bench = new Bench(ne555, props);
      bench.set({ RESET: 1 });
      const out = edges(bench, 'OUT', us(10));
      expect(out.slice(0, 6)).toEqual([
        [TPD, '1'],
        [TPD + ns(2200), '0'],
        [TPD + ns(2200 + 693), '1'],
        [TPD + ns(2200 + 693 + 1386), '0'],
        [TPD + ns(2200 + 2 * 693 + 1386), '1'],
        [TPD + ns(2200 + 2 * 693 + 2 * 1386), '0'],
      ]);
    });

    it('stops low while RESET is low and restarts with a first charge', () => {
      const bench = new Bench(ne555, props);
      bench.set({ RESET: 1 }).run(ns(3000)); // low since 2425 ns, the next rise (3118 ns) pending
      bench.set({ RESET: 0 });
      const stopped = edges(bench, 'OUT', us(10));
      expect(stopped).toEqual([]); // it was low: it stays low, no more edges
      bench.set({ RESET: 1 });
      const start = bench.now;
      const restarted = edges(bench, 'OUT', us(3));
      expect(restarted.slice(0, 2)).toEqual([
        [start + TPD, '1'],
        [start + TPD + ns(2200), '0'],
      ]);
    });

    it('drives X while RESET is unknown', () => {
      const bench = new Bench(ne555, props);
      bench.set({ RESET: 'Z' }).run(us(1));
      bench.expect({ OUT: 'X' });
    });
  });

  describe('monostable', () => {
    // tw = 1.1 × 10 kΩ × 10 nF = 110 µs.
    const props = { mode: 'monostable', ra: 10_000, c: 10e-9 };
    const TW = us(110);

    it('starts unknown, until the first trigger or reset', () => {
      const bench = new Bench(ne555, props);
      bench.set({ RESET: 1, TRIG: 1 }).run(us(1));
      bench.expect({ OUT: 'X' });
      bench.set({ RESET: 0 }).run(us(1));
      bench.expect({ OUT: 0 });
    });

    it('gives one pulse of tw per trigger, ignoring triggers during it', () => {
      const bench = new Bench(ne555, props);
      bench.set({ RESET: 1, TRIG: 1 }).run(us(1));
      const start = bench.now;
      bench.set({ TRIG: 0 }).run(us(1));
      bench.set({ TRIG: 1 }).run(us(20));
      bench.set({ TRIG: 0 }).run(us(1)); // during the pulse: ignored
      bench.set({ TRIG: 1 });
      expect(edges(bench, 'OUT', us(200))).toEqual([[start + TW + TPD, '0']]);
      expect(bench.get('OUT')).toBe(Level.L0);
    });

    it('stays high after tw while TRIG is still low', () => {
      const bench = new Bench(ne555, props);
      bench.set({ RESET: 1, TRIG: 1 }).run(us(1));
      bench.set({ TRIG: 0 }).run(us(200));
      bench.expect({ OUT: 1 });
      const release = bench.now;
      bench.set({ TRIG: 1 });
      expect(edges(bench, 'OUT', us(1))).toEqual([[release + TPD, '0']]);
    });

    it('ends the pulse on RESET low', () => {
      const bench = new Bench(ne555, props);
      bench.set({ RESET: 1, TRIG: 1 }).run(us(1));
      bench.set({ TRIG: 0 }).run(us(1));
      bench.set({ TRIG: 1 }).run(us(10));
      const reset = bench.now;
      bench.set({ RESET: 0 });
      expect(edges(bench, 'OUT', us(200))).toEqual([[reset + TPD, '0']]);
    });
  });

  describe('bistable', () => {
    const props = { mode: 'bistable' };
    const table = ne555.functionTable!;

    it('follows the data sheet function table, DISCH open collector', () => {
      const bench = new Bench(ne555, props);
      // The rows with letters; DISCH (on/off) is checked by hand below.
      const letters = { ...table, rows: table.rows.slice(0, 3) };
      expect(functionTable(bench, letters, ['RESET', 'TRIG', 'THRES', 'OUT', null])).toBe(7);
      bench.set({ RESET: 1, TRIG: 1, THRES: 0 }).settle(); // last row: as before (low)
      bench.expect({ OUT: 0, DISCH: 0 });
      bench.set({ TRIG: 0 }).settle();
      bench.expect({ OUT: 1, DISCH: 'Z' }); // discharge off: released
      bench.set({ TRIG: 1 }).settle();
      bench.expect({ OUT: 1, DISCH: 'Z' }); // holds
    });

    it('starts unknown; RESET overrides TRIG, which overrides THRES', () => {
      const bench = new Bench(ne555, props);
      bench.set({ RESET: 1, TRIG: 1, THRES: 0 }).settle();
      bench.expect({ OUT: 'X', DISCH: 'X' });
      bench.set({ TRIG: 0, THRES: 1 }).settle();
      bench.expect({ OUT: 1 });
      bench.set({ RESET: 0 }).settle();
      bench.expect({ OUT: 0 });
      expect(bench.measure({ RESET: 1 }, 'OUT')).toBe(TPD); // TRIG still low: set again
    });

    it('merges what an unknown input could do', () => {
      const bench = new Bench(ne555, props);
      bench.set({ RESET: 1, TRIG: 1, THRES: 1 }).settle();
      bench.expect({ OUT: 0 });
      bench.set({ THRES: 'X' }).settle(); // reset or hold a low: low either way
      bench.expect({ OUT: 0 });
      bench.set({ TRIG: 'X' }).settle(); // might be set
      bench.expect({ OUT: 'X' });
    });
  });
});
