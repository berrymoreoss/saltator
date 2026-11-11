import { describe, expect, it } from 'vitest';
import { pinsOf, Registry, timingOf } from '../../core';
import { hcFlipFlops } from '../74xx/flip-flops';
import { hcGates } from '../74xx/gates';
import { hcRegisters } from '../74xx/registers';
import { libraryModule, verilogChips } from './chips';

const hand = [...hcGates, ...hcFlipFlops, ...hcRegisters];

describe('verilogChips (HDL-2)', () => {
  it('are the 74HC00, 74HC74 and 74HC574 as dev parts, a registry takes them', () => {
    const chips = verilogChips();
    expect(chips.map((c) => [c.type, c.name, c.title])).toEqual([
      ['dev/74hc00-verilog', '74HC00', 'Quad 2-input NAND gate (Verilog)'],
      [
        'dev/74hc74-verilog',
        '74HC74',
        'Dual D-type flip-flop with set and reset; positive edge-trigger (Verilog)',
      ],
      [
        'dev/74hc574-verilog',
        '74HC574',
        'Octal D-type flip-flop; positive edge-trigger; 3-state (Verilog)',
      ],
    ]);
    expect(verilogChips()).toBe(chips); // made once
    expect(() => new Registry([...chips])).not.toThrow();
  });

  it.each(['74HC00', '74HC74', '74HC574'])(
    '%s has the hand-written chip’s pins, package, units and function table, no props',
    (name) => {
      const v = verilogChips().find((c) => c.name === name)!;
      const h = hand.find((c) => c.name === name)!;
      expect(pinsOf(v, {})).toEqual(pinsOf(h, {}));
      expect([v.package, v.units, v.functionTable, v.datasheet]).toEqual([
        h.package,
        h.units,
        h.functionTable,
        h.datasheet,
      ]);
      expect(v.props ?? []).toEqual([]);
    },
  );

  it('shows its timing from the specify block, with the data sheet and the source', () => {
    const t = timingOf(verilogChips()[2]!, {})!;
    expect(t.typical).toEqual({
      'tpd(CP↑ → Q)': 17000,
      'tpd(OEn → Q, if !OEn)': 16000,
      'tpd(OEn → Q, if OEn)': 14000,
    });
    expect(t.max).toEqual({
      'tpd(CP↑ → Q)': 35000,
      'tpd(OEn → Q, if !OEn)': 35000,
      'tpd(OEn → Q, if OEn)': 31000,
    });
    expect(t.min).toEqual({
      'tsu(D → CP↑)': 12000,
      'th(D → CP↑)': 5000,
      'tW(CP HIGH)': 16000,
      'tW(CP LOW)': 16000,
    });
    expect(t.source).toMatch(/^Nexperia 74HC_HCT574 .*; src\/library\/verilog\/74hc574\.v$/);
    expect(t.conditions).toMatch(/^VCC = 4\.5 V, CL = 50 pF/);
  });

  it('keeps the modules compiled, top names as in the sources', () => {
    expect(['74hc00', '74hc74', '74hc574'].map((n) => libraryModule(n).top)).toEqual([
      'hc00',
      'hc74',
      'hc574',
    ]);
    expect(() => libraryModule('7400')).toThrow('no library module 7400 (run pnpm hdl:library)');
  });
});
