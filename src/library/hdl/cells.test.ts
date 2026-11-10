import { describe, expect, it } from 'vitest';
import { type HdlBit, type HdlCell, type HdlCellType, SeededRandom } from '../../core';
import { compileStep } from './cells';
import { newPlanes, planeIndex } from './planes';

/**
 * A cell on its own planes: operands A and B (and S) of the given widths numbered from 0, Y
 * after them. `run` takes each operand as text, most significant first (`'1X0'`), or a number
 * (negative ones in two's complement), and gives Y as text, most significant first.
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
  const write = (port: string, value: string | number | bigint) => {
    const list = ports[port]!;
    const text =
      typeof value === 'string'
        ? value
        : BigInt.asUintN(list.length, BigInt(value)).toString(2).padStart(list.length, '0');
    if (text.length !== list.length) throw new Error(`${port}: ${list.length} bits, got ${text}`);
    [...text].reverse().forEach((c, i) => {
      const b = planeIndex(list[i]!, bitCount);
      unk[b] = c === 'X' ? 1 : 0;
      val[b] = c === '1' ? 1 : 0;
    });
  };
  return (inputs: Record<string, string | number | bigint>): string => {
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

/** A seeded operand of `width` bits, often 0, all ones or small (carries, signs, edges). */
function operand(random: SeededRandom, width: number): bigint {
  let v = 0n;
  for (let i = 0; i < width; i += 32) v = (v << 32n) | BigInt(random.nextUint32());
  const pick = random.nextUint32() % 6;
  if (pick === 0) v = 0n;
  if (pick === 1) v = -1n;
  if (pick === 2) v = BigInt(random.nextUint32() % 9);
  return BigInt.asUintN(width, v);
}

/** Y as `run` gives it, from a number: `width` bits, most significant first. */
const bits = (value: bigint, width: number) =>
  BigInt.asUintN(width, value).toString(2).padStart(width, '0');

/** An operand's value: two's complement when signed. */
const numberOf = (v: bigint, width: number, signed: boolean) =>
  signed ? BigInt.asIntN(width, v) : v;

/** Both operands signed. */
const SIGNED = { A_SIGNED: 1, B_SIGNED: 1 };

/** Operand and result widths across the 32-bit fast path, the limbs, and mixed. */
const SHAPES = [
  { a: 8, b: 8, y: 8 },
  { a: 4, b: 7, y: 9 },
  { a: 32, b: 32, y: 32 },
  { a: 31, b: 33, y: 34 },
  { a: 64, b: 64, y: 64 },
  { a: 40, b: 70, y: 72 },
  { a: 72, b: 72, y: 16 },
] as const;

describe('words of any width and signedness (HDL-9)', () => {
  it('$add, $sub, $neg extend each operand by its sign when both are signed, wrap at Y', () => {
    const random = new SeededRandom(29);
    for (const shape of SHAPES) {
      for (const signed of [false, true]) {
        for (const [type, f] of [
          ['$add', (a: bigint, b: bigint) => a + b],
          ['$sub', (a: bigint, b: bigint) => a - b],
          ['$neg', (a: bigint) => -a],
        ] as const) {
          const unary = type === '$neg';
          const params: HdlCell['params'] = !signed ? {} : unary ? { A_SIGNED: 1 } : SIGNED;
          const run = harness(type, unary ? { a: shape.a, y: shape.y } : shape, params);
          for (let n = 0; n < 25; n++) {
            const a = operand(random, shape.a);
            const b = operand(random, shape.b);
            const want = f(numberOf(a, shape.a, signed), numberOf(b, shape.b, signed));
            const got = run(unary ? { A: a } : { A: a, B: b });
            expect(got, `${type} ${JSON.stringify(shape)} signed ${signed}: ${a} ${b}`).toBe(
              bits(want, shape.y),
            );
          }
        }
      }
    }
  });

  it('is unsigned when only one operand is (Yosys: both flags)', () => {
    const run = harness('$add', { a: 4, b: 4, y: 8 }, { A_SIGNED: 1 });
    expect(run({ A: '1111', B: '0001' })).toBe('00010000');
    const signed = harness('$add', { a: 4, b: 4, y: 8 }, { A_SIGNED: 1, B_SIGNED: 1 });
    expect(signed({ A: '1111', B: '0001' })).toBe('00000000');
  });

  it('wide arithmetic is unknown from the lowest unknown bit up', () => {
    const run = harness('$add', { a: 40, b: 40, y: 40 });
    const a = `${'0'.repeat(4)}X${'0'.repeat(35)}`;
    expect(run({ A: a, B: 1 })).toBe(`${'X'.repeat(5)}${'0'.repeat(34)}1`);
    expect(run({ A: `${'0'.repeat(39)}X`, B: 1 })).toBe('X'.repeat(40));
    // A signed operand's unknown sign extends: every bit above its width is unknown too.
    const neg = harness('$neg', { a: 4, y: 40 }, { A_SIGNED: 1 });
    expect(neg({ A: 'X000' })).toBe(`${'X'.repeat(37)}000`);
  });

  it('comparisons at the wider operand, signed when both are', () => {
    const random = new SeededRandom(31);
    const ops = {
      $eq: (a: bigint, b: bigint) => a === b,
      $ne: (a: bigint, b: bigint) => a !== b,
      $lt: (a: bigint, b: bigint) => a < b,
      $le: (a: bigint, b: bigint) => a <= b,
      $gt: (a: bigint, b: bigint) => a > b,
      $ge: (a: bigint, b: bigint) => a >= b,
    };
    for (const shape of SHAPES) {
      for (const signed of [false, true]) {
        const params: HdlCell['params'] = signed ? SIGNED : {};
        for (const [type, f] of Object.entries(ops) as [
          HdlCellType,
          (a: bigint, b: bigint) => boolean,
        ][]) {
          const run = harness(type, { a: shape.a, b: shape.b, y: 1 }, params);
          for (let n = 0; n < 25; n++) {
            const a = operand(random, shape.a);
            const b = n % 4 === 0 ? BigInt.asUintN(shape.b, a) : operand(random, shape.b);
            const want = f(numberOf(a, shape.a, signed), numberOf(b, shape.b, signed));
            expect(run({ A: a, B: b }), `${type} ${JSON.stringify(shape)} ${signed}`).toBe(
              want ? '1' : '0',
            );
          }
        }
      }
    }
  });

  it('signed comparisons are sure when every value the unknown bits allow agrees', () => {
    const lt = harness('$lt', { a: 4, b: 4, y: 1 }, { A_SIGNED: 1, B_SIGNED: 1 });
    // X000 is −8 or 0, both below 1; X111 is 7 or −1, one above 0 and one below.
    expect([
      lt({ A: 'X000', B: '0001' }),
      lt({ A: 'X111', B: '0000' }),
      lt({ A: '01XX', B: '1000' }),
    ]).toEqual(['1', 'X', '0']);
    const wide = harness('$ge', { a: 40, b: 40, y: 1 }, { A_SIGNED: 1, B_SIGNED: 1 });
    expect(wide({ A: `1${'X'.repeat(39)}`, B: 0 })).toBe('0');
    expect(wide({ A: `X${'0'.repeat(39)}`, B: 0 })).toBe('X');
    const eq = harness('$eq', { a: 4, b: 40, y: 1 }, { A_SIGNED: 1, B_SIGNED: 1 });
    expect(eq({ A: '1111', B: -1 })).toBe('1');
    expect(eq({ A: 'X111', B: -1 })).toBe('X');
  });

  it('bitwise cells and $not extend a signed operand by its sign', () => {
    expect(harness('$not', { a: 2, y: 4 }, { A_SIGNED: 1 })({ A: '10' })).toBe('0001');
    expect(
      harness('$or', { a: 2, b: 4, y: 4 }, { A_SIGNED: 1, B_SIGNED: 1 })({ A: '10', B: 1 }),
    ).toBe('1111');
    expect(harness('$or', { a: 2, b: 4, y: 4 }, { A_SIGNED: 1 })({ A: '10', B: 1 })).toBe('0011');
  });

  it('shifts follow Yosys: A extended to the wider of A and Y by its signedness', () => {
    const random = new SeededRandom(37);
    const shapes = [
      { a: 8, b: 3, y: 8 },
      { a: 4, b: 3, y: 9 },
      { a: 40, b: 7, y: 40 },
      { a: 70, b: 8, y: 33 },
      { a: 8, b: 40, y: 8 },
    ];
    for (const shape of shapes) {
      for (const signedA of [false, true]) {
        const w = Math.max(shape.a, shape.y);
        const ext = (a: bigint) => BigInt.asUintN(w, numberOf(a, shape.a, signedA));
        const refs = {
          $shl: (a: bigint, k: bigint) => ext(a) << k,
          $sshl: (a: bigint, k: bigint) => ext(a) << k,
          $shr: (a: bigint, k: bigint) => ext(a) >> k,
          $sshr: (a: bigint, k: bigint) => (signedA ? BigInt.asIntN(w, ext(a)) >> k : ext(a) >> k),
          $shift: (a: bigint, k: bigint) => ext(a) >> k,
        };
        for (const [type, f] of Object.entries(refs) as [
          HdlCellType,
          (a: bigint, k: bigint) => bigint,
        ][]) {
          const run = harness(type, shape, signedA ? { A_SIGNED: 1 } : {});
          for (let n = 0; n < 20; n++) {
            const a = operand(random, shape.a);
            const k = n % 3 === 0 ? operand(random, shape.b) : BigInt(n % (w + 3));
            const amount = BigInt.asUintN(shape.b, k);
            // Past the width every shift gives what one bit past it does (BigInt can't go 2^40).
            const capped = amount > BigInt(w + 1) ? BigInt(w + 1) : amount;
            expect(
              run({ A: a, B: amount }),
              `${type} ${JSON.stringify(shape)} ${a} ${amount}`,
            ).toBe(bits(f(a, capped), shape.y));
          }
        }
      }
    }
  });

  it('a signed amount shifts the other way below 0, also wider than 32 bits', () => {
    const run = harness('$shift', { a: 8, b: 40, y: 8 }, { B_SIGNED: 1 });
    expect(run({ A: '00000011', B: -2 })).toBe('00001100');
    expect(run({ A: '11000000', B: 3 })).toBe('00011000');
    expect(run({ A: '00000011', B: -(2n ** 38n) })).toBe('00000000');
    const signedA = harness('$shift', { a: 4, b: 3, y: 8 }, { A_SIGNED: 1, B_SIGNED: 1 });
    expect(signedA({ A: '1000', B: 1 })).toBe('01111100');
    const pick = harness('$shiftx', { a: 8, b: 40, y: 2 }, { B_SIGNED: 1 });
    expect(pick({ A: '10010110', B: -1 })).toBe('0X');
    expect(pick({ A: '10010110', B: 2n ** 35n })).toBe('XX');
  });
});

describe('multiplication, division and powers (HDL-9)', () => {
  it('$mul wraps at Y, signed when both operands are', () => {
    const random = new SeededRandom(41);
    for (const shape of SHAPES) {
      for (const signed of [false, true]) {
        const run = harness('$mul', shape, signed ? SIGNED : {});
        for (let n = 0; n < 25; n++) {
          const a = operand(random, shape.a);
          const b = operand(random, shape.b);
          const want = numberOf(a, shape.a, signed) * numberOf(b, shape.b, signed);
          expect(run({ A: a, B: b }), `${JSON.stringify(shape)} ${signed} ${a} ${b}`).toBe(
            bits(want, shape.y),
          );
        }
      }
    }
  });

  it('$mul is unknown from the lowest unknown bit up', () => {
    // The lowest unknown bit is bit 2: 0X10 × 3 is known only below it (…10).
    expect(harness('$mul', { a: 4, b: 4, y: 8 })({ A: '0X10', B: '0011' })).toBe('XXXXXX10');
    const wide = harness('$mul', { a: 40, b: 40, y: 40 });
    expect(wide({ A: `X${'0'.repeat(38)}1`, B: 3 })).toBe(`X${'0'.repeat(37)}11`);
  });

  it('$div $mod truncate, $divfloor $modfloor floor; all at the widest of A, B, Y', () => {
    const random = new SeededRandom(43);
    const refs = {
      $div: (a: bigint, b: bigint) => a / b,
      $mod: (a: bigint, b: bigint) => a % b,
      $divfloor: (a: bigint, b: bigint) => (a % b !== 0n && a < 0n !== b < 0n ? a / b - 1n : a / b),
      $modfloor: (a: bigint, b: bigint) => {
        const r = a % b;
        return r !== 0n && r < 0n !== b < 0n ? r + b : r;
      },
    };
    for (const shape of [...SHAPES, { a: 8, b: 8, y: 16 }, { a: 16, b: 4, y: 8 }]) {
      for (const signed of [false, true]) {
        for (const [type, f] of Object.entries(refs) as [
          HdlCellType,
          (a: bigint, b: bigint) => bigint,
        ][]) {
          const run = harness(type, shape, signed ? SIGNED : {});
          for (let n = 0; n < 25; n++) {
            const a = operand(random, shape.a);
            let b = operand(random, shape.b);
            if (b === 0n) b = BigInt(1 + (n % 3));
            const want = f(numberOf(a, shape.a, signed), numberOf(b, shape.b, signed));
            expect(
              run({ A: a, B: b }),
              `${type} ${JSON.stringify(shape)} ${signed} ${a} ${b}`,
            ).toBe(bits(want, shape.y));
          }
        }
      }
    }
  });

  it('a division by zero or with an unknown bit is all X', () => {
    for (const type of ['$div', '$mod', '$divfloor', '$modfloor'] as const) {
      const run = harness(type, { a: 8, b: 8, y: 8 }, SIGNED);
      expect(run({ A: 7, B: 0 }), type).toBe('XXXXXXXX');
      expect(run({ A: '0000011X', B: 1 }), type).toBe('XXXXXXXX');
      const wide = harness(type, { a: 40, b: 40, y: 40 });
      expect(wide({ A: 7, B: 0 }), type).toBe('X'.repeat(40));
    }
    // The most negative value divided by −1 wraps, as Verilog does at the operation's width.
    expect(harness('$div', { a: 8, b: 8, y: 8 }, SIGNED)({ A: -128, B: -1 })).toBe('10000000');
  });

  it('$pow by square and multiply, with Verilog rules for a negative exponent', () => {
    const random = new SeededRandom(47);
    const powMod = (base: bigint, exp: bigint, width: number) => {
      let r = 1n;
      let b = BigInt.asUintN(width, base);
      for (let e = exp; e > 0n; e >>= 1n) {
        if (e & 1n) r = BigInt.asUintN(width, r * b);
        b = BigInt.asUintN(width, b * b);
      }
      return r;
    };
    const shapes = [
      { a: 8, b: 3, y: 8 },
      { a: 8, b: 8, y: 16 },
      { a: 40, b: 6, y: 40 },
      { a: 5, b: 40, y: 72 },
    ];
    for (const shape of shapes) {
      for (const [signedA, signedB] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ] as const) {
        const params = { ...(signedA ? { A_SIGNED: 1 } : {}), ...(signedB ? { B_SIGNED: 1 } : {}) };
        const run = harness('$pow', shape, params);
        for (let n = 0; n < 25; n++) {
          let a = operand(random, shape.a);
          if (n % 5 === 1) a = BigInt.asUintN(shape.a, BigInt((n % 3) - 1)); // −1, 0, 1
          const b = operand(random, shape.b);
          const base = numberOf(a, shape.a, signedA);
          const exp = numberOf(b, shape.b, signedB);
          let want: string;
          if (exp < 0n) {
            want =
              base === 0n
                ? 'X'.repeat(shape.y)
                : bits(
                    base === 1n ? 1n : base === -1n ? (exp % 2n === 0n ? 1n : -1n) : 0n,
                    shape.y,
                  );
          } else want = bits(powMod(base, exp, shape.y), shape.y);
          expect(
            run({ A: a, B: b }),
            `${JSON.stringify(shape)} ${signedA} ${signedB} ${base} ** ${exp}`,
          ).toBe(want);
        }
      }
    }
    expect(harness('$pow', { a: 4, b: 2, y: 4 })({ A: '0X10', B: 2 })).toBe('XXXX');
  });
});

describe('=== and the multiplexers of other front ends (HDL-9)', () => {
  it('$eqx and $nex compare as == and != do: a board has no X to compare', () => {
    const eqx = harness('$eqx', { a: 4, b: 4, y: 1 });
    expect([
      eqx({ A: '1010', B: '1010' }),
      eqx({ A: '1X10', B: '1X10' }),
      eqx({ A: '1X10', B: '0X10' }),
    ]).toEqual(['1', 'X', '0']);
    const nex = harness('$nex', { a: 40, b: 40, y: 1 });
    expect([nex({ A: 5, B: 5 }), nex({ A: 5, B: 2n ** 39n + 5n })]).toEqual(['0', '1']);
  });

  it('$bmux picks the word S selects, merges the words an unknown S could pick', () => {
    // Words of 2 bits: 0 = 00, 1 = 01, 2 = 11, 3 = 10 (word 0 in the low bits).
    const run = harness('$bmux', { a: 8, s: 2, y: 2 });
    const A = '10110100';
    expect([0, 1, 2, 3].map((s) => run({ A, S: s }))).toEqual(['00', '01', '11', '10']);
    expect(run({ A, S: 'X0' })).toBe('XX'); // word 0 or 2: 00 or 11
    expect(run({ A, S: '0X' })).toBe('0X'); // word 0 or 1: 00 or 01
    expect(run({ A, S: '1X' })).toBe('1X'); // word 2 or 3: 11 or 10
    expect(run({ A, S: 'XX' })).toBe('XX');
  });

  it('$demux puts A in the word S selects and 0 in the others', () => {
    const run = harness('$demux', { a: 2, s: 2, y: 8 });
    expect(run({ A: '11', S: 2 })).toBe('00110000');
    expect(run({ A: '01', S: 'X0' })).toBe('000X000X');
    expect(run({ A: '10', S: 0 })).toBe('00000010');
  });

  it('$bwmux picks per bit', () => {
    const run = harness('$bwmux', { a: 4, b: 4, s: 4, y: 4 });
    expect(run({ A: '0000', B: '1111', S: '01X1' })).toBe('01X1');
    expect(run({ A: '1100', B: '1010', S: 'XXXX' })).toBe('1XX0');
  });
});
