import { describe, expect, it } from 'vitest';
import { hdlModuleProblems } from '../../core';
import { YOSYS_FIXTURES } from './fixtures';
import { fromYosys } from './from-yosys';

const fixture = (name: string): string => {
  const text = YOSYS_FIXTURES[name];
  if (text === undefined) throw new Error(`no fixture ${name}`);
  return text;
};

const convert = (name: string) => fromYosys(fixture(name));

/** Messages as `src: message`, the way the app lists them. */
const lines = (name: string) =>
  convert(name).messages.map((m) => `${m.severity} ${m.src ?? '-'}: ${m.message}`);

const ACCEPTED = [
  'counter',
  'decoder',
  'display',
  'flattened',
  'init',
  'latches',
  'ops',
  'shifts',
  'traffic',
  'wires',
];

describe('fromYosys: modules it runs', () => {
  it.each(ACCEPTED)('%s converts to a well-formed module that survives JSON', (name) => {
    const { module } = convert(name);
    expect(module).toBeDefined();
    expect(hdlModuleProblems(module)).toEqual([]);
    expect(JSON.parse(JSON.stringify(module))).toEqual(module);
  });

  it('keeps the top name, the creator and the ports in declaration order', () => {
    const { module, messages } = convert('decoder');
    expect(messages).toEqual([]);
    expect(module?.top).toBe('decoder');
    expect(module?.creator).toMatch(/^Yosys 0\.\d+/);
    expect(module?.ports.map((p) => [p.name, p.dir, p.lsb, p.bits.length])).toEqual([
      ['addr', 'in', 12, 4],
      ['phi2', 'in', 0, 1],
      ['ram_cs_n', 'out', 0, 1],
      ['via_cs_n', 'out', 0, 1],
      ['rom_cs_n', 'out', 0, 1],
      ['page', 'out', 0, 2],
    ]);
    // page = addr[13:12]: the output's bits are the input's.
    expect(module?.ports[5]?.bits).toEqual(module?.ports[0]?.bits.slice(0, 2));
    expect(module?.ports[0]?.src).toBe('decoder.v:3.19-3.23');
  });

  it('renumbers bits from 0 and keeps constants', () => {
    const { module } = convert('wires');
    expect(module?.bitCount).toBe(3);
    expect(Object.fromEntries(module?.ports.map((p) => [p.name, p.bits]) ?? [])).toEqual({
      a: [0],
      b: [1, 2],
      y: [0],
      z: [2, 1],
      one: ['1'],
      k: ['0', '1'],
      unknown: ['x'],
      floating: ['x'],
      twin: [0],
    });
  });

  it('turns parameters into polarities and values least significant first', () => {
    const { module } = convert('ops');
    const byType = (type: string) => module?.cells.filter((c) => c.type === type) ?? [];
    expect(byType('$adff')[0]?.params).toEqual({
      CLK_POLARITY: 0,
      ARST_POLARITY: 0,
      ARST_VALUE: ['0', '1', '0', '1'],
    });
    expect(byType('$sdffe')[0]?.params.SRST_VALUE).toEqual([
      '0',
      '1',
      '0',
      '1',
      '1',
      '0',
      '1',
      '0',
    ]);
    expect(byType('$sdffce')[0]?.params).toEqual({
      CLK_POLARITY: 1,
      SRST_POLARITY: 1,
      EN_POLARITY: 1,
      SRST_VALUE: ['1'],
    });
    expect(byType('$eq')[0]?.ports.B).toEqual(['1', '0', '1', '0', 'x', 'x', 'x', 'x']);
  });

  it('keeps the first source location of a cell', () => {
    const { module } = convert('traffic');
    expect(module?.cells.find((c) => c.type === '$pmux')?.src).toBe('traffic.v:16.29-16.29');
  });

  it('accepts a shift by a signed amount (a variable part-select)', () => {
    const { module } = convert('shifts');
    const shiftx = module?.cells.filter((c) => c.type === '$shiftx') ?? [];
    expect(shiftx.map((c) => c.params.B_SIGNED)).toEqual([0, 1]);
  });

  it('keeps named signals, not ports', () => {
    const { module } = convert('traffic');
    expect(module?.signals.map((s) => s.name)).toEqual(['state']);
    expect(module?.signals[0]?.bits).toEqual(module?.ports.find((p) => p.name === 'st')?.bits);
  });

  it('warns about latches, initial values, $display and outputs nothing drives', () => {
    expect(lines('latches')).toEqual([
      'warning latches.v:10.3-10.54: a latch is inferred for r',
      'warning latches.v:9.3-9.27: a latch is inferred for q',
    ]);
    expect(lines('init')).toEqual([
      'warning init.v:2.36-2.37: q has an initial value, not simulated yet (HDL-9): it starts unknown',
    ]);
    expect(convert('init').module?.ports[1]?.init).toEqual(['1']);
    expect(lines('display')).toEqual([
      'warning display.v:5.5-5.25: $display and $write are not shown (yet): ignored',
    ]);
    expect(lines('wires')).toEqual([
      'warning wires.v:10.12-10.20: floating has no driver: it reads unknown',
    ]);
  });

  it('drops hierarchy information left by flatten', () => {
    const { module, messages } = convert('flattened');
    expect(messages).toEqual([]);
    expect(module?.cells).toEqual([]);
  });
});

describe('fromYosys: what it refuses', () => {
  it.each([
    ['memory', 'error memory.v:4.33-4.42: a memory (r) — not supported yet (HDL-6)'],
    [
      'rom',
      'error rom.v:4.13-9.10: a case statement became a ROM: make the JSON with the command (proc -norom)',
    ],
    ['loop', 'error loop.v:4.14-4.22: a combinational loop through y — not supported yet (HDL-9)'],
    ['signed', 'error signed.v:3.15-3.20: signed operands — not supported yet (HDL-9)'],
    ['wide', 'error wide.v:3.14-3.19: a 33-bit $add — operands up to 32 bits for now (HDL-9)'],
    ['tristate', 'error tristate.v:3.14-3.27: a tri-state buffer — not supported yet (HDL-8)'],
    [
      'ascending',
      "error ascending.v:2.31-2.32: port a is declared [0:3]: declare it [3:0] (bit 0 is the least significant in the app's buses)",
    ],
    [
      'hierarchy',
      'error hierarchy.v:8.7-8.24: the module places module inv (u1): make the JSON with the command, which flattens',
    ],
    [
      'gates',
      'error -: a gate-level netlist ($_ANDNOT_): make the JSON with the command — without synth or techmap',
    ],
    [
      'clock',
      'error clock.v:4.3-4.31: the clock of q is made inside the module — not supported yet (HDL-9)',
    ],
  ])('%s', (name, message) => {
    const result = convert(name);
    expect(result.module).toBeUndefined();
    expect(lines(name)).toEqual([message]);
  });

  it('refuses an inout port and the tri-state behind it', () => {
    expect(lines('inout')).toEqual([
      'error inout.v:2.52-2.53: inout port d — not supported yet (HDL-8)',
      'error inout.v:3.14-3.27: a tri-state buffer — not supported yet (HDL-8)',
    ]);
  });

  it("says what isn't a netlist", () => {
    expect(fromYosys('{ "modules": ').messages[0]?.message).toMatch(/^not JSON: /);
    expect(fromYosys('[]').messages[0]?.message).toMatch(/has no modules/);
    expect(fromYosys({ modules: {} }).messages[0]?.message).toBe('the netlist has no module');
  });

  it('takes the only module without a top mark, and needs the mark among several', () => {
    const json = JSON.parse(fixture('decoder')) as {
      modules: Record<string, { attributes: object }>;
    };
    const unmarked = { decoder: { ...json.modules.decoder!, attributes: {} } };
    expect(fromYosys({ modules: unmarked }).module?.top).toBe('decoder');
    expect(fromYosys({ modules: { ...unmarked, other: unmarked.decoder } }).messages).toEqual([
      {
        severity: 'error',
        message: 'no top module is marked: make the JSON with the command (hierarchy -auto-top)',
      },
    ]);
  });

  it('refuses port names the app has no pins for', () => {
    const module = {
      attributes: { top: '1' },
      ports: { a$b: { direction: 'input', bits: [2] }, y: { direction: 'output', bits: [2] } },
      cells: {},
      netnames: {},
    };
    expect(fromYosys({ modules: { m: module } }).messages.map((m) => m.message)).toEqual([
      'port a$b: its name must be letters, digits and _, at most 32 characters',
    ]);
  });

  it("refuses cells it doesn't run yet by type", () => {
    const module = {
      attributes: { top: '1' },
      ports: { a: { direction: 'input', bits: [2, 3] }, y: { direction: 'output', bits: [4, 5] } },
      cells: {
        m: {
          type: '$mul',
          parameters: {},
          attributes: { src: 'm.v:3.1-3.2' },
          connections: { A: [2, 3], B: [2, 3], Y: [4, 5] },
        },
      },
      netnames: {},
    };
    expect(fromYosys({ modules: { m: module } }).messages).toEqual([
      {
        severity: 'error',
        message: '$mul cells are not supported yet (HDL-9)',
        src: 'm.v:3.1-3.2',
      },
    ]);
  });
});
