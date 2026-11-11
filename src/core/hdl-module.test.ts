import { describe, expect, it } from 'vitest';
import {
  HDL_CELLS,
  type HdlCell,
  type HdlModule,
  hdlCellOutput,
  hdlModuleProblems,
  hdlPinDirs,
  hdlPortName,
  hdlPortPins,
  hdlPortProblem,
  isHdlCellType,
} from './hdl-module';

/** y = a & b, q <= y on clk: the smallest module with a word of each kind. */
const sample: HdlModule = {
  format: 1,
  top: 'sample',
  creator: 'Yosys 0.70',
  bitCount: 6,
  ports: [
    { name: 'clk', dir: 'in', lsb: 0, bits: [0] },
    { name: 'a', dir: 'in', lsb: 0, bits: [1, 2] },
    { name: 'y', dir: 'out', lsb: 0, bits: [3, '0'] },
    { name: 'q', dir: 'out', lsb: 4, bits: [4, 5], init: ['1', '0'], src: 's.v:2.3-2.4' },
  ],
  signals: [{ name: 'w', lsb: 0, bits: [3], src: 's.v:5.1-5.2' }],
  memories: [],
  cells: [
    { type: '$and', src: 's.v:6.1-6.9', ports: { A: [1], B: [2], Y: [3] }, params: {} },
    {
      type: '$adff',
      src: 's.v:7.1-7.9',
      ports: { CLK: [0], ARST: ['0'], D: [3, 'x'], Q: [4, 5] },
      params: { CLK_POLARITY: 1, ARST_POLARITY: 1, ARST_VALUE: ['0', '1'] },
    },
  ],
};

describe('hdlPortName and hdlPortPins', () => {
  it('names a one-bit port by itself', () => {
    const port = { name: 'phi2', lsb: 0, bits: [4] };
    expect(hdlPortName(port)).toBe('phi2');
    expect(hdlPortPins(port)).toEqual(['phi2']);
  });

  it('names a vector a bus with its Verilog indices, its pins least significant first', () => {
    const port = { name: 'addr', lsb: 12, bits: [0, 1, 2, 3] };
    expect(hdlPortName(port)).toBe('addr[15..12]');
    expect(hdlPortPins(port)).toEqual(['addr12', 'addr13', 'addr14', 'addr15']);
  });
});

describe('hdlPinDirs', () => {
  it('makes buffered and never-driven output bits tristate, inouts bidir', () => {
    const module = {
      ports: [
        { name: 'oe', dir: 'in', lsb: 0, bits: [0] },
        { name: 'y', dir: 'out', lsb: 0, bits: [1, 2, 'z', '0'] },
        { name: 'd', dir: 'inout', lsb: 0, bits: [3] },
        // r reads d back: what the pin reads, push-pull.
        { name: 'r', dir: 'out', lsb: 0, bits: [3] },
      ],
      cells: [
        { type: '$tribuf', src: '', ports: { A: [0], EN: [0], Y: [1] }, params: {} },
        { type: '$tribuf', src: '', ports: { A: [0], EN: [0], Y: [3] }, params: {} },
      ],
    } as const satisfies Pick<HdlModule, 'ports' | 'cells'>;
    expect(hdlPinDirs(module)).toEqual([
      'in',
      'tristate',
      'out',
      'tristate',
      'out',
      'bidir',
      'out',
    ]);
  });
});

describe('hdlPortProblem', () => {
  it('takes plain identifiers and bus names the app can write', () => {
    expect(hdlPortProblem({ name: 'cs_n', lsb: 0, bits: [0] })).toBeUndefined();
    expect(hdlPortProblem({ name: 'd', lsb: 92, bits: [0, 1, 2, 3, 4, 5, 6, 7] })).toBeUndefined();
  });

  it('refuses $ in names, long names and indices over 99', () => {
    expect(hdlPortProblem({ name: 'a$b', lsb: 0, bits: [0] })).toMatch(/letters, digits and _/);
    expect(hdlPortProblem({ name: 'x'.repeat(33), lsb: 0, bits: [0] })).toMatch(/32 characters/);
    expect(hdlPortProblem({ name: 'd', lsb: 95, bits: [0, 1, 2, 3, 4, 5] })).toMatch(/0 to 99/);
  });
});

describe('HDL_CELLS', () => {
  it('lists the cells modules run and nothing else', () => {
    expect(isHdlCellType('$adffe')).toBe(true);
    expect(isHdlCellType('$tribuf')).toBe(true);
    expect(isHdlCellType('$mul')).toBe(true);
    expect(isHdlCellType('$dffsr')).toBe(true);
    expect(isHdlCellType('$lut')).toBe(false);
    expect(isHdlCellType('$_AND_')).toBe(false);
    expect(isHdlCellType('toString')).toBe(false);
    expect(isHdlCellType('$memrd')).toBe(true);
    expect(isHdlCellType('$mem_v2')).toBe(false);
    expect(Object.keys(HDL_CELLS)).toHaveLength(60);
  });
});

describe('hdlModuleProblems', () => {
  it('finds nothing in a well-formed module, also after a round trip through JSON', () => {
    expect(hdlModuleProblems(sample)).toEqual([]);
    expect(hdlModuleProblems(JSON.parse(JSON.stringify(sample)))).toEqual([]);
  });

  it('reports the shape with paths', () => {
    expect(hdlModuleProblems(null, 'm')).toEqual(['m: expected an object']);
    expect(hdlModuleProblems({ ...sample, format: 2, extra: 1 }, 'm')).toEqual([
      'm.extra: unknown field',
      'm.format: expected 1',
    ]);
  });

  it('reports bits out of range, constants on inputs and inputs sharing bits', () => {
    const ports = [
      { name: 'a', dir: 'in', lsb: 0, bits: [7] },
      { name: 'b', dir: 'in', lsb: 0, bits: ['0'] },
      { name: 'c', dir: 'in', lsb: 0, bits: [1] },
      { name: 'e', dir: 'in', lsb: 0, bits: [1] },
    ];
    expect(hdlModuleProblems({ ...sample, ports, cells: [] }, 'm')).toEqual([
      'm.ports[0].bits: bit 7 is not below bitCount 6',
      'm.ports[1].bits: expected signal bits, got "0"',
      "m.ports[3].bits: bit 1 is another input's",
    ]);
  });

  it('reports pins two ports give', () => {
    const ports = [
      { name: 'a', dir: 'in', lsb: 0, bits: [0, 1] },
      { name: 'a1', dir: 'out', lsb: 0, bits: [2] },
    ];
    expect(hdlModuleProblems({ ...sample, ports, cells: [] }, 'm')).toEqual([
      'm.ports[1].name: pin a1 is given by an earlier port',
    ]);
  });

  it("reports cells modules don't run and cells of the wrong shape", () => {
    const cells = [
      { type: '$lut', src: '', ports: {}, params: {} },
      { type: '$and', src: '', ports: { A: [1], B: [2, 1], Y: ['0'], Z: [] }, params: {} },
      { type: '$mux', src: '', ports: { A: [1], B: [2], S: [0, 1], Y: [3] }, params: {} },
      {
        type: '$dff',
        src: '',
        ports: { CLK: [0, 1], D: [1], Q: [4] },
        params: { CLK_POLARITY: 2 },
      },
      {
        type: '$add',
        src: '',
        ports: { A: Array(33).fill('0'), B: [1], Y: [3] },
        params: { A_SIGNED: 2 },
      },
      {
        type: '$sdff',
        src: '',
        ports: { CLK: [0], SRST: [1], D: [2], Q: [4] },
        params: { CLK_POLARITY: 1, SRST_POLARITY: 0, SRST_VALUE: [1], WIDTH: 1 },
      },
    ];
    expect(hdlModuleProblems({ ...sample, cells }, 'm')).toEqual([
      'm.cells[0].type: not a cell modules run: "$lut"',
      'm.cells[1].ports.Z: not a port of it',
      'm.cells[1].ports.Y: expected signal bits, got "0"',
      'm.cells[2].ports.S: expected one bit',
      'm.cells[3].ports.CLK: expected one bit',
      'm.cells[4].params.A_SIGNED: expected 0 or 1',
      'm.cells[5].params.WIDTH: not a parameter of it',
      'm.cells[5].params.SRST_VALUE: expected constant bits',
    ]);
  });

  it('checks reset values and init values against the width', () => {
    const cell = sample.cells[1]!;
    const cells = [{ ...cell, params: { ...cell.params, ARST_VALUE: ['0'] } }];
    const ports = [...sample.ports.slice(0, 3), { ...sample.ports[3]!, init: ['1'] }];
    expect(hdlModuleProblems({ ...sample, ports, cells }, 'm')).toEqual([
      'm.ports[3].init: expected as many bits as its bits',
      'm.cells[0].params.ARST_VALUE: expected 2 bits, as Q',
    ]);
  });

  it('takes words of any width, signed operands and the cells of HDL-9', () => {
    const wide = Array.from({ length: 40 }, (_, i) => i);
    const ports = [
      { name: 'a', dir: 'in', lsb: 0, bits: wide },
      { name: 'c', dir: 'in', lsb: 0, bits: [40, 41, 42, 43, 44] },
      { name: 'y', dir: 'out', lsb: 0, bits: [45, 46, 47, 48] },
    ];
    const four = [45, 46, 47, 48];
    const cells = [
      { type: '$mul', src: '', ports: { A: wide, B: wide, Y: wide }, params: {} },
      {
        type: '$div',
        src: '',
        ports: { A: [0, 1], B: [2, 3], Y: [4, 5] },
        params: { A_SIGNED: 1, B_SIGNED: 1 },
      },
      { type: '$eqx', src: '', ports: { A: [0], B: [1], Y: [2] }, params: { A_SIGNED: 0 } },
      { type: '$bmux', src: '', ports: { A: wide.slice(0, 16), S: [40, 41], Y: four }, params: {} },
      {
        type: '$demux',
        src: '',
        ports: { A: [0, 1], S: [40, 41], Y: wide.slice(0, 8) },
        params: {},
      },
      {
        type: '$bwmux',
        src: '',
        ports: { A: [0, 1], B: [2, 3], S: [4, 5], Y: [6, 7] },
        params: {},
      },
      {
        type: '$dffsre',
        src: '',
        ports: { CLK: [40], SET: [0, 1], CLR: [2, 3], EN: [41], D: [4, 5], Q: [6, 7] },
        params: { CLK_POLARITY: 1, SET_POLARITY: 1, CLR_POLARITY: 0, EN_POLARITY: 1 },
      },
      {
        type: '$aldff',
        src: '',
        ports: { CLK: [40], ALOAD: [41], AD: [0, 1], D: [2, 3], Q: [6, 7] },
        params: { CLK_POLARITY: 1, ALOAD_POLARITY: 1 },
      },
      {
        type: '$sr',
        src: '',
        ports: { SET: [0, 1], CLR: [2, 3], Q: [6, 7] },
        params: { SET_POLARITY: 1, CLR_POLARITY: 0 },
      },
      {
        type: '$dlatchsr',
        src: '',
        ports: { EN: [40], SET: [0, 1], CLR: [2, 3], D: [4, 5], Q: [6, 7] },
        params: { EN_POLARITY: 1, SET_POLARITY: 1, CLR_POLARITY: 1 },
      },
    ];
    const module = { ...sample, bitCount: 49, ports, signals: [], cells };
    expect(hdlModuleProblems(module)).toEqual([]);
    expect(hdlModuleProblems(JSON.parse(JSON.stringify(module)))).toEqual([]);
  });

  it('checks the widths of the HDL-9 cells', () => {
    const cells = [
      { type: '$bmux', src: '', ports: { A: [0, 1, 2], S: [3], Y: [4] }, params: {} },
      { type: '$demux', src: '', ports: { A: [0], S: [1, 2], Y: [3, 4] }, params: {} },
      { type: '$bwmux', src: '', ports: { A: [0, 1], B: [2, 3], S: [4], Y: [5, 3] }, params: {} },
      {
        type: '$dffsr',
        src: '',
        ports: { CLK: [0], SET: [1], CLR: [2, 3], D: [4, 5], Q: [5, 3] },
        params: { CLK_POLARITY: 1, SET_POLARITY: 1, CLR_POLARITY: 1 },
      },
      {
        type: '$aldffe',
        src: '',
        ports: { CLK: [0], ALOAD: [1, 2], AD: [1], EN: [2], D: [4], Q: [5] },
        params: { CLK_POLARITY: 1, ALOAD_POLARITY: 1, EN_POLARITY: 1 },
      },
    ];
    expect(hdlModuleProblems({ ...sample, cells }, 'm')).toEqual([
      'm.cells[0].ports.A: expected 2 bits (Y × 2^S)',
      'm.cells[1].ports.Y: expected 4 bits (A × 2^S)',
      'm.cells[2].ports.S: expected 2 bits, as Y',
      'm.cells[3].ports.SET: expected 2 bits, as Q',
      'm.cells[4].ports.ALOAD: expected one bit',
    ]);
  });

  it('takes inout ports, z in output and inout bits, and tri-state buffers (HDL-8)', () => {
    const tri: HdlModule = {
      ...sample,
      ports: [
        { name: 'oe', dir: 'in', lsb: 0, bits: [0] },
        { name: 'a', dir: 'in', lsb: 0, bits: [1, 2] },
        { name: 'd', dir: 'inout', lsb: 0, bits: [3, 'z'] },
        { name: 'y', dir: 'out', lsb: 0, bits: [4, 'z'] },
      ],
      cells: [
        { type: '$tribuf', src: 't.v:3.1-3.9', ports: { A: [1], EN: [0], Y: [3] }, params: {} },
        { type: '$tribuf', src: '', ports: { A: ['0'], EN: ['1'], Y: [4] }, params: {} },
      ],
    };
    expect(hdlModuleProblems(tri)).toEqual([]);
    expect(hdlModuleProblems(JSON.parse(JSON.stringify(tri)))).toEqual([]);
  });

  it('keeps z out of inputs, signals and cells, and checks a tri-state buffer', () => {
    const ports = [
      { name: 'a', dir: 'in', lsb: 0, bits: ['z'] },
      { name: 'b', dir: 'inout', lsb: 0, bits: ['q'] },
      { name: 'c', dir: 'both', lsb: 0, bits: [1] },
    ];
    const signals = [{ name: 'w', lsb: 0, bits: ['z'] }];
    const cells = [
      { type: '$and', src: '', ports: { A: ['z'], B: [2], Y: [3] }, params: {} },
      { type: '$tribuf', src: '', ports: { A: [1, 2], EN: [0, 1], Y: [4] }, params: {} },
      { type: '$tribuf', src: '', ports: { A: [1, 2], EN: [0], Y: [4] }, params: {} },
    ];
    expect(hdlModuleProblems({ ...sample, ports, signals, cells }, 'm')).toEqual([
      'm.ports[0].bits: expected signal bits, got "z"',
      'm.ports[1].bits: expected signal bits or "0", "1", "x", "z", got "q"',
      'm.ports[2].dir: expected "in", "out" or "inout"',
      'm.signals[0].bits: expected signal bits or "0", "1", "x", got "z"',
      'm.cells[0].ports.A: expected signal bits or "0", "1", "x", got "z"',
      'm.cells[1].ports.EN: expected one bit',
      'm.cells[2].ports.A: expected 1 bits, as Y',
    ]);
  });

  /** A 4 × 2 RAM: clk, we, a[1:0], d[1:0] in; q[1:0] read asynchronously; two write ports. */
  const ram: HdlModule = {
    ...sample,
    bitCount: 9,
    ports: [
      { name: 'clk', dir: 'in', lsb: 0, bits: [0] },
      { name: 'we', dir: 'in', lsb: 0, bits: [1] },
      { name: 'a', dir: 'in', lsb: 0, bits: [2, 3] },
      { name: 'd', dir: 'in', lsb: 0, bits: [4, 5] },
      { name: 'q', dir: 'out', lsb: 0, bits: [6, 7] },
    ],
    signals: [],
    memories: [{ name: 'm', width: 2, size: 4, offset: 0, init: '0000:3', src: 'r.v:2.3-2.20' }],
    cells: [
      {
        type: '$memrd',
        src: 'r.v:4.1-4.9',
        ports: { ADDR: [2, 3], DATA: [6, 7] },
        params: { MEMORY: 0 },
      },
      {
        type: '$memwr',
        src: 'r.v:3.1-3.9',
        ports: { CLK: [0], EN: [1, 1], ADDR: [2, 3], DATA: [4, 5] },
        params: { MEMORY: 0, CLK_POLARITY: 1, PRIORITY: [] },
      },
      {
        type: '$memwr',
        src: 'r.v:5.1-5.9',
        ports: { CLK: [0], EN: [8, 8], ADDR: ['0', '1'], DATA: ['0', 'x'] },
        params: { MEMORY: 0, CLK_POLARITY: 0, PRIORITY: ['1'] },
      },
    ],
  };

  it('takes memories, their read and write ports (HDL-6)', () => {
    expect(hdlModuleProblems(ram)).toEqual([]);
    expect(hdlModuleProblems(JSON.parse(JSON.stringify(ram)))).toEqual([]);
    expect(hdlCellOutput(ram.cells[0]!)).toEqual([6, 7]);
    expect(hdlCellOutput(ram.cells[1]!)).toEqual([]);
  });

  it('checks memories and their ports against them', () => {
    const memories = [
      { name: 'm', width: 2, size: 4, offset: 0, init: '0004:1' },
      { name: 'm', width: 0, size: 1.5, offset: -1, depth: 3 },
    ];
    const [rd, wr1, wr2] = ram.cells as [HdlCell, HdlCell, HdlCell];
    const cells = [
      { ...rd, ports: { ADDR: [2, 3], DATA: [6] } },
      { ...rd, params: { MEMORY: 2 } },
      {
        ...wr1,
        ports: { ...wr1.ports, EN: [1] },
        params: { MEMORY: 0, CLK_POLARITY: 1, PRIORITY: ['1'] },
      },
      { ...wr2, ports: { ...wr2.ports, CLK: [0, 1] } },
      { ...wr2, params: { MEMORY: 0, CLK_POLARITY: 2, PRIORITY: ['1', 'x'], A_SIGNED: 1 } },
    ];
    expect(hdlModuleProblems({ ...ram, memories, cells }, 'm')).toEqual([
      'm.memories[0].init: run "0004:1" is outside the memory\'s addresses 0x0–0x3',
      'm.memories[1].depth: unknown field',
      "m.memories[1].name: m is an earlier memory's",
      'm.memories[1].width: expected an integer ≥ 1',
      'm.memories[1].size: expected an integer ≥ 1',
      'm.memories[1].offset: expected an integer ≥ 0',
      "m.cells[0].ports.DATA: expected 2 bits, as its memory's words",
      'm.cells[1].params.MEMORY: expected the index of one of the 2 memories',
      "m.cells[2].ports.EN: expected 2 bits, as its memory's words",
      'm.cells[2].params.PRIORITY: expected 0 bits "0" or "1", one per earlier write port of its memory',
      'm.cells[3].ports.CLK: expected one bit',
      'm.cells[4].params.A_SIGNED: not a parameter of it',
      'm.cells[4].params.CLK_POLARITY: expected 0 or 1',
      'm.cells[4].params.PRIORITY: expected 2 bits "0" or "1", one per earlier write port of its memory',
    ]);
  });
});
