/**
 * The Two-Digit Counter example (R11a) runs headless: after RESET its two Counter Digit instances
 * — each a Decade Counter instance and a 74HC4511 — count the 10 Hz clock's rising edges from 00
 * to 99 and round again, the ones digit's carry enabling the tens, the displays lit through the
 * ports.
 */
import { describe, expect, it } from 'vitest';
import { exampleDocument } from '../../src/app/example-files';
import { compileDesign, Resolver } from '../../src/circuit';
import { Level, levelChar, ms, Simulator } from '../../src/core';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry();

function load() {
  const design = compileDesign(exampleDocument('two-digit-counter'), registry);
  const sim = new Simulator(design.netlist, design.registry);
  const resolver = new Resolver(design, design.registry);
  /** A digit's count from its Decade Counter's bus port, or `X`. */
  const digit = (path: string): number | 'X' => {
    const target = resolver.signal(`${path}/A1/Q[0..3]`);
    if (typeof target === 'string') throw new Error(target);
    let value = 0;
    for (const [i, id] of target.bits.entries()) {
      const level = sim.level(id as string);
      if (level !== Level.L0 && level !== Level.L1) return 'X';
      if (level === Level.L1) value |= 1 << i;
    }
    return value;
  };
  return { design, sim, digit };
}

describe('Two-Digit Counter', () => {
  it('compiles without design issues, two levels deep', () => {
    const { design } = load();
    expect(design.issues).toEqual([]);
    expect(design.instances.map((i) => i.path)).toEqual(['A1', 'A1/A1', 'A2', 'A2/A1']);
  });

  it('counts the clock from 00 after RESET, carrying into the tens and round past 99', () => {
    const { sim, digit } = load();
    // A hand on RESET for a few clock periods, let go off the clock's edges.
    sim.action('SW1', { type: 'press' });
    sim.runUntil(ms(250) + 123_457);
    sim.action('SW1', { type: 'release' });
    sim.runUntil(sim.now + 1);
    expect([digit('A2'), digit('A1')]).toEqual([0, 0]);
    const clock = sim.netIndex('CLK');
    let edges = 0;
    sim.onNetChange((_, net, level) => {
      if (net === clock && level === Level.L1) edges++;
    });
    const seen: string[] = [];
    // Read between edges (they come every 100 ms): the counters settle within nanoseconds.
    for (const t of [ms(1_025), ms(4_525), ms(10_025), ms(10_825)]) {
      sim.runUntil(t);
      const tens = digit('A2');
      const ones = digit('A1');
      seen.push(`${tens}${ones}`);
      expect(ones, `at ${t} ps`).toBe(edges % 10);
      expect(tens, `at ${t} ps`).toBe(Math.floor(edges / 10) % 10);
    }
    expect(seen).toEqual(['07', '42', '97', '05']); // 97 → 05: round past 99
    expect(sim.diagnostics.entries.filter((d) => d.kind !== 'floating-input')).toEqual([]);
  });

  it('lights the displays through the Counter Digits’ segment ports', () => {
    const { sim, digit } = load();
    sim.action('SW1', { type: 'press' });
    sim.runUntil(ms(250) + 123_457);
    sim.action('SW1', { type: 'release' });
    // Until the ones digit shows 8: every segment of DS2 on, the tens' 0 without g.
    for (let i = 0; i < 200 && digit('A1') !== 8; i++) sim.runUntil(sim.now + ms(50));
    const segments = (display: string) =>
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((s) => levelChar(sim.pinLevel(display, s))).join('');
    expect(segments('DS2')).toBe('1111111');
    expect(segments('DS1')).toBe('1111110');
  });
});
