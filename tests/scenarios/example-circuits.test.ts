/**
 * The learning examples (`examples/*.logic.json`, R07) do what their gallery card says: each one
 * compiled from its file and run.
 */
import { describe, expect, it } from 'vitest';
import { exampleDocument } from '../../src/app/example-files';
import { compileCircuit } from '../../src/circuit';
import { ms, ns, Simulator } from '../../src/core';
import { createDefaultRegistry, Light, type LightsState, SEGMENTS } from '../../src/library';

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

describe('BCD to 7-Segment', () => {
  it('shows the digit set on the DIP switch (5 at power-on), blank for 10–15', () => {
    const sim = run('bcd-7-segment');
    const lit = () => {
      const state = sim.stateOf('DS1') as LightsState;
      return SEGMENTS.filter((_, i) => state.light[i] === Light.ON).join('');
    };
    expect(lit()).toBe('acdfg'); // 5
    const flip = (index: number) => {
      sim.action('SW1', { type: 'toggle', index });
      sim.runFor(ns(200));
    };
    flip(0); // 4
    expect(lit()).toBe('bcfg');
    flip(3); // 12: blank
    expect(lit()).toBe('');
    flip(2); // 8
    expect(lit()).toBe('abcdefg');
    expect(sim.diagnostics.entries).toEqual([]);
  });
});

describe('Clock Module', () => {
  // U1: tH = 0.693 × 471 kΩ × 1 µF ≈ 326 ms, tL ≈ 326 ms, the first high 1.1 × 471 kΩ × 1 µF ≈ 518 ms.
  // U2: a 1.1 × 100 kΩ × 1 µF = 110 ms pulse per press.
  it('runs on the 555 oscillator in auto mode', () => {
    const sim = run('clock-module');
    sim.runFor(ms(300));
    expect(light(sim, 'D1')).toBe(Light.ON); // the first, long high
    sim.runFor(ms(400)); // 0.7 s
    expect(light(sim, 'D1')).toBe(Light.OFF);
    sim.runFor(ms(300)); // 1.0 s
    expect(light(sim, 'D1')).toBe(Light.ON);
    expect(sim.diagnostics.entries).toEqual([]);
  });

  it('in manual mode gives one pulse per STEP press, unknown before the first one', () => {
    const sim = run('clock-module');
    sim.action('SW2', { type: 'toggle' }); // MANUAL
    sim.runFor(ms(1));
    // The monostable 555 has not been triggered yet: its output, and the clock, are unknown.
    expect(light(sim, 'D1')).toBe(Light.UNKNOWN);
    sim.action('SW1', { type: 'press' });
    sim.runFor(ms(20));
    sim.action('SW1', { type: 'release' });
    sim.runFor(ms(50));
    expect(light(sim, 'D1')).toBe(Light.ON);
    sim.runFor(ms(100)); // past 110 ms
    expect(light(sim, 'D1')).toBe(Light.OFF);
    sim.runFor(ms(1000));
    expect(light(sim, 'D1')).toBe(Light.OFF); // no oscillator in manual mode
  });

  it('stops while HLT is on', () => {
    const sim = run('clock-module');
    sim.action('SW3', { type: 'toggle' }); // HLT
    for (let t = 0; t < 20; t++) {
      sim.runFor(ms(100));
      expect(light(sim, 'D1')).toBe(Light.OFF);
    }
  });
});

describe('SAP-1 A Register', () => {
  /** The lights of an LED bar, most significant first, as `1`, `0` or `?`. */
  const lights = (sim: Simulator, id: string) =>
    [...(sim.stateOf(id) as LightsState).light]
      .reverse()
      .map((l) => (l === Light.ON ? '1' : l === Light.OFF ? '0' : '?'))
      .join('');
  const register = (sim: Simulator) => lights(sim, 'D3') + lights(sim, 'D2');
  const toggle = (sim: Simulator, id: string) => {
    sim.action(id, { type: 'toggle' });
    sim.runFor(ns(200));
  };
  const step = (sim: Simulator) => {
    sim.action('X1', { type: 'step' }); // one 0.5 s pulse at the default 1 Hz
    sim.runFor(ms(600));
  };

  it('clears, loads the DATA switches from the bus, and puts the register back on the bus', () => {
    const sim = run('sap-1-register');
    expect(register(sim)).toBe('????????'); // nothing cleared or loaded yet
    expect(lights(sim, 'D1')).toBe('00000000'); // nobody drives the bus: pulled down

    toggle(sim, 'SW2'); // CLR on, off
    toggle(sim, 'SW2');
    expect(register(sim)).toBe('00000000');

    toggle(sim, 'SW4'); // DATA OUT low: the switches on the bus
    expect(lights(sim, 'D1')).toBe('00101010');
    step(sim); // LOAD is high: the clock loads nothing
    expect(register(sim)).toBe('00000000');
    toggle(sim, 'SW3'); // LOAD low
    step(sim);
    expect(register(sim)).toBe('00101010');
    toggle(sim, 'SW3'); // LOAD high again
    toggle(sim, 'SW4'); // DATA OUT high: the bus is free
    expect(lights(sim, 'D1')).toBe('00000000');

    toggle(sim, 'SW5'); // A OUT low: the register drives the bus
    expect(lights(sim, 'D1')).toBe('00101010');
    expect(sim.diagnostics.entries).toEqual([]);
  });
});

/** The lights of an LED bar, the last LED (most significant bit) first: `1`, `0` or `?`. */
const lightsOf = (sim: Simulator, id: string) =>
  [...(sim.stateOf(id) as LightsState).light]
    .reverse()
    .map((l) => (l === Light.ON ? '1' : l === Light.OFF ? '0' : '?'))
    .join('');

describe('Shift Register LEDs', () => {
  /** The Johnson counter after `k` steps from 0: k ones filling from Q0, then emptying. */
  const johnson = (k: number) =>
    (k <= 8 ? (1 << k) - 1 : (0xff << (k - 8)) & 0xff).toString(2).padStart(8, '0');

  it('after CLEAR, fills the LEDs from Q0 and empties them again, one step per clock', () => {
    const sim = run('shift-register-leds');
    expect(lightsOf(sim, 'D1')).toBe('????????'); // nothing stored since power-on
    sim.action('SW2', { type: 'press' });
    sim.runFor(ms(1));
    sim.action('SW2', { type: 'release' });
    const seen = [lightsOf(sim, 'D1')];
    for (let i = 0; i < 900; i++) {
      sim.runFor(ms(10)); // 9 s at 2 Hz: 18 clock edges
      const now = lightsOf(sim, 'D1');
      if (now !== seen.at(-1)) seen.push(now);
    }
    // The storage register is one clock behind the shift register: the first store is the
    // cleared register.
    expect(seen.slice(0, 18)).toEqual([
      '????????',
      ...Array.from({ length: 17 }, (_, k) => johnson(k % 16)),
    ]);
    expect(sim.diagnostics.entries).toEqual([]);
  });

  it('turns the LEDs off while OUTPUTS is high, and keeps shifting meanwhile', () => {
    const sim = run('shift-register-leds');
    sim.action('SW2', { type: 'press' });
    sim.runFor(ms(1));
    sim.action('SW2', { type: 'release' });
    sim.runFor(ms(2000)); // four edges
    const before = lightsOf(sim, 'D1');
    const k = [...before].filter((c) => c === '1').length;
    expect(before).toBe(johnson(k));
    sim.action('SW1', { type: 'toggle' });
    sim.runFor(ms(10));
    expect(lightsOf(sim, 'D1')).toBe('00000000');
    sim.runFor(ms(1000)); // two more edges
    sim.action('SW1', { type: 'toggle' });
    sim.runFor(ms(10));
    expect(lightsOf(sim, 'D1')).toBe(johnson(k + 2));
    expect(sim.diagnostics.entries).toEqual([]);
  });
});

describe('SAP-1 Program Counter', () => {
  const toggle = (sim: Simulator, id: string) => {
    sim.action(id, { type: 'toggle' });
    sim.runFor(ns(200));
  };
  const step = (sim: Simulator) => {
    sim.action('X1', { type: 'step' }); // one 0.5 s pulse at the default 1 Hz
    sim.runFor(ms(600));
  };

  it('clears, counts, puts the count on the bus and jumps to the bus value', () => {
    const sim = run('sap-1-program-counter');
    expect(lightsOf(sim, 'D2')).toBe('????'); // nothing cleared or loaded yet
    expect(lightsOf(sim, 'D1')).toBe('0000'); // nobody drives the bus: pulled down

    toggle(sim, 'SW2'); // CLR low, high
    toggle(sim, 'SW2');
    expect(lightsOf(sim, 'D2')).toBe('0000');
    step(sim); // CE low: no count
    expect(lightsOf(sim, 'D2')).toBe('0000');
    toggle(sim, 'SW3'); // CE high
    for (let i = 0; i < 3; i++) step(sim);
    expect(lightsOf(sim, 'D2')).toBe('0011');

    toggle(sim, 'SW5'); // CO low: the counter on the bus
    expect(lightsOf(sim, 'D1')).toBe('0011');
    toggle(sim, 'SW5');
    toggle(sim, 'SW6'); // DATA OUT low: the switches on the bus
    expect(lightsOf(sim, 'D1')).toBe('1010');
    toggle(sim, 'SW4'); // J low: jump
    step(sim);
    expect(lightsOf(sim, 'D2')).toBe('1010');
    toggle(sim, 'SW4');
    toggle(sim, 'SW6');
    step(sim);
    expect(lightsOf(sim, 'D2')).toBe('1011');
    expect(sim.diagnostics.entries).toEqual([]);
  });
});
