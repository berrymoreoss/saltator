import { describe, expect, it } from 'vitest';
import type { HdlCell, HdlModule } from '../../core';
import { analyzeHdlModule, bitName } from './analyze';

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

  it('reports a combinational loop by a named signal on it', () => {
    const { messages } = analyzeHdlModule(base([and(1, 5, 3, 'a.v:3'), not(3, 5, 'a.v:4')]));
    expect(messages).toEqual([
      {
        severity: 'error',
        message: 'a combinational loop through y — not supported yet (HDL-9)',
        src: 'a.v:3',
      },
    ]);
  });

  it('accepts a loop through a flip-flop and a clock tied to a constant', () => {
    expect(analyzeHdlModule(base([dff(0, 3, 4), not(4, 3), dff('0', 1, 5)])).messages).toEqual([]);
  });

  it('reports clocks and asynchronous resets made inside the module', () => {
    const adff: HdlCell = {
      type: '$adff',
      src: 'a.v:9',
      ports: { CLK: [0], ARST: [4], D: [1], Q: [5] },
      params: { CLK_POLARITY: 1, ARST_POLARITY: 1, ARST_VALUE: ['0'] },
    };
    const { messages } = analyzeHdlModule(base([and(0, 1, 4), dff(4, 2, 3, 'a.v:8'), adff]));
    expect(messages.map((m) => m.message)).toEqual([
      'the clock of y is made inside the module — not supported yet (HDL-9)',
      'the asynchronous reset of w is made inside the module — not supported yet (HDL-9)',
    ]);
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
