/**
 * Verilog modules (HDL-1) across the layers: a document's module, its IR converted from Yosys's
 * JSON (the fixtures), run by the library's interpreter — its own benches with the module as the
 * top, and a module compiled again while it runs (the editor's carry-over).
 */
import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  type CircuitDocument,
  emptyCircuit,
  emptyVerilogCircuit,
  functionScriptHost,
  runTestScript,
  SCHEMA_VERSION,
  scriptLines,
} from '../../src/circuit';
import {
  type AnyComponentDefinition,
  type HdlModule,
  Level,
  levelChar,
  NetlistBuilder,
  Registry,
  Simulator,
  strong,
  us,
} from '../../src/core';
import { testDriver } from '../../src/core/testing';
import { createDefaultRegistry, fromYosys, hdlPart } from '../../src/library';
import { YOSYS_FIXTURES } from '../../src/library/hdl/fixtures';

const library = createDefaultRegistry();
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

const doc = (...circuits: Circuit[]): CircuitDocument => ({
  schemaVersion: SCHEMA_VERSION,
  circuits: [emptyCircuit(), ...circuits],
});

describe("a module's own benches", () => {
  it('drive its ports and check its outputs, buses included', () => {
    const script = `
bench('selects RAM, VIA and ROM by address', (b) => {
  b.table\`
    addr[15..12] phi2 | ram_cs_n via_cs_n rom_cs_n page[1..0]
    0x0          1    | 0        1        1        0
    0x3          1    | 0        1        1        3
    0x3          0    | 1        1        1        3
    0x6          1    | 1        0        1        2
    0x7          1    | 1        0        1        3
    0x8          1    | 1        1        0        0
    0xF          0    | 1        1        0        3
  \`;
});

bench('waits for its delay', (b) => {
  b.set({ 'addr[15..12]': 0x8, phi2: 1 });
  b.wait('14ns');
  b.expect({ rom_cs_n: 'unknown' });
  b.wait('1ns');
  b.expect({ rom_cs_n: 0 });
});`;
    const document = doc(verilog('decoder', 'Decoder', moduleOf('decoder'), script));
    const { error, results } = runTestScript(document, 'decoder', library, host);
    expect(error).toBeUndefined();
    expect(results.map((r) => [r.name, r.status, r.failures])).toEqual([
      ['selects RAM, VIA and ROM by address', 'pass', []],
      ['waits for its delay', 'pass', []],
    ]);
  });

  it('clock a counter through its pulses', () => {
    const script = `
bench('counts', (b) => {
  b.row({ rst: 1, en: 1, clk: 0 }, { 'q[3..0]': 0, co: 0 });
  b.set({ rst: 0 });
  for (let n = 1; n <= 10; n++) b.row({ clk: 'C' }, { 'q[3..0]': n % 10, co: n % 10 === 9 ? 1 : 0 });
});`;
    const { results } = runTestScript(
      doc(verilog('counter', 'Counter', moduleOf('counter'), script)),
      'counter',
      library,
      host,
    );
    expect(results.map((r) => [r.status, r.failures])).toEqual([['pass', []]]);
  });

  it('run on a module not compiled yet (a warning, not an error): it has no ports', () => {
    const { results } = runTestScript(
      {
        ...doc(),
        circuits: [
          emptyCircuit(),
          { ...emptyVerilogCircuit('v', 'V'), testScript: ["bench('nothing', () => {});"] },
        ],
      },
      'v',
      library,
      host,
    );
    expect(results.map((r) => r.status)).toEqual(['pass']);
  });
});

describe('a module compiled again while it runs', () => {
  /** A counter clocked by a driver, as the editor's carry-over would continue it. */
  function run(definition: AnyComponentDefinition, carry?: ReturnType<Simulator['carryOver']>) {
    const builder = new NetlistBuilder().add('U1', definition.type);
    for (const pin of ['clk', 'rst', 'en']) {
      builder.add(`drv:${pin}`, testDriver.type).net(pin, `U1.${pin}`, `drv:${pin}.Y`);
    }
    builder.add('drv:other', testDriver.type).net('other', 'drv:other.Y');
    for (let i = 0; i < 4; i++) builder.net(`q${i}`, `U1.q${i}`);
    const registry = new Registry([definition, testDriver]);
    return new Simulator(builder.build(), registry, carry ? { carry } : {});
  }
  const q = (sim: Simulator) =>
    [3, 2, 1, 0].map((i) => levelChar(sim.pinLevel('U1', `q${i}`))).join('');
  const pulse = (sim: Simulator) => {
    sim.action('drv:clk', strong(Level.L1));
    sim.runFor(us(1));
    sim.action('drv:clk', strong(Level.L0));
    sim.runFor(us(1));
  };

  it('restarts the module from power-on, its outputs held until it drives anew', () => {
    const module = moduleOf('counter');
    const first = hdlPart('hdl/counter', 'Counter', module).definition!;
    const sim = run(first);
    for (const [pin, level] of [
      ['clk', Level.L0],
      ['rst', Level.L1],
      ['en', Level.L1],
      ['other', Level.L1],
    ] as const) {
      sim.action(`drv:${pin}`, strong(level));
    }
    sim.runFor(us(1));
    sim.action('drv:rst', strong(Level.L0));
    pulse(sim);
    pulse(sim);
    expect(q(sim)).toBe('0010');

    // The same definition: the state carries over, the count goes on.
    const same = run(first, sim.carryOver());
    pulse(same);
    expect(q(same)).toBe('0011');

    // Compiled again (a new definition from the same IR): power-on, the flip-flops unknown.
    const again = hdlPart('hdl/counter', 'Counter', { ...module }).definition!;
    const next = run(again, same.carryOver());
    expect(q(next)).toBe('0011'); // held until the module's first drives land
    expect(levelChar(next.level('other'))).toBe('1');
    next.runFor(us(1));
    expect(q(next)).toBe('XXXX');
    expect(levelChar(next.level('other'))).toBe('1');
  });
});
