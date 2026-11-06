import { describe, expect, it } from 'vitest';
import { ns } from '../../core';
import { Bench, type BenchValue } from '../../core/testing';
import { Light, type LightsState, onTimeAt } from './lights';
import { SEGMENTS, sevenSegment } from './seven-segment';

const lights = (bench: Bench) => [...(bench.sim.stateOf('DUT') as LightsState).light];

/** All eight segment pins set to `value`. */
const allSegments = (value: BenchValue) =>
  Object.fromEntries(SEGMENTS.map((s) => [s, value])) as Record<string, BenchValue>;

/** Segments of digit 2 (a, b, g, e, d), as levels for a common-cathode display. */
const two = { a: 1, b: 1, c: 0, d: 1, e: 1, f: 0, g: 1, dp: 0 } as const;

describe('io/seven-segment', () => {
  it('has segment pins a…g, dp and COM, in light order', () => {
    expect(new Bench(sevenSegment).pins.map((p) => p.name)).toEqual([...SEGMENTS, 'COM']);
  });

  // Function table per segment: common cathode lights on segment 1 / COM 0, common anode on 0 / 1.
  it.each([
    ['cathode', 1, 0, Light.ON],
    ['cathode', 0, 0, Light.OFF],
    ['cathode', 1, 1, Light.OFF],
    ['cathode', 1, 'Z', Light.OFF],
    ['cathode', 1, 'X', Light.UNKNOWN],
    ['anode', 0, 1, Light.ON],
    ['anode', 1, 1, Light.OFF],
    ['anode', 0, 0, Light.OFF],
    ['anode', 0, 'Z', Light.OFF],
    ['anode', 'X', 1, Light.UNKNOWN],
  ] as const)('common %s: segments %s, COM %s', (common, segment, COM, light) => {
    const bench = new Bench(sevenSegment, { common });
    bench.set({ ...allSegments(segment), COM }).settle();
    expect(lights(bench)).toEqual(SEGMENTS.map(() => light));
  });

  it('shows a digit: common cathode', () => {
    const bench = new Bench(sevenSegment);
    bench.set({ ...two, COM: 0 }).settle();
    expect(lights(bench)).toEqual([1, 1, 0, 1, 1, 0, 1, 0]);
  });

  it('shows a digit: common anode, segments active low', () => {
    const bench = new Bench(sevenSegment, { common: 'anode' });
    const inverted = Object.fromEntries(Object.entries(two).map(([s, v]) => [s, 1 - v]));
    bench.set({ ...(inverted as Record<string, BenchValue>), COM: 1 }).settle();
    expect(lights(bench)).toEqual([1, 1, 0, 1, 1, 0, 1, 0]);
  });

  it('is dark and silent while unconnected', () => {
    const bench = new Bench(sevenSegment);
    bench.settle();
    expect(lights(bench)).toEqual(SEGMENTS.map(() => Light.OFF));
    bench.expectNoDiagnostics();
  });

  it('switching COM (multiplexing) lights and darkens all segments at that moment', () => {
    const bench = new Bench(sevenSegment);
    bench.set({ ...two, COM: 0 }).settle();
    bench.run(ns(10));
    bench.set({ COM: 1 }).settle();
    bench.run(ns(30));
    const state = bench.sim.stateOf('DUT') as LightsState;
    expect(onTimeAt(state, 0, bench.now)).toBe(ns(10)); // a: on for 10 ns of 40
    expect(onTimeAt(state, 2, bench.now)).toBe(0); // c: never on
    expect(state.since[0]).toBe(ns(10));
  });
});
