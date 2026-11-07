/**
 * Buses in circuits: bus entries join two 74HC245s bit by bit over a bus line named by a bus
 * label, the bus carries no level of its own (its members are nets named D0…D7), and bus edits
 * never touch the netlist.
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder, compileDocument, type PlaceOptions, type Point } from '../../src/circuit';
import { busValueText, Simulator, sameNetlistStructure } from '../../src/core';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry();

/** Adds a part so that its pin `pin` lands on `target` (flipped parts move the other way). */
function placeBy(
  builder: CircuitBuilder,
  id: string,
  type: string,
  pin: string,
  target: Point,
  options: Omit<PlaceOptions, 'at'> = {},
): CircuitBuilder {
  const probe = new CircuitBuilder(registry).add(id, type, { ...options, at: [0, 0] });
  const [dx, dy] = probe.pin(`${id}.${pin}`);
  return builder.add(id, type, { ...options, at: [target[0] - dx, target[1] - dy] });
}

/** A net label of `name` on a pin. */
function tie(builder: CircuitBuilder, id: string, pin: string, name: string): CircuitBuilder {
  return builder.add(id, 'net/label', { at: builder.pin(pin), props: { name } });
}

/**
 * U1 (74HC245, A → B) puts 0x3F on its B side from labels VCC/GND on its A pins; entries D0…D7 on
 * U1.B0…B7 and on U2.A0…A7 (flipped) share one bus line labeled D[0..7]; U2 passes it to its B
 * side.
 */
function twoChips(options: { label?: string; extraBus?: boolean } = {}) {
  const b = new CircuitBuilder(registry)
    .add('U1', '74xx/74hc245', { at: [0, 0] })
    .add('U2', '74xx/74hc245', { at: [30, 0] })
    .add('PWR1', 'io/vcc', { at: [0, -8] })
    .add('PWR2', 'io/gnd', { at: [4, -8] });
  let labels = 0;
  const label = (pin: string, name: string) => {
    tie(b, `NL${++labels}`, pin, name);
  };
  for (const chip of ['U1', 'U2']) {
    label(`${chip}.DIR`, 'VCC');
    label(`${chip}.OE`, 'GND');
  }
  for (let bit = 0; bit < 8; bit++) label(`U1.A${bit}`, bit < 6 ? 'VCC' : 'GND');
  for (let bit = 0; bit < 8; bit++) {
    const name = { name: `D${bit}` };
    b.add(`BE${bit + 1}`, 'net/bus-entry', { at: b.pin(`U1.B${bit}`), props: name });
    placeBy(b, `BE${bit + 11}`, 'net/bus-entry', 'N', b.pin(`U2.A${bit}`), {
      flip: true,
      props: name,
    });
  }
  const [x1] = b.pin('BE1.B');
  const [x2, top2] = b.pin('BE11.B');
  b.bus('BE1.B', [x1, 14], [x2, 14], [x2, top2]);
  b.add('BL1', 'net/label', { at: [18, 14], props: { name: options.label ?? 'D[0..7]' } });
  if (options.extraBus) b.bus([x2, 14], [x2, 20]).bus([18, 20], [x2, 20]);
  return b;
}

describe('buses', () => {
  it('place an entry by its bit end, its bus end one cell down and three across', () => {
    const b = new CircuitBuilder(registry);
    b.add('BE1', 'net/bus-entry', { at: [10, 4] });
    expect([b.pin('BE1.N'), b.pin('BE1.B')]).toEqual([
      [10, 4],
      [13, 5],
    ]);
    placeBy(b, 'BE2', 'net/bus-entry', 'N', [10, 8], { flip: true });
    expect([b.pin('BE2.N'), b.pin('BE2.B')]).toEqual([
      [10, 8],
      [7, 9],
    ]);
  });

  it('join two chips bit by bit through entries named D0…D7', () => {
    const result = compileDocument(twoChips().document(), registry);
    expect(result.issues).toEqual([]);
    const [bus] = result.buses;
    expect(result.buses).toHaveLength(1);
    expect(bus!.id).toBe('D[0..7]');
    expect(bus!.members).toEqual(['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']);
    expect(bus!.pins).toHaveLength(17); // 16 entries and the label
    for (let bit = 0; bit < 8; bit++) {
      const net = result.nets.find((n) => n.id === `D${bit}`)!;
      expect(net.pins.map((p) => `${p.component}.${p.pin}`)).toEqual([`U1.B${bit}`, `U2.A${bit}`]);
    }
    expect(result.netlist.components.map((c) => c.id)).toEqual(['U1', 'U2', 'PWR1', 'PWR2']);

    const sim = new Simulator(result.netlist, registry);
    sim.settle();
    expect(busValueText(bus!.members.map((m) => sim.level(m)))).toBe('0x3F');
    const out = Array.from({ length: 8 }, (_, bit) => sim.pinLevel('U2', `B${bit}`));
    expect(busValueText(out)).toBe('0x3F');
  });

  it('never change the netlist: more bus lines, a renamed bus label', () => {
    const before = compileDocument(twoChips().document(), registry);
    for (const after of [
      compileDocument(twoChips({ extraBus: true }).document(), registry),
      compileDocument(twoChips({ label: 'DATA[0..7]' }).document(), registry),
    ]) {
      expect(sameNetlistStructure(before.netlist, after.netlist)).toBe(true);
    }
    const renamed = compileDocument(twoChips({ label: 'A[0..7]' }).document(), registry);
    expect(renamed.buses.map((b) => b.id)).toEqual(['A[0..7]']);
    expect(renamed.issues.map((i) => i.code)).toEqual(Array(16).fill('bus-entry-member'));
  });
});
