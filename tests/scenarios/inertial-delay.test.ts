import { describe, expect, it } from 'vitest';
import { ns, type Time } from '../../src/core';
import { Trace } from '../../src/core/testing';
import { levels, set, simulate } from './support';

describe('inertial delay', () => {
  const buffered = (delay: Time) =>
    simulate((b) =>
      b
        .add('IN', 'test/driver')
        .add('U1', 'prim/buffer', { delay })
        .net('a', 'IN.Y', 'U1.A')
        .net('y', 'U1.Y'),
    );

  /** Applies a 0 → 1 → 0 pulse of the given width at the input; returns the output trace. */
  function pulse(delay: Time, width: Time): string[] {
    const sim = buffered(delay);
    set(sim, 'IN', 0);
    sim.settle();
    const trace = new Trace(sim);
    const t0 = sim.now;
    set(sim, 'IN', 1);
    sim.runFor(width);
    set(sim, 'IN', 0);
    sim.settle();
    return trace.of('y').map(([t, level]) => `${t - t0}:${level}`);
  }

  it('swallows a pulse shorter than the gate delay', () => {
    expect(pulse(ns(5), ns(4))).toEqual([]);
    expect(pulse(ns(5), ns(4.999))).toEqual([]);
  });

  it('passes a pulse at least as long as the gate delay, shifted by it', () => {
    expect(pulse(ns(5), ns(5))).toEqual([`${ns(5)}:1`, `${ns(10)}:0`]);
    expect(pulse(ns(5), ns(8))).toEqual([`${ns(5)}:1`, `${ns(13)}:0`]);
  });

  it('a gate with zero delay passes everything', () => {
    expect(pulse(0, 1)).toEqual(['0:1', '1:0']);
  });

  /**
   * Static hazard: Y = A · ¬A should always be 0, but when A rises the AND briefly sees both
   * inputs high, for as long as the inverter takes. The glitch reaches Y only if it lasts at
   * least the AND's own delay.
   */
  function hazard(inverterDelay: Time, andDelay: Time): string[] {
    const sim = simulate((b) =>
      b
        .add('A', 'test/driver')
        .add('N', 'prim/not', { delay: inverterDelay })
        .add('G', 'prim/and', { delay: andDelay })
        .net('a', 'A.Y', 'N.A', 'G.A')
        .net('na', 'N.Y', 'G.B')
        .net('y', 'G.Y'),
    );
    set(sim, 'A', 0);
    sim.settle();
    expect(levels(sim, 'y')).toBe('0');
    const trace = new Trace(sim);
    const t0 = sim.now;
    set(sim, 'A', 1);
    sim.settle();
    return trace.of('y').map(([t, level]) => `${t - t0}:${level}`);
  }

  it('shows the A·¬A glitch when the inverter is at least as slow as the AND', () => {
    expect(hazard(ns(2), ns(1))).toEqual([`${ns(1)}:1`, `${ns(3)}:0`]);
  });

  it('filters the glitch when the inverter is faster than the AND', () => {
    expect(hazard(ns(0.5), ns(1))).toEqual([]);
  });
});
