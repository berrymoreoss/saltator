/**
 * The learning examples (`examples/*.logic.json`, R07) do what their gallery card says: each one
 * compiled from its file and run.
 */
import { describe, expect, it } from 'vitest';
import { exampleDocument } from '../../src/app/example-files';
import { compileCircuit } from '../../src/circuit';
import { ns, Simulator } from '../../src/core';
import { createDefaultRegistry, Light, type LightsState } from '../../src/library';

const registry = createDefaultRegistry();
const light = (sim: Simulator, id: string) => (sim.stateOf(id) as LightsState).light[0];

function run(id: string): Simulator {
  const compiled = compileCircuit(exampleDocument(id).circuits[0]!, registry);
  expect(compiled.issues).toEqual([]);
  const sim = new Simulator(compiled.netlist, registry);
  sim.runFor(ns(100));
  return sim;
}

describe('Half Adder', () => {
  it('Sum = A xor B, Carry = A and B, for every input', () => {
    const sim = run('half-adder');
    const on = { A: false, B: false };
    for (const [a, b] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      // Flip the switches that differ, one after the other.
      if (on.A !== (a === 1)) {
        sim.action('SW1', { type: 'toggle' });
        sim.runFor(ns(100));
        on.A = a === 1;
      }
      if (on.B !== (b === 1)) {
        sim.action('SW2', { type: 'toggle' });
        sim.runFor(ns(100));
        on.B = b === 1;
      }
      expect([light(sim, 'D1'), light(sim, 'D2')], `A=${a} B=${b}`).toEqual([
        (a ^ b) === 1 ? Light.ON : Light.OFF,
        (a & b) === 1 ? Light.ON : Light.OFF,
      ]);
    }
    expect(sim.diagnostics.entries).toEqual([]);
  });
});

describe('SR Latch', () => {
  it('starts unknown; SET, RESET and hold; both pressed is the forbidden state', () => {
    const sim = run('sr-latch');
    // Nothing has set the latch yet: the 4-state lesson of a missing reset.
    expect([light(sim, 'D1'), light(sim, 'D2')]).toEqual([Light.UNKNOWN, Light.UNKNOWN]);

    const press = (id: string, type: 'press' | 'release') => {
      sim.action(id, { type });
      sim.runFor(ns(100));
    };
    const q = () => [light(sim, 'D1'), light(sim, 'D2')];
    press('SW1', 'press');
    expect(q()).toEqual([Light.ON, Light.OFF]);
    press('SW1', 'release');
    expect(q()).toEqual([Light.ON, Light.OFF]); // remembered
    press('SW2', 'press');
    expect(q()).toEqual([Light.OFF, Light.ON]);
    press('SW2', 'release');
    expect(q()).toEqual([Light.OFF, Light.ON]);
    press('SW1', 'press');
    press('SW2', 'press');
    expect(q()).toEqual([Light.ON, Light.ON]); // Q = /Q = 1
    expect(sim.diagnostics.entries).toEqual([]);
  });
});

describe('Ring Oscillator', () => {
  it('rests while disabled; enabled, it oscillates with a period of 2 × (9 + 9 + 9) ns', () => {
    const sim = run('ring-oscillator');
    const net = sim.netIndex('U2.1Y');
    const edges: number[] = [];
    sim.onNetChange((t, n) => {
      if (n === net) edges.push(t);
    });
    sim.runFor(ns(1000));
    expect(edges).toEqual([]);
    expect(light(sim, 'D1')).toBe(Light.ON); // NAND out 1 → 6Y 0 → 5Y 1

    const enabled = sim.now;
    sim.action('SW1', { type: 'toggle' });
    sim.runFor(ns(1000));
    expect(edges.length).toBeGreaterThan(30);
    expect(edges[0]! - enabled).toBe(ns(9)); // the NAND reacts first
    const periods = edges.slice(2).map((t, i) => t - edges[i]!);
    expect(new Set(periods)).toEqual(new Set([ns(54)]));
    expect(sim.diagnostics.entries).toEqual([]);

    sim.action('SW1', { type: 'toggle' });
    sim.runFor(ns(200));
    const stopped = edges.length;
    sim.runFor(ns(1000));
    expect(edges.length).toBe(stopped);
  });
});
