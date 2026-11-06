import { describe, expect, it } from 'vitest';
import { ns } from '../../core';
import { Bench } from '../../core/testing';
import { led, ledBar } from './led';
import { Light, type LightsState, onTimeAt } from './lights';

const lights = (bench: Bench) => bench.sim.stateOf('DUT') as LightsState;

describe('io/led', () => {
  it.each([
    [0, 0, Light.OFF],
    [0, 1, Light.OFF], // reverse bias
    [1, 0, Light.ON],
    [1, 1, Light.OFF],
    [1, 'Z', Light.OFF], // cathode not connected: no current
    ['Z', 0, Light.OFF],
    ['X', 0, Light.UNKNOWN],
    [1, 'X', Light.UNKNOWN],
  ] as const)('A = %s, K = %s', (A, K, light) => {
    const bench = new Bench(led);
    bench.set({ A, K }).settle();
    expect(lights(bench).light[0]).toBe(light);
  });

  it('only observes its nets: floating pins are dark, not floating inputs', () => {
    const bench = new Bench(led);
    bench.settle();
    expect(lights(bench).light[0]).toBe(Light.OFF);
    bench.expectNoDiagnostics();
    expect(bench.pins.every((p) => p.sense)).toBe(true);
  });

  it('lights at the moment its inputs change and accumulates on-time', () => {
    const bench = new Bench(led);
    bench.set({ A: 1, K: 0 }).settle();
    bench.run(ns(3));
    bench.set({ A: 0 }).settle();
    bench.run(ns(2));
    bench.set({ A: 1 }).settle();
    bench.run(ns(4));
    const state = lights(bench);
    expect(state.since[0]).toBe(ns(5));
    expect(onTimeAt(state, 0, bench.now)).toBe(ns(7));
  });

  it('offers real LED colors, red by default', () => {
    expect(led.props?.[0]?.default).toBe('red');
    expect(() => new Bench(led, { color: 'green' })).not.toThrow();
    expect(() => new Bench(led, { color: '#00ff00' })).toThrow('prop "color" must be one of');
  });
});

describe('io/led-bar', () => {
  it('has `count` LEDs with anodes A1…An and cathodes K1…Kn', () => {
    const bench = new Bench(ledBar, { count: 3 });
    expect(bench.pins.map((p) => p.name)).toEqual(['A1', 'A2', 'A3', 'K1', 'K2', 'K3']);
    expect(new Bench(ledBar).pins).toHaveLength(20);
  });

  it('lights each LED from its own anode and cathode', () => {
    const bench = new Bench(ledBar, { count: 3 });
    bench.set({ A1: 1, A2: 1, A3: 0, K1: 0, K2: 1, K3: 0 }).settle();
    expect([...lights(bench).light]).toEqual([Light.ON, Light.OFF, Light.OFF]);
    bench.set({ K2: 0, A3: 'X' }).settle();
    expect([...lights(bench).light]).toEqual([Light.ON, Light.ON, Light.UNKNOWN]);
    bench.expectNoDiagnostics();
  });

  it('allows 1 to 12 LEDs', () => {
    expect(new Bench(ledBar, { count: 1 }).pins).toHaveLength(2);
    expect(new Bench(ledBar, { count: 12 }).pins).toHaveLength(24);
    expect(() => new Bench(ledBar, { count: 0 })).toThrow('prop "count" must be ≥ 1');
  });
});
