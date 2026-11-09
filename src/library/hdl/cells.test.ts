import { describe, expect, it } from 'vitest';
import { type HdlBit, type HdlCell, type HdlCellType, SeededRandom } from '../../core';
import { compileStep, newPlanes, planeIndex } from './cells';

/**
 * A cell on its own planes: operands A and B (and S) of the given widths numbered from 0, Y
 * after them. `run` takes each operand as text, most significant first (`'1X0'`), or a number,
 * and gives Y as text, most significant first.
 */
function harness(
  type: HdlCellType,
  widths: { a: number; b?: number; s?: number; y: number },
  params: HdlCell['params'] = {},
) {
  let next = 0;
  const bits = (n: number) => Array.from({ length: n }, () => next++);
  const ports: Record<string, HdlBit[]> = { A: bits(widths.a) };
  if (widths.b !== undefined) ports.B = bits(widths.b);
  if (widths.s !== undefined) ports.S = bits(widths.s);
  ports.Y = bits(widths.y);
  const bitCount = next;
  const step = compileStep({ type, src: '', ports, params }, bitCount);
  const { val, unk } = newPlanes(bitCount);
  const write = (port: string, value: string | number) => {
    const list = ports[port]!;
    const text = typeof value === 'number' ? value.toString(2).padStart(list.length, '0') : value;
    if (text.length !== list.length) throw new Error(`${port}: ${list.length} bits, got ${text}`);
    [...text].reverse().forEach((c, i) => {
      const b = planeIndex(list[i]!, bitCount);
      unk[b] = c === 'X' ? 1 : 0;
      val[b] = c === '1' ? 1 : 0;
    });
  };
  return (inputs: Record<string, string | number>): string => {
    for (const [port, value] of Object.entries(inputs)) write(port, value);
    step(val, unk);
    return ports
      .Y!.map((b) => planeIndex(b, bitCount))
      .map((b) => (unk[b] ? 'X' : String(val[b])))
      .reverse()
      .join('');
  };
}

describe('bitwise cells', () => {
  it('$and, $or, $xor, $xnor per bit, X only where it matters', () => {
    // Bit by bit, least significant first.
    const a = ['0', '1', 'X', '0', '1', 'X', '0', 'X', '1'];
    const b = ['0', '0', '0', '1', '1', '1', 'X', 'X', 'X'];
    const cases: [HdlCellType, string[]][] = [
      ['$and', ['0', '0', '0', '0', '1', 'X', '0', 'X', 'X']],
      ['$or', ['0', '1', 'X', '1', '1', '1', 'X', 'X', '1']],
      ['$xor', ['0', '1', 'X', '1', '0', 'X', 'X', 'X', 'X']],
      ['$xnor', ['1', '0', 'X', '0', '1', 'X', 'X', 'X', 'X']],
    ];
    const text = (bits: string[]) => [...bits].reverse().join('');
    for (const [type, expected] of cases) {
      const run = harness(type, { a: 9, b: 9, y: 9 });
      expect(run({ A: text(a), B: text(b) }), type).toBe(text(expected));
    }
  });

  it('zero-extends a narrower operand to the output', () => {
    expect(harness('$or', { a: 2, b: 4, y: 4 })({ A: '11', B: '0100' })).toBe('0111');
    expect(harness('$not', { a: 2, y: 4 })({ A: '01' })).toBe('1110');
    expect(harness('$pos', { a: 2, y: 3 })({ A: 'X1' })).toBe('0X1');
  });
});

describe('reductions and logic', () => {
  it('decide on the known bits when they can', () => {
    const and = harness('$reduce_and', { a: 3, y: 1 });
    expect([and({ A: '111' }), and({ A: '1X0' }), and({ A: '11X' })]).toEqual(['1', '0', 'X']);
    const or = harness('$reduce_or', { a: 3, y: 2 });
    expect([or({ A: '000' }), or({ A: 'X10' }), or({ A: '0X0' })]).toEqual(['00', '01', '0X']);
    const xor = harness('$reduce_xor', { a: 3, y: 1 });
    expect([xor({ A: '110' }), xor({ A: '100' }), xor({ A: '1X0' })]).toEqual(['0', '1', 'X']);
    const xnor = harness('$reduce_xnor', { a: 2, y: 1 });
    expect([xnor({ A: '11' }), xnor({ A: '10' })]).toEqual(['1', '0']);
    const not = harness('$logic_not', { a: 2, y: 1 });
    expect([not({ A: '00' }), not({ A: 'X1' }), not({ A: '0X' })]).toEqual(['1', '0', 'X']);
    const land = harness('$logic_and', { a: 2, b: 1, y: 1 });
    expect([
      land({ A: '10', B: '1' }),
      land({ A: 'XX', B: '0' }),
      land({ A: '0X', B: '1' }),
    ]).toEqual(['1', '0', 'X']);
    const lor = harness('$logic_or', { a: 2, b: 1, y: 1 });
    expect([lor({ A: '00', B: '0' }), lor({ A: 'X1', B: 'X' }), lor({ A: '0X', B: '0' })]).toEqual([
      '0',
      '1',
      'X',
    ]);
  });
});

describe('arithmetic', () => {
  it('matches JavaScript on known values, wrapping at the output width', () => {
    const random = new SeededRandom(7);
    for (const [type, f] of [
      ['$add', (a: number, b: number) => a + b],
      ['$sub', (a: number, b: number) => a - b],
    ] as const) {
      for (const width of [1, 4, 8, 31, 32]) {
        const run = harness(type, { a: width, b: width, y: width });
        for (let n = 0; n < 50; n++) {
          const a = random.nextUint32() % 2 ** width;
          const b = random.nextUint32() % 2 ** width;
          const want = BigInt.asUintN(width, BigInt(f(a, b)));
          expect(run({ A: a, B: b }), `${type} ${a} ${b}`).toBe(
            want.toString(2).padStart(width, '0'),
          );
        }
      }
    }
  });

  it('$neg and a narrower result', () => {
    expect(harness('$neg', { a: 4, y: 4 })({ A: 3 })).toBe('1101');
    expect(harness('$add', { a: 8, b: 8, y: 4 })({ A: 0xf0 | 9, B: 9 })).toBe('0010');
  });

  it('is unknown from the lowest unknown bit up', () => {
    expect(harness('$add', { a: 4, b: 4, y: 4 })({ A: '0X01', B: '0001' })).toBe('XX10');
    expect(harness('$sub', { a: 4, b: 4, y: 4 })({ A: '0101', B: 'X000' })).toBe('X101');
    // An unknown bit above the result's width changes nothing.
    expect(harness('$add', { a: 6, b: 4, y: 4 })({ A: 'X00001', B: '0001' })).toBe('0010');
  });
});

describe('comparisons', () => {
  it('match JavaScript on known values', () => {
    const random = new SeededRandom(11);
    const ops = {
      $eq: (a: number, b: number) => a === b,
      $ne: (a: number, b: number) => a !== b,
      $lt: (a: number, b: number) => a < b,
      $le: (a: number, b: number) => a <= b,
      $gt: (a: number, b: number) => a > b,
      $ge: (a: number, b: number) => a >= b,
    };
    for (const [type, f] of Object.entries(ops) as [
      HdlCellType,
      (a: number, b: number) => boolean,
    ][]) {
      for (const [wa, wb] of [
        [4, 4],
        [3, 6],
        [32, 32],
      ] as const) {
        const run = harness(type, { a: wa, b: wb, y: 1 });
        for (let n = 0; n < 40; n++) {
          const a = random.nextUint32() % 2 ** wa;
          const b = n % 5 === 0 ? a % 2 ** wb : random.nextUint32() % 2 ** wb;
          expect(run({ A: a, B: b }), `${type} ${a} ${b}`).toBe(f(a, b) ? '1' : '0');
        }
      }
    }
  });

  it('are sure when every value the unknown bits allow agrees', () => {
    const eq = harness('$eq', { a: 4, b: 4, y: 1 });
    expect([eq({ A: '1X00', B: '0X00' }), eq({ A: '1X00', B: '1100' })]).toEqual(['0', 'X']);
    const lt = harness('$lt', { a: 4, b: 4, y: 1 });
    // 0X0X is at most 5: below 6, never below 0.
    expect([
      lt({ A: '0X0X', B: '0110' }),
      lt({ A: '1X00', B: '0011' }),
      lt({ A: '0X0X', B: '0011' }),
    ]).toEqual(['1', '0', 'X']);
    const ge = harness('$ge', { a: 4, b: 4, y: 2 });
    expect(ge({ A: '1XXX', B: '0111' })).toBe('01');
  });

  it('read a constant x as unknown (Verilog == with x)', () => {
    const run = harness('$eq', { a: 2, b: 2, y: 1 });
    expect(run({ A: '01', B: 'X1' })).toBe('X');
    expect(run({ A: '00', B: 'X1' })).toBe('0');
  });
});

describe('shifts', () => {
  it('shift left and right, filling with 0', () => {
    expect(harness('$shl', { a: 4, b: 2, y: 4 })({ A: '1011', B: 1 })).toBe('0110');
    expect(harness('$sshl', { a: 4, b: 2, y: 6 })({ A: '1011', B: 2 })).toBe('101100');
    expect(harness('$shr', { a: 4, b: 2, y: 4 })({ A: '1011', B: 1 })).toBe('0101');
    expect(harness('$sshr', { a: 4, b: 3, y: 4 })({ A: '1011', B: 7 })).toBe('0000');
    expect(harness('$shr', { a: 6, b: 2, y: 3 })({ A: '110100', B: 2 })).toBe('101');
  });

  it('move unknown bits along, and are unknown for an unknown amount', () => {
    expect(harness('$shl', { a: 4, b: 2, y: 4 })({ A: '0X01', B: 1 })).toBe('X010');
    expect(harness('$shr', { a: 4, b: 2, y: 4 })({ A: '1011', B: 'X0' })).toBe('XXXX');
  });

  it('$shiftx selects bits, out of range unknown; a signed amount shifts the other way', () => {
    const pick = harness('$shiftx', { a: 8, b: 3, y: 1 });
    expect([0, 1, 2, 7].map((i) => pick({ A: '10000110', B: i }))).toEqual(['0', '1', '1', '1']);
    const pair = harness('$shiftx', { a: 4, b: 3, y: 2 }, { B_SIGNED: 1 });
    expect(pair({ A: '1001', B: 3 })).toBe('X1');
    expect(pair({ A: '1001', B: '111' })).toBe('1X'); // −1: bit −1 is out of range
    expect(harness('$shift', { a: 4, b: 3, y: 2 }, { B_SIGNED: 1 })({ A: '1001', B: '111' })).toBe(
      '10',
    );
  });
});

describe('multiplexers', () => {
  it('$mux picks by S, and merges both inputs while S is unknown', () => {
    const run = harness('$mux', { a: 4, b: 4, s: 1, y: 4 });
    expect(run({ A: '1100', B: '1010', S: '0' })).toBe('1100');
    expect(run({ A: '1100', B: '1010', S: '1' })).toBe('1010');
    expect(run({ A: '1100', B: '1010', S: 'X' })).toBe('1XX0');
  });

  it('$pmux picks the one case selected, A when none is, X when several could be', () => {
    // B: case 0 = 01, case 1 = 10, case 2 = 11 (case 0 in the low bits).
    const run = harness('$pmux', { a: 2, b: 6, s: 3, y: 2 });
    const B = '111001';
    expect(run({ A: '00', B, S: '000' })).toBe('00');
    expect(run({ A: '00', B, S: '001' })).toBe('01');
    expect(run({ A: '00', B, S: '100' })).toBe('11');
    expect(run({ A: '00', B, S: '101' })).toBe('XX');
    expect(run({ A: '00', B, S: '0X0' })).toBe('X0');
    expect(run({ A: '00', B, S: 'X10' })).toBe('XX');
  });
});
