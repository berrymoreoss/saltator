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
  'arith',
  'by_name',
  'clock',
  'clocks',
  'counter',
  'decoder',
  'display',
  'ff_flavours',
  'flattened',
  'init',
  'inout',
  'inout_shapes',
  'inits',
  'io_port',
  'latches',
  'loop',
  'loops',
  'open_drain',
  'ops',
  'races',
  'shifts',
  'signed',
  'signed_ops',
  'traffic',
  'tri_internal',
  'tri_merged',
  'tri_register',
  'tristate',
  'wide',
  'wide_ops',
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

  it('accepts a shift by a signed amount (a variable part-select), signedness kept only where 1', () => {
    const { module } = convert('shifts');
    const shiftx = module?.cells.filter((c) => c.type === '$shiftx') ?? [];
    expect(shiftx.map((c) => c.params.B_SIGNED)).toEqual([undefined, 1]);
    expect(shiftx.every((c) => !('A_SIGNED' in c.params))).toBe(true);
  });

  it('keeps signedness where Yosys gives it, also on the cells unsigned code makes signed', () => {
    const { module } = convert('signed_ops');
    const signedness = (type: string) =>
      module?.cells
        .filter((c) => c.type === type)
        .map((c) => [c.params.A_SIGNED ?? 0, c.params.B_SIGNED ?? 0]);
    expect(signedness('$div')).toEqual([[1, 1]]);
    expect(signedness('$sshr')).toEqual([[1, 0]]);
    // d[sel] = 1'b1: a signed $neg and a $shift by a signed amount.
    expect(signedness('$shift')).toEqual([[0, 1]]);
    expect(signedness('$neg')).toContainEqual([1, 0]);
    // Widths over 32 bits are kept as they are.
    const wide = convert('wide_ops').module;
    expect(wide?.cells.find((c) => c.type === '$mul')?.ports.Y).toHaveLength(64);
  });

  it('keeps named signals, not ports', () => {
    const { module } = convert('traffic');
    expect(module?.signals.map((s) => s.name)).toEqual(['state']);
    expect(module?.signals[0]?.bits).toEqual(module?.ports.find((p) => p.name === 'st')?.bits);
  });

  it('warns about latches, $display and outputs nothing drives; keeps initial values', () => {
    expect(lines('latches')).toEqual([
      'warning latches.v:10.3-10.54: a latch is inferred for r',
      'warning latches.v:9.3-9.27: a latch is inferred for q',
    ]);
    expect(lines('init')).toEqual([]);
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

describe('fromYosys: tri-states (HDL-8)', () => {
  it('keeps an inout port, read back where the module uses it, and its tri-state buffer', () => {
    const { module, messages } = convert('inout');
    expect(messages).toEqual([]);
    expect(module?.ports.map((p) => [p.name, p.dir, p.bits])).toEqual([
      ['oe', 'in', [0]],
      ['q', 'in', [1, 2, 3, 4]],
      ['d', 'inout', [5, 6, 7, 8]],
      ['r', 'out', [5, 6, 7, 8]],
    ]);
    expect(module?.cells).toEqual([
      {
        type: '$tribuf',
        src: 'inout.v:3.14-3.27',
        ports: { A: [1, 2, 3, 4], EN: [0], Y: [5, 6, 7, 8] },
        params: {},
      },
    ]);
  });

  it('keeps z in the bits of an output never driven, and an open drain as a buffer of 0', () => {
    const { module, messages } = convert('open_drain');
    expect(messages).toEqual([]);
    expect(module?.ports.map((p) => [p.name, p.dir, p.bits])).toEqual([
      ['irq', 'in', [0]],
      ['irq_n', 'out', [1]],
      ['nc', 'out', ['z']],
    ]);
    expect(module?.cells[0]?.ports).toEqual({ A: ['0'], EN: [0], Y: [1] });
  });

  it("reads a constant z as x, with a warning where an inout's z is read", () => {
    const { module, messages } = convert('inout_shapes');
    expect(lines('inout_shapes')).toEqual([
      'warning inout_shapes.v:17.15-17.23: a constant z is read here, which reads X: an inout assigned z reads X inside the module, not its pin (leave it unassigned to read the pin)',
    ]);
    expect(messages).toHaveLength(1);
    expect(module?.ports.find((p) => p.name === 'z')?.bits).toEqual(['z']);
    expect(module?.cells.find((c) => c.type === '$and')?.ports.A).toEqual(['x']);
    // w = a: the inout's bits are the input's, which it drives.
    expect(module?.ports.find((p) => p.name === 'w')?.bits).toEqual(
      module?.ports.find((p) => p.name === 'a')?.bits,
    );
  });

  it('merges two drivers of one inout into one buffer, and makes tri-states inside logic', () => {
    const types = (name: string) => convert(name).module?.cells.map((c) => c.type);
    expect(types('tri_merged')).toEqual(['$pmux', '$tribuf', '$reduce_or']);
    // Submodules sharing a bus became a $pmux; the merged buffer reaching y stays, enabled.
    const internal = convert('tri_internal').module;
    expect(internal?.cells.filter((c) => c.type === '$tribuf').map((c) => c.ports.EN)).toEqual([
      ['1'],
    ]);
  });
});

describe('fromYosys: what it refuses', () => {
  it.each([
    ['memory', 'error memory.v:4.33-4.42: a memory (r) — not supported yet (HDL-6)'],
    [
      'rom',
      'error rom.v:4.13-9.10: a case statement became a ROM: make the JSON with the command (proc -norom)',
    ],
    [
      'no_tribuf',
      'error no_tribuf.v:4.14-4.27: a tri-state left a multiplexer with z inputs: make the JSON with the command (tribuf -logic)',
    ],
    [
      'inout_joined',
      "error inout_joined.v:2.49-2.50: inout ports a and b are joined inside the module — a part can't be a wire between two of its pins",
    ],
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
  ])('%s', (name, message) => {
    const result = convert(name);
    expect(result.module).toBeUndefined();
    expect(lines(name)).toEqual([message]);
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

  it('refuses formal cells and cells it knows nothing of, by type', () => {
    const cell = (type: string) => ({
      attributes: { top: '1' },
      ports: { a: { direction: 'input', bits: [2] }, y: { direction: 'output', bits: [3] } },
      cells: { c: { type, parameters: {}, attributes: {}, connections: { A: [2], Y: [3] } } },
      netnames: {},
    });
    expect(fromYosys({ modules: { m: cell('$anyseq') } }).messages[0]?.message).toBe(
      "$anyseq is a formal verification cell, which a simulation can't run",
    );
    expect(fromYosys({ modules: { m: cell('$frobnicate') } }).messages[0]?.message).toBe(
      '$frobnicate cells are not supported',
    );
  });

  it("refuses cells of synthesis passes the command doesn't run", () => {
    const module = {
      attributes: { top: '1' },
      ports: { a: { direction: 'input', bits: [2, 3] }, y: { direction: 'output', bits: [4, 5] } },
      cells: {
        m: {
          type: '$alu',
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
        message:
          "$alu comes from synthesis passes the command doesn't run (synth, alumacc, fsm): make the JSON with the command",
        src: 'm.v:3.1-3.2',
      },
    ]);
  });
});
