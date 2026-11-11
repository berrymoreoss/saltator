import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  compileDesign,
  documentRegistry,
  emptyCircuit,
  emptyDocument,
  emptyVerilogCircuit,
  SCHEMA_VERSION,
} from '../circuit';
import { Simulator, us } from '../core';
import { createDefaultRegistry, fromYosys } from '../library';
import { YOSYS_FIXTURES } from '../library/hdl/fixtures';
import {
  compileJson,
  ModuleDrafts,
  memoryRows,
  messageText,
  moduleCommand,
  moduleSummary,
  placements,
  signalRows,
} from './module-view';

const decoder = fromYosys(YOSYS_FIXTURES.decoder).module!;

describe('moduleSummary', () => {
  it('lists the ports as declared and the cells by count', () => {
    const summary = moduleSummary(decoder);
    expect(summary.top).toBe('decoder');
    expect(summary.ports.map((p) => `${p.name} ${p.dir}`)).toEqual([
      'addr[15:12] in',
      'phi2 in',
      'ram_cs_n out',
      'via_cs_n out',
      'rom_cs_n out',
      'page[1:0] out',
    ]);
    expect(summary.cells).toEqual([
      ['$not', 3],
      ['$eq', 1],
      ['$logic_and', 1],
      ['$logic_not', 1],
    ]);
    expect(summary.cellCount).toBe(6);
  });
});

describe('moduleCommand', () => {
  it('names the files after the compiled top, else after the circuit', () => {
    expect(
      moduleCommand({ ...emptyVerilogCircuit('dec', 'Dec'), verilog: { module: decoder } }),
    ).toBe(
      "yosys -q -p 'read_verilog -specify decoder.v; hierarchy -auto-top; proc -norom; flatten; tribuf -logic; opt -keepdc; memory_collect; check; write_json decoder.json'",
    );
    expect(moduleCommand(emptyVerilogCircuit('address-decoder', 'Address Decoder'))).toContain(
      'read_verilog -specify address_decoder.v;',
    );
  });
});

describe('compileJson', () => {
  it('asks for the JSON when there is none', () => {
    expect(compileJson('  \n').messages[0]?.message).toBe(
      'Paste the JSON Yosys made, or import its file',
    );
  });

  it('converts what Yosys made', () => {
    expect(compileJson(YOSYS_FIXTURES.decoder!).module?.top).toBe('decoder');
  });
});

describe('placements and messages', () => {
  it('says where a module is placed', () => {
    const main = {
      ...emptyCircuit(),
      components: [
        { id: 'A1', type: 'sub/dec', x: 0, y: 0, rotation: 0 as const, flip: false, props: {} },
        { id: 'A2', type: 'sub/dec', x: 9, y: 0, rotation: 0 as const, flip: false, props: {} },
      ],
    };
    const document = { ...emptyDocument(), circuits: [main, emptyVerilogCircuit('dec', 'Dec')] };
    expect(placements(document, 'dec')).toBe('2× in Main');
    expect(placements(document, 'main')).toBe('');
    expect(messageText({ severity: 'warning', message: 'a latch', src: 'a.v:1.1-1.2' })).toBe(
      'a.v:1.1-1.2: a latch',
    );
  });

  it('keeps drafts per module until cleared', () => {
    const drafts = new ModuleDrafts();
    drafts.setText('dec', '{}');
    drafts.setMessages('dec', []);
    expect([drafts.text('dec'), drafts.text('other'), drafts.messages('other')]).toEqual([
      '{}',
      '',
      undefined,
    ]);
    drafts.clear();
    expect([drafts.text('dec'), drafts.messages('dec')]).toEqual(['', undefined]);
  });
});

describe('memoryRows (HDL-6)', () => {
  it('lists the memories with their Verilog addresses and size, by reference in an instance', () => {
    const { module } = fromYosys(YOSYS_FIXTURES.mem_offset);
    const { definition } = createDefaultRegistry().hdlPart!('hdl/m', 'M', module!);
    expect(memoryRows(definition!.memories, module!, 'A1')).toEqual([
      { name: 'm', range: '[16:25]', size: '10 × 8', src: 'mem_offset.v:3.13-3.14', ref: 'A1/m' },
    ]);
    expect(memoryRows(definition!.memories, module!, '')[0]?.ref).toBe('m');
    expect(memoryRows(definition!.memories, module!, undefined)[0]?.ref).toBeUndefined();
    expect(memoryRows(undefined, module!, 'A1')).toEqual([]);
  });
});

describe('signalRows (HDL-4)', () => {
  const registry = createDefaultRegistry();
  const { module } = fromYosys(YOSYS_FIXTURES.clocks);
  const clocks: Circuit = { ...emptyVerilogCircuit('clocks', 'Clocks'), verilog: { module } };
  const draft: CircuitDocument = { schemaVersion: SCHEMA_VERSION, circuits: [clocks] };
  const main = new CircuitBuilder(documentRegistry(draft, registry))
    .add('X1', 'io/clock', { at: [0, 0], props: { frequency: 1e6 } })
    .add('A1', 'sub/clocks', { at: [20, 0] })
    .connect('X1.Y', 'A1.clk')
    .build();
  const design = compileDesign({ ...draft, circuits: [main, clocks] }, registry);
  const view = design.registry.get('hdl/clocks')?.signals;

  it('lists the signals with their ranges and sources, named for the open instance', () => {
    const rows = signalRows(view, 'A1', undefined);
    expect(rows.map((r) => [r.name, r.range, r.ref, r.value])).toEqual([
      ['div', '', 'A1/div', undefined],
      ['rip', '[3:0]', 'A1/rip', undefined],
      ['ten', '', 'A1/ten', undefined],
    ]);
    expect(rows[0]!.src).toMatch(/^clocks\.v:\d+/);
    expect(signalRows(view, '', undefined)[1]!.ref).toBe('rip');
    expect(signalRows(view, undefined, undefined)[1]!.ref).toBeUndefined();
    expect(signalRows(undefined, 'A1', undefined)).toEqual([]);
  });

  it("reads the open instance's values while simulating", () => {
    const sim = new Simulator(design.netlist, design.registry);
    sim.runUntil(us(2.6)); // three rising edges: div 1, rip 3
    expect(signalRows(view, 'A1', sim).map((r) => r.value)).toEqual(['1', '0x3', '0']);
    // An instance the simulator doesn't run: no values.
    expect(signalRows(view, 'A9', sim).map((r) => r.value)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
