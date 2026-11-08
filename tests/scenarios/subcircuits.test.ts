/**
 * Subcircuits with real chips (R11a): a two-bit ripple counter built from two instances of a
 * 74HC74 toggle stage, itself an instance in the top circuit, simulates exactly as the same
 * chips wired flat do.
 */
import { describe, expect, it } from 'vitest';
import {
  CircuitBuilder,
  type CircuitDocument,
  compileDesign,
  documentRegistry,
  SCHEMA_VERSION,
} from '../../src/circuit';
import { type ComponentRegistry, levelChar, NetlistBuilder, ns, Simulator } from '../../src/core';
import { scenarioRegistry, set } from './support';

const library = scenarioRegistry();

/** Labels `name` (a net label, or a port with `direction`) at each given pin of `b`'s parts. */
function tie(b: CircuitBuilder, name: string, pins: string[], port?: 'in' | 'out') {
  for (const [i, pin] of pins.entries()) {
    const id = `${port ? 'P' : 'NL'}${name.replace(/\W/g, '')}${i}`;
    if (port && i === 0)
      b.add(id, 'net/port', { at: b.pin(pin), props: { name, direction: port } });
    else b.add(id, 'net/label', { at: b.pin(pin), props: { name } });
  }
}

/**
 * `toggle`: a 74HC74 whose Q̅ feeds D, so each rising CLK flips Q. Ports CLK, RST (active LOW
 * reset) in; Q, NQ out. Set and the unused flip-flop are tied to the module's own VCC and GND
 * symbols: power names, the same nets as the top's.
 */
function toggle(registry: ComponentRegistry) {
  const b = new CircuitBuilder(registry, { id: 'toggle', name: 'Toggle' });
  b.add('U1', '74xx/74hc74', { at: [10, 0] });
  b.add('PWR1', 'io/vcc', { at: [30, 0] });
  b.add('PWR2', 'io/gnd', { at: [30, 10] });
  tie(b, 'NQ', ['U1.1QN', 'U1.1D'], 'out');
  tie(b, 'VCC', ['U1.1SD', 'U1.2SD', 'U1.2RD']);
  tie(b, 'GND', ['U1.2CP', 'U1.2D']);
  tie(b, 'CLK', ['U1.1CP'], 'in');
  tie(b, 'RST', ['U1.1RD'], 'in');
  tie(b, 'Q', ['U1.1Q'], 'out');
  return b.build();
}

/** `counter`: two toggles in ripple (the second clocked by the first's Q̅): Q0, Q1. */
function counter(registry: ComponentRegistry) {
  const b = new CircuitBuilder(registry, { id: 'counter', name: 'Counter' });
  b.add('A1', 'sub/toggle', { at: [10, 0] });
  b.add('A2', 'sub/toggle', { at: [10, 20] });
  tie(b, 'CLK', ['A1.CLK'], 'in');
  tie(b, 'RST', ['A1.RST', 'A2.RST'], 'in');
  tie(b, 'RIPPLE', ['A1.NQ', 'A2.CLK']);
  tie(b, 'Q0', ['A1.Q'], 'out');
  tie(b, 'Q1', ['A2.Q'], 'out');
  return b.build();
}

/** The document: the top drives the counter from two test drivers; a VCC rail. */
function design(): CircuitDocument {
  const empty = { id: 'main', name: 'Main', components: [], wires: [], probes: [] };
  const modules = [toggle(library)];
  const withToggle = documentRegistry(
    { schemaVersion: SCHEMA_VERSION, circuits: [empty, ...modules] },
    library,
  );
  modules.push(counter(withToggle));
  const registry = documentRegistry(
    { schemaVersion: SCHEMA_VERSION, circuits: [empty, ...modules] },
    library,
  );
  const top = new CircuitBuilder(registry);
  top.add('CK', 'test/driver', { at: [0, 0] });
  top.add('RS', 'test/driver', { at: [0, 10] });
  top.add('PWR1', 'io/vcc', { at: [0, 30] });
  top.add('A1', 'sub/counter', { at: [20, 0] });
  tie(top, 'CLOCK', ['CK.Y', 'A1.CLK']);
  tie(top, 'RESET', ['RS.Y', 'A1.RST']);
  return { schemaVersion: SCHEMA_VERSION, circuits: [top.build(), ...modules] };
}

/** The same chips wired flat, as a netlist. */
function flat() {
  return new NetlistBuilder()
    .add('CK', 'test/driver')
    .add('RS', 'test/driver')
    .add('PWR1', 'io/vcc')
    .add('PWR2', 'io/gnd')
    .add('U1', '74xx/74hc74')
    .add('U2', '74xx/74hc74')
    .net('CLOCK', 'CK.Y', 'U1.1CP')
    .net('RESET', 'RS.Y', 'U1.1RD', 'U2.1RD')
    .net('VCC', 'PWR1.Y', 'U1.1SD', 'U2.1SD', 'U1.2SD', 'U2.2SD', 'U1.2RD', 'U2.2RD')
    .net('GND', 'PWR2.Y', 'U1.2CP', 'U2.2CP', 'U1.2D', 'U2.2D')
    .net('FB1', 'U1.1QN', 'U1.1D', 'U2.1CP')
    .net('FB2', 'U2.1QN', 'U2.1D')
    .build();
}

/** Q0 Q1 after a reset and each of `n` clock pulses, as `'00'`, `'10'`, … */
function count(sim: Simulator, q0: [string, string], q1: [string, string], n: number): string[] {
  const read = () => levelChar(sim.pinLevel(...q0)) + levelChar(sim.pinLevel(...q1));
  set(sim, 'CK', 0);
  set(sim, 'RS', 0);
  sim.runUntil(sim.now + ns(100));
  set(sim, 'RS', 1);
  sim.runUntil(sim.now + ns(100));
  const seen = [read()];
  for (let i = 0; i < n; i++) {
    set(sim, 'CK', 1);
    sim.runUntil(sim.now + ns(100));
    set(sim, 'CK', 0);
    sim.runUntil(sim.now + ns(100));
    seen.push(read());
  }
  return seen;
}

describe('subcircuits with real chips', () => {
  it('flatten two levels of instances into the chips, by path', () => {
    const result = compileDesign(design(), library);
    expect(result.netlist.components.map((c) => c.id)).toEqual([
      'CK',
      'RS',
      'PWR1',
      'A1/A1/U1',
      'A1/A1/PWR1',
      'A1/A1/PWR2',
      'A1/A2/U1',
      'A1/A2/PWR1',
      'A1/A2/PWR2',
    ]);
    expect(result.issues.map((i) => `${i.circuit}: ${i.message}`)).toEqual([]);
    // The toggles' own VCC symbols and set inputs are on the top's VCC.
    const vcc = result.netlist.nets.find((n) => n.id === 'VCC')!;
    expect(vcc.pins.map((p) => `${p.component}.${p.pin}`)).toEqual([
      'PWR1.Y',
      'A1/A1/U1.1SD',
      'A1/A1/U1.2SD',
      'A1/A1/U1.2RD',
      'A1/A1/PWR1.Y',
      'A1/A2/U1.1SD',
      'A1/A2/U1.2SD',
      'A1/A2/U1.2RD',
      'A1/A2/PWR1.Y',
    ]);
    // Each toggle keeps its own feedback net; the first one's is the counter's RIPPLE.
    expect(result.netOf('A1/A1', 'NQ')).toBe('A1/RIPPLE');
    expect(result.netOf('A1/A2', 'NQ')).toBe('A1/A2.NQ');
  });

  it('count like the same chips wired flat', () => {
    const result = compileDesign(design(), library);
    const nested = new Simulator(result.netlist, result.registry);
    const reference = new Simulator(flat(), library);
    const seen = count(nested, ['A1/A1/U1', '1Q'], ['A1/A2/U1', '1Q'], 5);
    expect(seen).toEqual(['00', '10', '01', '11', '00', '10']);
    expect(count(reference, ['U1', '1Q'], ['U2', '1Q'], 5)).toEqual(seen);
    expect(nested.now).toBe(reference.now);
  });
});
