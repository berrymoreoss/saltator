/**
 * Verilog modules on a bus (HDL-8) across the layers: an I/O port written and read through its
 * data bus by its own bench, and tri-state modules sharing a bus in a document — with each
 * other and with a 74HC244 — handing it over, `contention` when two drive.
 */
import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  compileDesign,
  documentRegistry,
  emptyCircuit,
  emptyVerilogCircuit,
  functionScriptHost,
  runTestScript,
  SCHEMA_VERSION,
  scriptLines,
} from '../../src/circuit';
import { type HdlModule, ns, Simulator } from '../../src/core';
import { fromYosys } from '../../src/library';
import { YOSYS_FIXTURES } from '../../src/library/hdl/fixtures';
import { kinds, levels, scenarioRegistry, set } from './support';

const library = scenarioRegistry();
const host = functionScriptHost();

function moduleOf(name: string): HdlModule {
  const { module } = fromYosys(YOSYS_FIXTURES[name]);
  if (!module) throw new Error(`fixture ${name} doesn't convert`);
  return module;
}

const verilog = (id: string, name: string, module: HdlModule, script = ''): Circuit => ({
  ...emptyVerilogCircuit(id, name),
  verilog: { module },
  testScript: scriptLines(script),
});

describe('an I/O port on its data bus', () => {
  const run = (script: string) => {
    const document: CircuitDocument = {
      schemaVersion: SCHEMA_VERSION,
      circuits: [emptyCircuit(), verilog('port', 'Port', moduleOf('io_port'), script)],
    };
    const { error, results } = runTestScript(document, 'port', library, host);
    expect(error).toBeUndefined();
    return results.map((r) => [r.name, r.status, r.failures.map((f) => f.message)]);
  };

  it('is written and read through the bus by a bench', () => {
    const script = `
bench('writes $A5, reads its pins', (b) => {
  b.set({ strobe: 0, cs_n: 1, rw: 1, 'pins[7..0]': 0x3c, 'd[7..0]': 'Z' });
  b.wait('1us');
  // A write: the data on the bus while the strobe is HIGH, loaded when it falls.
  b.set({ cs_n: 0, rw: 0, 'd[7..0]': 0xa5 });
  b.wait('1us');
  b.clock('strobe');
  b.expect({ 'q[7..0]': 0xa5 });
  // A read: the bench lets go of the bus, the port drives it while the strobe is HIGH.
  b.set({ rw: 1, 'd[7..0]': 'Z' });
  b.wait('1us');
  b.expect({ 'd[7..0]': '0xZZ' });
  b.set({ strobe: 1 });
  b.wait('1us');
  b.expect({ 'd[7..0]': 0x3c });
  b.set({ strobe: 0 });
  b.wait('1us');
  b.expect({ 'd[7..0]': '0xZZ', 'q[7..0]': 0xa5 });
});`;
    expect(run(script)).toEqual([['writes $A5, reads its pins', 'pass', []]]);
  });

  it('fails a bench that drives the bus while the port does: contention', () => {
    const script = `
bench('drives during a read', (b) => {
  b.set({ strobe: 1, cs_n: 0, rw: 1, 'pins[7..0]': 0x0f, 'd[7..0]': 0xf0 });
  b.wait('1us');
});`;
    const [[name, status, failures]] = run(script) as [[string, string, string[]]];
    expect([name, status]).toEqual(['drives during a read', 'fail']);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((f) => f.includes('bus contention'))).toBe(true);
  });
});

describe('tri-state modules sharing a bus', () => {
  /** `buf`: y = oe ? a : z, one bit. */
  const buffer: HdlModule = {
    format: 1,
    top: 'buf',
    creator: '',
    bitCount: 3,
    ports: [
      { name: 'oe', dir: 'in', lsb: 0, bits: [0] },
      { name: 'a', dir: 'in', lsb: 0, bits: [1] },
      { name: 'y', dir: 'out', lsb: 0, bits: [2] },
    ],
    signals: [],
    cells: [{ type: '$tribuf', src: '', ports: { A: [1], EN: [0], Y: [2] }, params: {} }],
  };

  /** Labels `name` at each given pin. */
  function tie(b: CircuitBuilder, name: string, pins: string[]) {
    for (const [i, pin] of pins.entries()) {
      b.add(`NL${name}${i}`, 'net/label', { at: b.pin(pin), props: { name } });
    }
  }

  /** Two buffer modules and a 74HC244's first gate on BUS, each fed by test drivers. */
  function design(): CircuitDocument {
    const module = verilog('buf', 'Buf', buffer);
    const registry = documentRegistry(
      { schemaVersion: SCHEMA_VERSION, circuits: [emptyCircuit(), module] },
      library,
    );
    const top = new CircuitBuilder(registry);
    top.add('A1', 'sub/buf', { at: [20, 0] });
    top.add('A2', 'sub/buf', { at: [20, 20] });
    top.add('U1', '74xx/74hc244', { at: [20, 40] });
    for (const [i, id] of ['OE1', 'D1', 'OE2', 'D2', 'OE3', 'D3'].entries()) {
      top.add(id, 'test/driver', { at: [0, i * 10] });
    }
    tie(top, 'OE1', ['OE1.Y', 'A1.oe']);
    tie(top, 'D1', ['D1.Y', 'A1.a']);
    tie(top, 'OE2', ['OE2.Y', 'A2.oe']);
    tie(top, 'D2', ['D2.Y', 'A2.a']);
    tie(top, 'OE3', ['OE3.Y', 'U1.1OE']);
    tie(top, 'D3', ['D3.Y', 'U1.1A0']);
    tie(top, 'BUS', ['A1.y', 'A2.y', 'U1.1Y0']);
    return { schemaVersion: SCHEMA_VERSION, circuits: [top.build(), module] };
  }

  it('compile without design errors, their pins on the bus by instance path', () => {
    // (`shorted-outputs` looks at one circuit's own parts, never into instances.)
    const result = compileDesign(design(), library);
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const bus = result.netlist.nets.find((n) => n.id === 'BUS')!;
    expect(bus.pins.map((p) => `${p.component}.${p.pin}`)).toEqual([
      'U1.1Y0',
      'A1/U1.y',
      'A2/U1.y',
    ]);
  });

  it('hand the bus over, and fight for it when two drive: contention', () => {
    const result = compileDesign(design(), library);
    const sim = new Simulator(result.netlist, result.registry);
    const step = () => sim.runUntil(sim.now + ns(100));
    for (const driver of ['OE1', 'OE2']) set(sim, driver, 0);
    set(sim, 'OE3', 1); // the 244's enable is active LOW
    for (const [driver, value] of [
      ['D1', 1],
      ['D2', 0],
      ['D3', 1],
    ] as const) {
      set(sim, driver, value);
    }
    step();
    expect(levels(sim, 'BUS')).toBe('Z');
    set(sim, 'OE1', 1);
    step();
    expect(levels(sim, 'BUS')).toBe('1');
    // A1 lets go, A2 takes the bus.
    set(sim, 'OE1', 0);
    set(sim, 'OE2', 1);
    step();
    expect(levels(sim, 'BUS')).toBe('0');
    // A2 lets go, then the 244 takes the bus: at once it would fight A2 for a few ns, as the
    // 244 enables faster than the module releases.
    set(sim, 'OE2', 0);
    step();
    set(sim, 'OE3', 0);
    step();
    expect(levels(sim, 'BUS')).toBe('1');
    // Only the 244's unused gates float.
    const unused = sim.diagnostics.entries.filter((d) => d.kind === 'floating-input');
    expect(unused.every((d) => d.component === 'U1' && d.pin !== '1A0')).toBe(true);
    expect(kinds(sim).filter((k) => k !== 'floating-input')).toEqual([]);
    // A2 drives 0 while the 244 drives 1.
    set(sim, 'OE2', 1);
    step();
    expect(levels(sim, 'BUS')).toBe('X');
    expect(
      sim.diagnostics.entries.filter((d) => d.kind === 'contention').map((d) => d.net),
    ).toEqual(['BUS']);
  });
});
