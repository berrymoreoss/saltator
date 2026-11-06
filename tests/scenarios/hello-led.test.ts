/**
 * M1 "Hello, LED" as shipped (File ▸ Examples): a switch through a 74HC00 gate to an LED and a
 * 1 Hz clock blinking another, compiled from the document and run.
 */
import { describe, expect, it } from 'vitest';
import { helloLed } from '../../src/app/examples';
import { compileCircuit } from '../../src/circuit';
import { ms, ns, Simulator } from '../../src/core';
import { createDefaultRegistry, Light, type LightsState } from '../../src/library';

const registry = createDefaultRegistry();
const light = (sim: Simulator, id: string) => (sim.stateOf(id) as LightsState).light[0];

function start(): Simulator {
  const compiled = compileCircuit(helloLed(registry), registry);
  expect(compiled.issues).toEqual([]);
  return new Simulator(compiled.netlist, registry);
}

describe('Hello, LED with a 74HC00', () => {
  it('the LED shows the inverted switch, tpd = 9 ns after it flips', () => {
    const sim = start();
    sim.runFor(ns(100));
    expect(light(sim, 'D1')).toBe(Light.ON); // switch off: NAND(1, 0) = 1

    const flipped = sim.now;
    let changedAt = -1;
    const net = sim.netIndex('U1.1Y');
    sim.onNetChange((t, n) => {
      if (n === net) changedAt = t;
    });
    sim.action('SW1', { type: 'toggle' });
    sim.runFor(ns(100));
    expect(changedAt - flipped).toBe(ns(9));
    expect(light(sim, 'D1')).toBe(Light.OFF);
    expect(sim.diagnostics.entries).toEqual([]); // every input is driven
  });

  it('the clock blinks the other LED at 1 Hz', () => {
    const sim = start();
    sim.runUntil(ms(499));
    expect(light(sim, 'D2')).toBe(Light.OFF);
    sim.runUntil(ms(501));
    expect(light(sim, 'D2')).toBe(Light.ON);
    sim.runUntil(ms(1001));
    expect(light(sim, 'D2')).toBe(Light.OFF);
  });
});
