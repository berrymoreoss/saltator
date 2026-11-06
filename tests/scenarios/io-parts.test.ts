/**
 * The M1 circuits, headless: IO parts drawn into documents, compiled and simulated — switch →
 * gate → LED, clock → LED, a button with and without its pull-down, a DIP switch on a hex
 * display — plus a multiplexed 4-digit 7-segment display and its average brightness.
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder, type CircuitDocument, compileDocument } from '../../src/circuit';
import { Level, ms, NetlistBuilder, ns, Simulator, us } from '../../src/core';
import { Trace } from '../../src/core/testing';
import {
  createDefaultRegistry,
  hexDigit,
  Light,
  type LightsState,
  onTimeAt,
} from '../../src/library';

const registry = createDefaultRegistry();

// Pin positions of parts placed at (x, y):
//   io/switch, io/button, io/clock: Y (x+4, y+1)
//   io/vcc: Y (x+1, y+2)         io/gnd: Y (x+1, y)
//   io/led: A (x, y+1), K (x+4, y+1)
//   io/dip-switch: S1…Sn (x+4, y+1…y+n)
//   io/hex-display: D3, D2, D1, D0 (x+1…x+4, y+8)
//   prim/nand: A (x, y+1), B (x, y+3), Y (x+6, y+2)
//   prim/not: A (x, y+1), Y (x+5, y+1)
//   prim/pull (down): Y (x+1, y)

/** Compiles a document that must be free of design issues and builds its simulator. */
function simulate(document: CircuitDocument): Simulator {
  const result = compileDocument(document, registry);
  expect(result.issues).toEqual([]);
  return new Simulator(result.netlist, registry);
}

const light = (sim: Simulator, id: string, i = 0) => (sim.stateOf(id) as LightsState).light[i];

describe('IO parts in circuits', () => {
  it('switch → NAND → LED: the LED follows the switch one gate delay later', () => {
    // A NAND with one input tied to VCC is an inverter: the LED is lit while the switch is off.
    const sim = simulate(
      new CircuitBuilder(registry)
        .add('SW1', 'io/switch', { at: [0, 0] })
        .add('U1', 'prim/nand', { at: [10, 0] })
        .add('V1', 'io/vcc', { at: [7, -4] })
        .add('D1', 'io/led', { at: [20, 0], props: { color: 'green' } })
        .add('G1', 'io/gnd', { at: [26, 1] })
        .connect('SW1.Y', 'U1.A')
        .connect('V1.Y', 'U1.B', [8, 3]) // crosses the SW1 → U1.A wire at (8, 1)
        .connect('U1.Y', 'D1.A', [18, 2], [18, 1])
        .connect('D1.K', 'G1.Y')
        .document(),
    );
    sim.settle();
    expect(light(sim, 'D1')).toBe(Light.ON);

    const trace = new Trace(sim);
    sim.runFor(us(1));
    const t = sim.now;
    sim.action('SW1', { type: 'toggle' });
    sim.settle();
    expect(light(sim, 'D1')).toBe(Light.OFF);
    expect(trace.lines()).toEqual([`${t} SW1.Y=1`, `${t + ns(1)} U1.Y=0`]);
    expect((sim.stateOf('D1') as LightsState).since[0]).toBe(t + ns(1));

    sim.action('SW1', { type: 'toggle' });
    sim.settle();
    expect(light(sim, 'D1')).toBe(Light.ON);
    expect(sim.diagnostics.entries).toEqual([]);
  });

  it('clock → LED: blinks with the configured period and duty', () => {
    const sim = simulate(
      new CircuitBuilder(registry)
        .add('CLK1', 'io/clock', { at: [0, 0], props: { frequency: 1000, duty: 25 } })
        .add('D1', 'io/led', { at: [8, 0] })
        .add('G1', 'io/gnd', { at: [14, 1] })
        .connect('CLK1.Y', 'D1.A')
        .connect('D1.K', 'G1.Y')
        .document(),
    );
    const trace = new Trace(sim);
    sim.runUntil(ms(3) - 1);
    // 1 kHz, 25 %: low 750 µs, then high 250 µs, every millisecond.
    expect(trace.of('CLK1.Y').map(([t, level]) => [t, level])).toEqual([
      [0, Level.L0],
      [us(750), Level.L1],
      [ms(1), Level.L0],
      [us(1750), Level.L1],
      [ms(2), Level.L0],
      [us(2750), Level.L1],
    ]);
    const state = sim.stateOf('D1') as LightsState;
    expect(onTimeAt(state, 0, sim.now)).toBe(us(250) * 3 - 1);
  });

  describe('a button on a CMOS input', () => {
    /** BTN1 (SPST to VCC) → N1 (inverter), optionally with a pull-down on the line. */
    function buttonCircuit(pullDown: boolean): Simulator {
      const b = new CircuitBuilder(registry)
        .add('BTN1', 'io/button', { at: [0, 0] })
        .add('N1', 'prim/not', { at: [10, 0] })
        .connect('BTN1.Y', 'N1.A');
      // The pull-down's pin lands on the wire's interior at (7, 1): a T-junction.
      if (pullDown) b.add('R1', 'prim/pull', { at: [6, 1], props: { direction: 'down' } });
      return simulate(b.document());
    }

    const press = (sim: Simulator, type: 'press' | 'release') => {
      sim.action('BTN1', { type });
      sim.settle();
      return sim.level('N1.Y');
    };

    it('without a pull-down, the input floats while the button is released', () => {
      const sim = buttonCircuit(false);
      sim.settle();
      expect(sim.level('N1.Y')).toBe(Level.X);
      expect(press(sim, 'press')).toBe(Level.L0);
      expect(press(sim, 'release')).toBe(Level.X);
      expect(sim.diagnostics.entries.map((d) => [d.kind, d.component, d.pin, d.count])).toEqual([
        ['floating-input', 'N1', 'A', 2], // at power-on and after the release
      ]);
    });

    it('with a pull-down, it reads 0 while released and 1 while pressed', () => {
      const sim = buttonCircuit(true);
      sim.settle();
      expect(sim.level('N1.Y')).toBe(Level.L1);
      expect(press(sim, 'press')).toBe(Level.L0);
      expect(press(sim, 'release')).toBe(Level.L1);
      expect(sim.diagnostics.entries).toEqual([]);
    });
  });

  it('DIP switch → hex display', () => {
    // S1…S4 run right, then up to D0…D3; the risers cross the other rows without connecting.
    const draw = (props: Record<string, number | string>) =>
      new CircuitBuilder(registry)
        .add('SW1', 'io/dip-switch', { at: [0, 0], props: { count: 4, ...props } })
        .add('HEX1', 'io/hex-display', { at: [10, -8] })
        .connect('SW1.S1', 'HEX1.D0')
        .connect('SW1.S2', 'HEX1.D1')
        .connect('SW1.S3', 'HEX1.D2')
        .connect('SW1.S4', 'HEX1.D3')
        .document();
    const digit = (sim: Simulator) =>
      hexDigit(['D0', 'D1', 'D2', 'D3'].map((pin) => sim.pinLevel('HEX1', pin)));

    const sim = simulate(draw({ contact: 'spdt', on: 0b1011 }));
    sim.settle();
    expect(digit(sim)).toBe(0xb);
    sim.action('SW1', { type: 'toggle', index: 2 });
    sim.settle();
    expect(digit(sim)).toBe(0xf);

    // SPST without pull resistors: open switches float; the display shows "unknown" and, as a
    // sense-only part, raises no floating-input diagnostics.
    const floating = simulate(draw({ contact: 'spst-vcc', on: 0b0001 }));
    floating.settle();
    expect(digit(floating)).toBeUndefined();
    expect(floating.pinLevel('HEX1', 'D1')).toBe(Level.Z);
    expect(floating.diagnostics.entries).toEqual([]);
  });

  it('a 4-digit 7-segment display multiplexed at 1 kHz lights each digit 25 % of the time', () => {
    // Two clocks (1 kHz, 2 kHz) count 00, 01, 10, 11 every millisecond; four NANDs decode the
    // count into active-low digit selects that drive the common cathodes. Every digit shows
    // segment a only (a to VCC, b…g to GND, dp unconnected).
    const b = new NetlistBuilder()
      .add('CA', 'io/clock', { frequency: 1000 })
      .add('CB', 'io/clock', { frequency: 2000 })
      .add('NA', 'prim/not')
      .add('NB', 'prim/not')
      .add('V', 'io/vcc')
      .add('G', 'io/gnd')
      .connect('CA.Y', 'NA.A')
      .connect('CB.Y', 'NB.A');
    const selects = [
      ['NA.Y', 'NB.Y'],
      ['NA.Y', 'CB.Y'],
      ['CA.Y', 'NB.Y'],
      ['CA.Y', 'CB.Y'],
    ] as const;
    selects.forEach(([a, bIn], i) => {
      b.add(`U${i}`, 'prim/nand')
        .add(`DS${i}`, 'io/seven-segment')
        .connect(a, `U${i}.A`)
        .connect(bIn, `U${i}.B`)
        .connect(`U${i}.Y`, `DS${i}.COM`)
        .connect('V.Y', `DS${i}.a`)
        .connect('G.Y', ...['b', 'c', 'd', 'e', 'f', 'g'].map((s) => `DS${i}.${s}`));
    });
    const sim = new Simulator(b.build(), registry);

    sim.runUntil(ms(1));
    const lit = (i: number, segment: number) =>
      onTimeAt(sim.stateOf(`DS${i}`) as LightsState, segment, sim.now);
    const start = [0, 1, 2, 3].map((i) => lit(i, 0));
    sim.runUntil(ms(5));
    for (let i = 0; i < 4; i++) {
      // 25 % of 4 ms, give or take the decoder's gate delays at the transitions.
      expect(Math.abs(lit(i, 0) - start[i]! - ms(1)), `digit ${i}`).toBeLessThanOrEqual(ns(10));
      expect(lit(i, 1), `digit ${i} segment b`).toBe(0);
    }
    expect(sim.diagnostics.entries).toEqual([]);
  });
});
