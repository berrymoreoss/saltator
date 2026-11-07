import { describe, expect, it } from 'vitest';
import { Drive } from '../../core';
import { Bench, Trace } from '../../core/testing';
import { gnd, vcc } from './rails';

describe('io/vcc, io/gnd', () => {
  it.each([
    [vcc, Drive.STRONG_1, '1'],
    [gnd, Drive.STRONG_0, '0'],
  ] as const)('%# drives its level strongly from t = 0', (part, drive, level) => {
    const bench = new Bench(part);
    const trace = new Trace(bench.sim);
    bench.settle();
    expect(bench.sim.drives[bench.sim.netIndex('Y')]).toBe(drive);
    expect(trace.lines()).toEqual([`0 Y=${level}`]); // timing: there at power-on
    bench.expectNoDiagnostics();
  });

  it('marks the pin constant and joins it to the net of its rail by name', () => {
    expect(vcc.pins).toEqual([{ name: 'Y', dir: 'out', constant: 1, net: 'VCC' }]);
    expect(gnd.pins).toEqual([{ name: 'Y', dir: 'out', constant: 0, net: 'GND' }]);
  });
});
