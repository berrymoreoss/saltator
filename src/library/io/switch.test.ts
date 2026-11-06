import { describe, expect, it } from 'vitest';
import { ns } from '../../core';
import { Bench, Trace } from '../../core/testing';
import { toggleSwitch } from './switch';

describe('io/switch', () => {
  // Contact table: what the pin carries in each position.
  it.each([
    ['spdt', false, '0'],
    ['spdt', true, '1'],
    ['spst-vcc', false, 'Z'],
    ['spst-vcc', true, '1'],
    ['spst-gnd', false, 'Z'],
    ['spst-gnd', true, '0'],
  ] as const)('%s, on = %s: Y = %s', (contact, on, level) => {
    const bench = new Bench(toggleSwitch, { contact, on });
    bench.settle();
    expect(bench.levels()).toEqual({ Y: level });
    bench.expectNoDiagnostics(); // an open contact floats, but nothing reads it here
  });

  it('is a push-pull output as SPDT and a tri-state one as SPST', () => {
    expect(new Bench(toggleSwitch).pins).toEqual([{ name: 'Y', dir: 'out' }]);
    expect(new Bench(toggleSwitch, { contact: 'spst-gnd' }).pins).toEqual([
      { name: 'Y', dir: 'tristate' },
    ]);
  });

  it('defaults to an SPDT switch that is off at power-on', () => {
    const bench = new Bench(toggleSwitch);
    bench.settle();
    bench.expect({ Y: 0 });
    expect(bench.sim.stateOf('DUT')).toEqual({ on: false });
  });

  it('toggles and sets at the time of the action, without delay', () => {
    const bench = new Bench(toggleSwitch);
    const trace = new Trace(bench.sim);
    bench.settle();
    bench.run(ns(5));
    bench.action({ type: 'toggle' });
    bench.settle();
    bench.run(ns(5));
    bench.action({ type: 'set', on: true }); // already on: nothing changes
    bench.settle();
    bench.action({ type: 'set', on: false });
    bench.settle();
    expect(trace.lines()).toEqual(['0 Y=0', '5000 Y=1', '10000 Y=0']);
    expect(bench.sim.stateOf('DUT')).toEqual({ on: false });
  });

  it('rejects unknown actions', () => {
    const bench = new Bench(toggleSwitch);
    expect(() => bench.action('toggle')).toThrow('DUT: unknown action "toggle"');
    expect(() => bench.action({ type: 'press' })).toThrow('DUT: unknown action {"type":"press"}');
    expect(() => bench.action({ type: 'set', on: 1 })).toThrow('unknown action');
    expect(() => bench.action(null)).toThrow('DUT: unknown action null');
  });
});
