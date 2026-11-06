import { describe, expect, it } from 'vitest';
import { Level, ns } from '../../core';
import { createLights, Light, ledLight, onTimeAt, setLight } from './lights';

describe('ledLight', () => {
  // Rows: anode; columns: cathode 0, 1, X, Z. On only with forward bias; Z carries no current.
  it.each([
    [Level.L0, 'off off off off'],
    [Level.L1, 'on off unknown off'],
    [Level.X, 'unknown off unknown off'],
    [Level.Z, 'off off off off'],
  ])('anode %s', (anode, row) => {
    const names = { [Light.OFF]: 'off', [Light.ON]: 'on', [Light.UNKNOWN]: 'unknown' };
    const cathodes = [Level.L0, Level.L1, Level.X, Level.Z];
    expect(cathodes.map((k) => names[ledLight(anode, k)]).join(' ')).toBe(row);
  });
});

describe('lights state', () => {
  it('starts off at t = 0', () => {
    const s = createLights(2);
    expect([...s.light]).toEqual([0, 0]);
    expect(onTimeAt(s, 0, ns(5))).toBe(0);
  });

  it('accumulates on-time across changes; unknown does not count as on', () => {
    const s = createLights(1);
    setLight(s, 0, Light.ON, ns(1));
    expect(onTimeAt(s, 0, ns(4))).toBe(ns(3)); // still on
    setLight(s, 0, Light.ON, ns(2)); // no change: nothing restarts
    setLight(s, 0, Light.OFF, ns(4));
    setLight(s, 0, Light.ON, ns(10));
    setLight(s, 0, Light.UNKNOWN, ns(11));
    expect(onTimeAt(s, 0, ns(20))).toBe(ns(4));
    expect(s.light[0]).toBe(Light.UNKNOWN);
    expect(s.since[0]).toBe(ns(11));
    // Average brightness over a frame: sample at its start and at its end.
    const start = onTimeAt(s, 0, ns(20));
    setLight(s, 0, Light.ON, ns(20));
    setLight(s, 0, Light.OFF, ns(25));
    expect((onTimeAt(s, 0, ns(30)) - start) / ns(10)).toBe(0.5);
  });
});
