import { describe, expect, it } from 'vitest';
import type { HdlCell, HdlModule } from '../../core';
import { analyzeHdlModule, bitName, NO_DRIVER, PIN } from './analyze';

const base = (cells: HdlCell[], bitCount = 8): HdlModule => ({
  format: 1,
  top: 't',
  creator: '',
  bitCount,
  ports: [
    { name: 'clk', dir: 'in', lsb: 0, bits: [0] },
    { name: 'a', dir: 'in', lsb: 0, bits: [1, 2] },
    { name: 'y', dir: 'out', lsb: 0, bits: [3] },
  ],
  signals: [{ name: 'w', lsb: 4, bits: [4, 5] }],
  memories: [],
  cells,
});

const and = (a: number, b: number, y: number, src = ''): HdlCell => ({
  type: '$and',
  src,
  ports: { A: [a], B: [b], Y: [y] },
  params: {},
});
const not = (a: number, y: number, src = ''): HdlCell => ({
  type: '$not',
  src,
  ports: { A: [a], Y: [y] },
  params: {},
});
const dff = (clk: number | '0', d: number, q: number, src = ''): HdlCell => ({
  type: '$dff',
  src,
  ports: { CLK: [clk], D: [d], Q: [q] },
  params: { CLK_POLARITY: 1 },
});

describe('analyzeHdlModule', () => {
  it('orders combinational cells after the cells they read, flip-flops apart', () => {
    // y = ~w4 where w4 = a1 & w5, w5 = ~q6, q6 <= y on clk.
    const cells = [not(4, 3), and(1, 5, 4), dff(0, 3, 6), not(6, 5)];
    const { order, flipFlops, messages } = analyzeHdlModule(base(cells));
    expect(messages).toEqual([]);
    expect(order).toEqual([3, 1, 0]);
    expect(flipFlops).toEqual([2]);
  });

  it('keeps cell order among independent cells', () => {
    const { order } = analyzeHdlModule(base([not(1, 4), not(2, 5), and(4, 5, 3)]));
    expect(order).toEqual([0, 1, 2]);
  });

  it('reports a bit driven twice, by a cell and by an input', () => {
    const { messages } = analyzeHdlModule(
      base([not(1, 3, 'a.v:1'), not(2, 3, 'a.v:2'), not(4, 1)]),
    );
    expect(messages).toEqual([
      { severity: 'error', message: 'y is driven twice', src: 'a.v:2' },
      { severity: 'error', message: 'a[0] is driven twice' },
    ]);
  });

  it('finds combinational loops, warns by a named signal on each, keeps them together', () => {
    // y3 = a1 & w5 and w5 = ~y3: a loop; w4 = ~a2: none; bit 6 = a1 & bit 6: a cell reading itself.
    const self: HdlCell = {
      type: '$and',
      src: 'a.v:7',
      ports: { A: [1], B: [6], Y: [6] },
      params: {},
    };
    const { messages, order, loops, cones } = analyzeHdlModule(
      base([and(1, 5, 3, 'a.v:3'), not(3, 5, 'a.v:4'), not(2, 4), self]),
    );
    expect(messages).toEqual([
      {
        severity: 'warning',
        message: "a combinational loop through y: iterated until it settles, X where it doesn't",
        src: 'a.v:3',
      },
      {
        severity: 'warning',
        message:
          "a combinational loop through bit 6: iterated until it settles, X where it doesn't",
        src: 'a.v:7',
      },
    ]);
    expect(order).toEqual([0, 1, 2, 3]);
    expect(loops).toEqual([[0, 1], [3]]);
    // Each cell of a loop has the cone of the whole loop.
    expect(cones[0]).toEqual([1]);
    expect(cones[1]).toEqual([1]);
  });

  it('accepts a loop through a flip-flop and a clock tied to a constant', () => {
    expect(analyzeHdlModule(base([dff(0, 3, 4), not(4, 3), dff('0', 1, 5)])).messages).toEqual([]);
  });

  it('takes clocks and asynchronous resets made inside the module (HDL-9), cones apart', () => {
    const adff: HdlCell = {
      type: '$adff',
      src: 'a.v:9',
      ports: { CLK: [0], ARST: [4], D: [1], Q: [5] },
      params: { CLK_POLARITY: 1, ARST_POLARITY: 1, ARST_VALUE: ['0'] },
    };
    const analysis = analyzeHdlModule(base([and(0, 1, 4), dff(4, 2, 3, 'a.v:8'), adff]));
    expect(analysis.messages).toEqual([]);
    expect(analysis.flipFlops).toEqual([1, 2]);
    // What an edge samples (D) apart from the asynchronous controls (ARST, from a and b).
    expect(analysis.dataCones).toEqual([[2], [1]]);
    expect(analysis.asyncCones).toEqual([[], [0, 1]]);
  });

  it('runs latches as combinational cells, enabled from logic, with a warning', () => {
    const latch: HdlCell = {
      type: '$dlatch',
      src: 'a.v:5',
      ports: { EN: [4], D: [2], Q: [3] },
      params: { EN_POLARITY: 1 },
    };
    const { order, messages } = analyzeHdlModule(base([latch, and(0, 1, 4)]));
    expect(order).toEqual([1, 0]);
    expect(messages).toEqual([
      { severity: 'warning', message: 'a latch is inferred for y', src: 'a.v:5' },
    ]);
  });
});

describe('analyzeHdlModule: tri-states (HDL-8)', () => {
  const tribuf = (a: (number | '0')[], en: number | '1', y: number[], src = ''): HdlCell => ({
    type: '$tribuf',
    src,
    ports: { A: a, EN: [en], Y: y },
    params: {},
  });
  // oe = 0, a = 1..2, d (inout) = 3..4 driven by a tribuf, y = 5 = ~d[0], q = 6 <= d[1] on oe.
  const bus = (cells: HdlCell[], ports: HdlModule['ports'] = []): HdlModule => ({
    format: 1,
    top: 't',
    creator: '',
    bitCount: 8,
    ports: [
      { name: 'oe', dir: 'in', lsb: 0, bits: [0] },
      { name: 'a', dir: 'in', lsb: 0, bits: [1, 2] },
      { name: 'd', dir: 'inout', lsb: 0, bits: [3, 4] },
      { name: 'y', dir: 'out', lsb: 0, bits: [5] },
      ...ports,
    ],
    signals: [],
    memories: [],
    cells,
  });

  it("reads an inout's bits from its pin, which its tri-state buffer drives", () => {
    const { driver, messages } = analyzeHdlModule(bus([tribuf([1, 2], 0, [3, 4]), not(3, 5)]));
    expect(messages).toEqual([]);
    expect(Array.from(driver.slice(0, 6))).toEqual([PIN, PIN, PIN, PIN, PIN, 1]);
    expect(driver[6]).toBe(NO_DRIVER);
  });

  it('lets a tri-state buffer drive bits inside the module and outputs', () => {
    const { driver, order } = analyzeHdlModule(bus([not(6, 7), tribuf([1, '0'], 0, [5, 6])]));
    expect([driver[5], driver[6], driver[7]]).toEqual([1, 1, 0]);
    expect(order).toEqual([1, 0]);
  });

  it('refuses a tri-state buffer driving an input, and two inouts joined', () => {
    expect(analyzeHdlModule(bus([tribuf([2], 0, [1], 'b.v:3')])).messages).toEqual([
      { severity: 'error', message: 'a[0] is driven twice', src: 'b.v:3' },
    ]);
    const joined = { name: 'e', dir: 'inout' as const, lsb: 0, bits: [4], src: 'b.v:2' };
    expect(analyzeHdlModule(bus([], [joined])).messages).toEqual([
      {
        severity: 'error',
        message:
          "inout ports d and e are joined inside the module — a part can't be a wire between two of its pins",
        src: 'b.v:2',
      },
    ]);
  });

  it('lets an inout drive what logic or an input gives it, and clock a flip-flop', () => {
    const shared = { name: 'w', dir: 'inout' as const, lsb: 0, bits: [1, 7] };
    const { driver, messages } = analyzeHdlModule(
      bus([not(0, 7), dff(3, 2, 6)], [shared, { name: 'q', dir: 'out', lsb: 0, bits: [6] }]),
    );
    expect(messages).toEqual([]);
    expect([driver[1], driver[7], driver[3]]).toEqual([PIN, 0, PIN]);
  });

  it('gives each cell the pins its value can come from, stopping at flip-flops', () => {
    // t7 = ~d0; t6 = t7 & a1; q5 <= t6 on oe; d = {a1, q5} while a2.
    const { cones, messages } = analyzeHdlModule(
      bus([not(3, 7), and(7, 1, 6), dff(0, 6, 5), tribuf([5, 1], 2, [3, 4])]),
    );
    expect(messages).toEqual([]);
    expect(cones).toEqual([[3], [1, 3], [0, 1, 3], [1, 2]]);
  });
});

describe('analyzeHdlModule: memories (HDL-6)', () => {
  /** clk, a[1:0] in; y out; memory m (4 × 1): w = m[a] read; m[a] <= ~w on clk while a[0]. */
  const memoryModule = (memory = { name: 'm', width: 1, size: 4, offset: 0 }): HdlModule => ({
    ...base([
      not(4, 5),
      { type: '$memrd', src: 'r', ports: { ADDR: [1, 2], DATA: [4] }, params: { MEMORY: 0 } },
      and(4, 1, 3),
      {
        type: '$memwr',
        src: 'w',
        ports: { CLK: [0], EN: [1], ADDR: [1, 2], DATA: [5] },
        params: { MEMORY: 0, CLK_POLARITY: 1, PRIORITY: [] },
      },
    ]),
    memories: [memory],
  });

  it('orders a read port after its address, a write port apart, like a flip-flop', () => {
    const analysis = analyzeHdlModule(memoryModule());
    expect(analysis.messages).toEqual([]);
    // The read port drives w; the inverter and the and read it.
    expect(analysis.driver[4]).toBe(1);
    expect(analysis.order).toEqual([1, 0, 2]);
    expect(analysis.flipFlops).toEqual([]);
    expect(analysis.writePorts).toEqual([3]);
    expect(analysis.loops).toEqual([]);
  });

  it('gives a read port the cone of its address, a write port what its edges sample', () => {
    const analysis = analyzeHdlModule(memoryModule());
    expect(analysis.cones[1]).toEqual([1, 2]);
    // ~w comes from the memory, read at a: the pins of its address.
    expect(analysis.cones[0]).toEqual([1, 2]);
    expect(analysis.cones[3]).toEqual([0, 1, 2]);
    expect(analysis.writeDataCones).toEqual([[1, 2]]);
  });

  it('refuses a memory larger than a module may hold', () => {
    const big = { name: 'big', width: 64, size: 2 ** 18, offset: 0, src: 'b.v:2.1-2.4' };
    expect(analyzeHdlModule(memoryModule(big)).messages).toEqual([
      {
        severity: 'error',
        message:
          "memory big (262144 × 64) is larger than a module's memory may be: 256K words, 8 Mbit",
        src: 'b.v:2.1-2.4',
      },
    ]);
  });
});

describe('bitName', () => {
  it('names a bit by its port or signal and index', () => {
    const module = base([]);
    expect(bitName(module, 2)).toBe('a[1]');
    expect(bitName(module, 3)).toBe('y');
    expect(bitName(module, 5)).toBe('w[5]');
    expect(bitName(module, 7)).toBe('bit 7');
    expect(bitName(module, 'x')).toBe('constant x');
  });
});
