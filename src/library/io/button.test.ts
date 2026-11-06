import { describe, expect, it } from 'vitest';
import { ns } from '../../core';
import { Bench, Trace } from '../../core/testing';
import { pushButton } from './button';

describe('io/button', () => {
  it.each([
    ['spdt', '0', '1'],
    ['spst-vcc', 'Z', '1'],
    ['spst-gnd', 'Z', '0'],
  ] as const)('%s: released Y = %s, pressed Y = %s', (contact, released, pressed) => {
    const bench = new Bench(pushButton, { contact });
    bench.settle();
    expect(bench.levels()).toEqual({ Y: released });
    bench.action({ type: 'press' });
    bench.settle();
    expect(bench.levels()).toEqual({ Y: pressed });
    bench.action({ type: 'release' });
    bench.settle();
    expect(bench.levels()).toEqual({ Y: released });
  });

  it('defaults to SPST to VCC, released at power-on', () => {
    const bench = new Bench(pushButton);
    expect(bench.pins).toEqual([{ name: 'Y', dir: 'tristate' }]);
    bench.settle();
    bench.expect({ Y: 'Z' });
    expect(bench.sim.stateOf('DUT')).toEqual({ pressed: false });
  });

  it('changes at the time of the action, without delay', () => {
    const bench = new Bench(pushButton, { contact: 'spdt' });
    const trace = new Trace(bench.sim);
    bench.run(ns(3));
    bench.action({ type: 'press' });
    expect(bench.sim.stateOf('DUT')).toEqual({ pressed: true });
    bench.run(ns(2));
    bench.action({ type: 'release' });
    bench.settle();
    expect(trace.lines()).toEqual(['0 Y=0', '3000 Y=1', '5000 Y=0']);
  });

  it('rejects unknown actions', () => {
    const bench = new Bench(pushButton);
    expect(() => bench.action({ type: 'toggle' })).toThrow('DUT: unknown action {"type":"toggle"}');
  });
});
