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
  'mem_bytes',
  'mem_dual_clock',
  'mem_fifo',
  'mem_hier',
  'mem_offset',
  'mem_regfile',
  'mem_reset_loop',
  'mem_rom',
  'mem_two_writes',
  'mem_wide',
  'memory',
  'open_drain',
  'ops',
  'races',
  'rom',
  'shifts',
  'signed',
  'signed_ops',
  'spec_checks',
  'spec_flattened',
  'spec_paths',
  'spec_tristate',
  'spec_unsupported',
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

  it("warns that a power not of 2 can't be built on a board", () => {
    expect(lines('arith')).toEqual([
      "warning arith.v:10.16-10.22: a ** b (a power not of 2): Yosys's synth makes no logic of it — it runs here, but a board's flow can't build it",
    ]);
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

describe('fromYosys: memories (HDL-6)', () => {
  const memoryCells = (name: string) =>
    convert(name).module?.cells.filter((c) => c.type === '$memrd' || c.type === '$memwr') ?? [];

  it('makes a memory and a cell per port: reads asynchronous, writes on the clock', () => {
    const { module, messages } = convert('mem_regfile');
    expect(messages).toEqual([]);
    expect(module?.memories).toEqual([
      { name: 'regs', width: 8, size: 8, offset: 0, src: 'mem_regfile.v:4.13-4.17' },
    ]);
    const cells = memoryCells('mem_regfile');
    expect(cells.map((c) => c.type)).toEqual(['$memrd', '$memrd', '$memwr']);
    const rs1 = module?.ports.find((p) => p.name === 'rs1')?.bits;
    const r1 = module?.ports.find((p) => p.name === 'r1')?.bits;
    expect(cells[0]?.ports).toEqual({ ADDR: rs1, DATA: r1 });
    expect(cells[0]?.params).toEqual({ MEMORY: 0 });
    const write = cells[2]!;
    expect(write.params).toEqual({ MEMORY: 0, CLK_POLARITY: 1, PRIORITY: [] });
    expect(write.ports.CLK).toEqual(module?.ports.find((p) => p.name === 'clk')?.bits);
    // proc's don't-cares (`we ? rd : x`) dropped: the address and data are the pins'.
    expect(write.ports.ADDR).toEqual(module?.ports.find((p) => p.name === 'rd')?.bits);
    expect(write.ports.DATA).toEqual(module?.ports.find((p) => p.name === 'wd')?.bits);
    // One enable for the whole word, as wide as it.
    expect(new Set(write.ports.EN).size).toBe(1);
    expect(write.ports.EN).toHaveLength(8);
    expect(write.src).toBe('mem_regfile.v:4.13-4.17');
  });

  it("keeps the contents Yosys read from $readmemh and initial blocks, at Verilog's addresses", () => {
    const rom = convert('mem_rom').module;
    expect(rom?.memories[0]).toMatchObject({
      name: 'rom',
      size: 16,
      init: '0000:48656C6C6F2C20524F4D',
    });
    // A registered read: an asynchronous port and a flip-flop after it.
    expect(rom?.cells.map((c) => c.type)).toEqual(['$dff', '$memrd']);
    expect(convert('mem_offset').module?.memories[0]).toMatchObject({
      size: 10,
      offset: 16,
      init: '0010:10111213141516171819',
    });
    // A case table made a ROM (plain proc) runs as one too.
    expect(convert('rom').module?.memories[0]).toMatchObject({
      width: 4,
      size: 16,
      init: '0000:EEEEFFDDBBBBBBBB',
    });
  });

  it('keeps the order of write ports and which wins: the later statement, a byte enable each', () => {
    const [, first, second] = memoryCells('mem_two_writes');
    expect(first?.params.PRIORITY).toEqual([]);
    expect(second?.params.PRIORITY).toEqual(['1']);
    const [, low, high] = memoryCells('mem_bytes');
    expect(low?.ports.EN?.slice(8)).toEqual(Array(8).fill('0'));
    expect(high?.ports.EN?.slice(0, 8)).toEqual(Array(8).fill('0'));
    // A reset loop: a port per word, each winning over the earlier ones; the address an integer's.
    const loop = memoryCells('mem_reset_loop').filter((c) => c.type === '$memwr');
    expect(loop.map((c) => c.params.PRIORITY)).toEqual([
      [],
      ['1'],
      ['1', '1'],
      ['1', '1', '1'],
      ['0', '0', '0', '0'],
    ]);
    expect(loop[0]?.ports.ADDR).toHaveLength(32);
  });

  it("names a submodule's memory by its path, and splits a wide port into words", () => {
    expect(convert('mem_hier').module?.memories[0]?.name).toBe('u_store.mem');
    const [, even, odd] = memoryCells('mem_wide');
    expect(even?.ports.ADDR?.[0]).toBe('0');
    expect(odd?.ports.ADDR?.[0]).toBe('1');
    expect(even?.ports.ADDR?.slice(1)).toEqual(odd?.ports.ADDR?.slice(1));
  });

  it("refuses what isn't a $mem_v2 the interpreter runs", () => {
    const mem = (
      parameters: Record<string, unknown>,
      connections: Record<string, unknown> = {},
    ) => ({
      modules: {
        m: {
          attributes: { top: '1' },
          ports: {},
          cells: {
            m: { type: '$mem_v2', attributes: { src: 'm.v:2.1-2.2' }, parameters, connections },
          },
          netnames: {},
        },
      },
    });
    const base = {
      MEMID: '\\m',
      SIZE: 2,
      WIDTH: 1,
      ABITS: 1,
      OFFSET: 0,
      RD_PORTS: 0,
      WR_PORTS: 1,
      RD_CLK_ENABLE: '',
      WR_CLK_ENABLE: '0',
      WR_CLK_POLARITY: '1',
      WR_PRIORITY_MASK: '0',
      INIT: 'xx',
    };
    const messages = (parameters: Record<string, unknown>) =>
      fromYosys(mem(parameters)).messages.map((m) => m.message);
    expect(messages(base)).toEqual([
      'memory m is written without a clock: write it in a clocked always block',
    ]);
    expect(messages({ ...base, OFFSET: -4 })).toEqual([
      'memory m has negative addresses (from -4): declare it from 0 up',
    ]);
    expect(messages({ ...base, SIZE: 'big' })).toEqual([
      "memory m: its parameters are not a $mem_v2's",
    ]);
    expect(
      fromYosys({ modules: { m: { cells: { m: { type: '$mem', parameters: {} } } } } }).messages[0]
        ?.message,
    ).toBe("$mem is an older Yosys's memory cell: make the JSON with a newer Yosys");
  });
});

describe('fromYosys: timing from specify (HDL-2)', () => {
  const ns = (min: number, typ = min, max = typ) => ({
    min: min * 1000,
    typ: typ * 1000,
    max: max * 1000,
  });

  it('makes paths of simple, parallel, full, edge-sensitive and conditional paths, in ps', () => {
    const { module, messages } = convert('spec_paths');
    expect(messages).toEqual([]);
    const bit = (name: string) => module!.ports.find((p) => p.name === name)!.bits;
    const [a, b, en] = [bit('a')[0], bit('b')[0], bit('en')[0]];
    const src = (line: number) => expect.stringMatching(new RegExp(`^spec_paths\\.v:${line}\\.`));
    expect(module?.specify?.paths).toEqual([
      {
        from: [a],
        to: bit('y'),
        full: false,
        rise: ns(9, 9, 23),
        fall: ns(8, 8, 20),
        src: src(22),
      },
      // (9.5, 10): Yosys writes the decimal as a string.
      { from: [b], to: bit('y'), full: false, rise: ns(9.5), fall: ns(10), src: src(23) },
      { from: bit('s'), to: bit('p'), full: false, rise: ns(5), fall: ns(5), src: src(24) },
      {
        from: bit('s'),
        to: bit('f'),
        full: true,
        rise: ns(7), // (6:7:8) alone: Yosys keeps only the typical value; (r, f) keeps whole triples
        fall: ns(7),
        src: src(25),
      },
      {
        from: bit('clk'),
        to: bit('q'),
        full: false,
        edge: 'rise',
        rise: ns(17, 17, 44),
        fall: ns(18, 18, 45),
        src: src(26),
      },
      { from: [a], to: bit('g'), full: false, when: en, rise: ns(12), fall: ns(12), src: src(27) },
      { from: [en], to: bit('g'), full: false, rise: ns(11), fall: ns(11), src: src(28) },
    ]);
    expect(module?.specify?.checks).toEqual([]);
  });

  it("takes a 3-state output's enable and disable as two paths conditional on the enable", () => {
    const { module } = convert('spec_tristate');
    const [clk, oen, d, q] = module!.ports.map((p) => p.bits);
    const paths = module!.specify!.paths;
    expect(paths.map((p) => [p.from, p.to, p.full, p.edge, p.rise.typ])).toEqual([
      [clk, q, true, 'rise', 17000],
      [oen, q, true, undefined, 16000],
      [oen, q, true, undefined, 14000],
    ]);
    // `if (!oen)`: a cell inverting oen; `if (oen)`: oen itself.
    const not = module!.cells.find((c) => c.ports.Y?.[0] === paths[1]!.when)!;
    expect(not.ports.A).toEqual(oen);
    expect(paths[2]!.when).toBe(oen![0]);
    expect(module!.specify!.checks.map((c) => [c.kind, c.clock, c.data.bits, c.limit])).toEqual([
      ['setup', { bits: clk, edge: 'rise' }, d, 12000],
      ['hold', { bits: clk, edge: 'rise' }, d, 5000],
    ]);
  });

  it('normalizes the checks: set-up/hold in two, recovery and removal of a release, pulse widths', () => {
    const { module, messages } = convert('spec_checks');
    expect(messages).toEqual([]);
    const [cp, d, sdn, rdn] = module!.ports.map((p) => p.bits[0]) as [
      number,
      number,
      number,
      number,
    ];
    const armed = module!.specify!.checks[0]!.clock.when;
    expect(module!.cells.find((c) => c.ports.Y?.[0] === armed)?.type).toBe('$and');
    const at = (line: number) => `spec_checks.v:${line}`;
    const shown = module!.specify!.checks.map(
      (c) =>
        `${at(Number(c.src.split(':')[1]!.split('.')[0]))} ${c.kind} ${JSON.stringify(c.clock)} ${JSON.stringify(c.data)} ${c.limit}`,
    );
    const ev = (bits: number, edge?: string, when?: unknown) =>
      JSON.stringify({ bits: [bits], ...(edge && { edge }), ...(when !== undefined && { when }) });
    expect(shown).toEqual([
      `${at(25)} width ${ev(cp, 'fall', armed)} ${ev(cp, 'rise')} 20000`,
      `${at(26)} width ${ev(sdn, 'fall')} ${ev(sdn, 'rise')} 20000`,
      `${at(19)} setup ${ev(cp, 'rise', armed)} ${ev(d)} 15000`,
      `${at(20)} hold ${ev(cp, 'rise', armed)} ${ev(d)} 3000`,
      `${at(21)} setup ${ev(cp, 'rise')} ${ev(d)} 12000`,
      `${at(21)} hold ${ev(cp, 'rise')} ${ev(d)} 4000`,
      `${at(22)} recovery ${ev(cp, 'rise')} ${ev(rdn, 'rise')} 8000`,
      `${at(23)} removal ${ev(cp, 'rise')} ${ev(sdn, 'rise')} 2000`,
      `${at(24)} width ${ev(cp, 'rise', armed)} ${ev(cp, 'fall')} 20000`,
    ]);
  });

  it("keeps a submodule's paths on the top's pins after flatten, and drops those inside", () => {
    const { module } = convert('spec_flattened');
    const [a, b, , y] = module!.ports.map((p) => p.bits);
    expect(module!.specify!.paths.map((p) => [p.from, p.to, p.rise.typ])).toEqual([
      [[a![0]], [y![0]], 9000],
      [[b![0]], [y![0]], 9000],
      [[a![1]], [y![1]], 9000],
      [[b![1]], [y![1]], 9000],
    ]);
    expect(lines('spec_flattened')).toEqual([
      "warning spec_flattened.v:22.5-22.18: a path that doesn't run between the module's pins (a submodule's, inside it): ignored",
    ]);
  });

  it("drops what the simulator doesn't check, with a warning; keeps rise and fall of a third delay", () => {
    const { module } = convert('spec_unsupported');
    expect(lines('spec_unsupported')).toEqual([
      'warning spec_unsupported.v:15.5-15.41: a $skew check is not checked (the simulator checks set-up, hold, recovery, removal, pulse widths and cycle times): ignored',
      'warning spec_unsupported.v:17.5-17.31: a $hold check with a negative limit is not checked: ignored',
    ]);
    expect(module!.specify!.paths.map((p) => [p.rise.typ, p.fall.typ])).toEqual([[3000, 4000]]);
    // $recrem: a recovery and a removal.
    expect(module!.specify!.checks.map((c) => [c.kind, c.limit])).toEqual([
      ['recovery', 5000],
      ['removal', 1000],
    ]);
  });

  it('leaves a module without specify without timing', () => {
    expect(convert('decoder').module?.specify).toBeUndefined();
  });
});

describe('fromYosys: what it refuses', () => {
  it.each([
    [
      'mem_sync_read',
      'error mem_sync_read.v:4.13-4.14: memory m has a synchronous read port (memory_dff merged its register): make the JSON with the command, which leaves the register a flip-flop',
    ],
    [
      'mem_uncollected',
      'error mem_uncollected.v:6.33-6.42: a memory (m) whose ports are separate cells: make the JSON with the command (memory_collect)',
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
