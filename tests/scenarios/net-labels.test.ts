/**
 * Net labels in circuits: labels of one name join distant parts (the roadmap's switches → labels
 * → gate circuit), a label named VCC joins the supply, and labels stay out of the netlist.
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder, compileDocument } from '../../src/circuit';
import { Level, Simulator, sameNetlistStructure, us } from '../../src/core';
import { createDefaultRegistry, Light, type LightsState } from '../../src/library';

const registry = createDefaultRegistry();

// Pin positions of parts placed at (x, y):
//   io/switch: Y (x+4, y+1)      net/label: N (x, y)
//   io/vcc: Y (x+1, y+2)         io/gnd: Y (x+1, y)
//   io/led: A (x, y+1), K (x+4, y+1)
//   prim/nand: A (x, y+1), B (x, y+3), Y (x+6, y+2)

/** Switches A, B on the left; far to the right, labels A, B into a NAND driving an LED. */
function blocks(names: { a2?: string } = {}) {
  return new CircuitBuilder(registry)
    .add('SW1', 'io/switch', { at: [0, 0] })
    .add('SW2', 'io/switch', { at: [0, 4] })
    .add('NL1', 'net/label', { at: [7, 1], props: { name: 'A' } })
    .add('NL2', 'net/label', { at: [7, 5], props: { name: 'B' } })
    .wire('SW1.Y', [7, 1])
    .wire('SW2.Y', [7, 5])
    .add('NL3', 'net/label', { at: [30, 1], props: { name: names.a2 ?? 'A' } })
    .add('NL4', 'net/label', { at: [30, 3], props: { name: 'B' } })
    .add('U1', 'prim/nand', { at: [34, 0] })
    .add('D1', 'io/led', { at: [44, 1] })
    .add('G1', 'io/gnd', { at: [50, 2] })
    .wire([30, 1], 'U1.A')
    .wire([30, 3], 'U1.B')
    .connect('U1.Y', 'D1.A')
    .connect('D1.K', 'G1.Y');
}

const light = (sim: Simulator) => (sim.stateOf('D1') as LightsState).light[0];

describe('net labels', () => {
  it('join switches to a gate far away: the LED follows them', () => {
    const result = compileDocument(blocks().document(), registry);
    expect(result.issues).toEqual([]);
    const pinsOf = (id: string) =>
      result.nets.find((n) => n.id === id)!.pins.map((p) => `${p.component}.${p.pin}`);
    expect(pinsOf('A')).toEqual(['SW1.Y', 'U1.A']);
    expect(pinsOf('B')).toEqual(['SW2.Y', 'U1.B']);
    expect(result.netlist.components.map((c) => c.id)).toEqual(['SW1', 'SW2', 'U1', 'D1', 'G1']);

    const sim = new Simulator(result.netlist, registry);
    sim.settle();
    expect(light(sim)).toBe(Light.ON); // NAND(0, 0) = 1
    sim.action('SW1', { type: 'toggle' });
    sim.runFor(us(1));
    expect(sim.level('A')).toBe(Level.L1);
    expect(light(sim)).toBe(Light.ON); // NAND(1, 0) = 1
    sim.action('SW2', { type: 'toggle' });
    sim.runFor(us(1));
    expect(light(sim)).toBe(Light.OFF); // NAND(1, 1) = 0
  });

  it('keep the netlist structure unless a label changes which pins share a net', () => {
    const before = compileDocument(blocks().document(), registry).netlist;
    const extra = blocks().add('NL5', 'net/label', { at: [20, 20], props: { name: 'A' } });
    expect(sameNetlistStructure(before, compileDocument(extra.document(), registry).netlist)).toBe(
      true,
    );
    const renamed = compileDocument(blocks({ a2: 'C' }).document(), registry);
    expect(sameNetlistStructure(before, renamed.netlist)).toBe(false);
    // A now ends at NL1, C at NL3, and U1.A reads nothing.
    expect(renamed.issues.map((i) => `${i.code} ${i.component}`)).toEqual([
      'undriven-input U1',
      'single-net-label NL1',
      'single-net-label NL3',
    ]);
  });

  it('named VCC, join the supply rail', () => {
    // A label VCC on U1.B ties it high through the V1 symbol far away.
    const result = compileDocument(
      new CircuitBuilder(registry)
        .add('V1', 'io/vcc', { at: [0, 0] })
        .add('SW1', 'io/switch', { at: [10, 0] })
        .add('U1', 'prim/nand', { at: [20, 0] })
        .add('NL1', 'net/label', { at: [17, 3], props: { name: 'VCC' } })
        .add('D1', 'io/led', { at: [30, 1] })
        .add('G1', 'io/gnd', { at: [36, 2] })
        .connect('SW1.Y', 'U1.A')
        .wire([17, 3], 'U1.B')
        .connect('U1.Y', 'D1.A')
        .connect('D1.K', 'G1.Y')
        .document(),
      registry,
    );
    expect(result.issues).toEqual([]);
    const vcc = result.nets.find((n) => n.id === 'VCC')!;
    expect(vcc.pins.map((p) => `${p.component}.${p.pin}`)).toEqual(['V1.Y', 'U1.B']);
    const sim = new Simulator(result.netlist, registry);
    sim.settle();
    expect(sim.level('VCC')).toBe(Level.L1);
  });
});
