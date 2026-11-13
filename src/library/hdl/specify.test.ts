import { describe, expect, it } from 'vitest';
import { picoseconds, readSpecifyCell } from './specify';

describe('picoseconds', () => {
  it("reads Yosys's 32-bit integers, numbers and decimal strings as nanoseconds", () => {
    expect(picoseconds('00000000000000000000000000001001')).toBe(9000);
    expect(picoseconds('11111111111111111111111111111110')).toBe(-2000);
    expect(picoseconds(15)).toBe(15000);
    expect(picoseconds('9.500000')).toBe(9500);
    expect(picoseconds('0.012500')).toBe(13);
    expect(picoseconds('9.5e3')).toBeUndefined();
    expect(picoseconds('x')).toBeUndefined();
    expect(picoseconds(undefined)).toBeUndefined();
  });
});

describe('readSpecifyCell', () => {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const ports: Record<string, (number | '0' | '1' | 'x')[]> = {
    SRC: [1],
    DST: [2],
    EN: ['1'],
    SRC_EN: ['1'],
    DST_EN: ['1'],
  };
  const read = (type: string, parameters: Record<string, unknown>, bits = ports) =>
    readSpecifyCell(type, parameters, (port) => bits[port] ?? [], 'm.v:1', warn);
  const t = (n: number) => n.toString(2).padStart(32, '0');
  const delays = Object.fromEntries(
    ['RISE', 'FALL'].flatMap((e) => ['MIN', 'TYP', 'MAX'].map((c) => [`T_${e}_${c}`, t(5)])),
  );

  it('drops paths with negative delays or a condition always false', () => {
    warnings.length = 0;
    expect(read('$specify2', { ...delays, T_RISE_TYP: t(2 ** 32 - 1) }).paths).toEqual([]);
    expect(read('$specify2', delays, { ...ports, EN: ['0'] }).paths).toEqual([]);
    expect(read('$specify2', { ...delays, T_FALL_MAX: 'abc' }).paths).toEqual([]);
    expect(warnings).toEqual([
      'a path with a negative delay: ignored',
      'a path whose condition is always false: ignored',
      'a path whose delays are not numbers: ignored',
    ]);
  });

  it("reads a $hold of one pin's same edge as a cycle time; drops one without edges, and rules it doesn't know", () => {
    warnings.length = 0;
    const rule = (TYPE: string, more: Record<string, unknown> = {}) => ({
      TYPE,
      T_LIMIT_TYP: t(3),
      T_LIMIT2_TYP: t(0),
      SRC_PEN: '1',
      SRC_POL: '1',
      DST_PEN: '1',
      DST_POL: '1',
      ...more,
    });
    expect(read('$specrule', rule('$hold'), { ...ports, DST: [1], SRC_EN: [3] }).checks).toEqual([
      {
        kind: 'cycle',
        clock: { bits: [1], edge: 'rise', when: 3 },
        data: { bits: [1], edge: 'rise' },
        limit: 3000,
        src: 'm.v:1',
      },
    ]);
    const anyChange = { SRC_PEN: '0', DST_PEN: '0' };
    expect(read('$specrule', rule('$hold', anyChange), { ...ports, DST: [1] }).checks).toEqual([]);
    expect(read('$specrule', rule('$future')).checks).toEqual([]);
    expect(read('$specrule', rule('$setup', { T_LIMIT_TYP: 'x' })).checks).toEqual([]);
    expect(warnings).toEqual([
      'a $hold of one pin is a pulse width between its opposite edges (posedge, then negedge) or a cycle time between its same edges: ignored',
      'a $future check is not checked (the simulator checks set-up, hold, recovery, removal, pulse widths and cycle times): ignored',
      'a $setup check whose limit is not a number: ignored',
    ]);
  });
});
