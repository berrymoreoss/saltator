import { describe, expect, it } from 'vitest';
import { emptyCircuit, emptyDocument, emptyVerilogCircuit } from '../circuit';
import { fromYosys } from '../library';
import { YOSYS_FIXTURES } from '../library/hdl/fixtures';
import {
  compileJson,
  ModuleDrafts,
  messageText,
  moduleCommand,
  moduleSummary,
  placements,
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
      "yosys -q -p 'read_verilog decoder.v; hierarchy -auto-top; proc -norom; flatten; opt -keepdc; check; write_json decoder.json'",
    );
    expect(moduleCommand(emptyVerilogCircuit('address-decoder', 'Address Decoder'))).toContain(
      'read_verilog address_decoder.v;',
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
