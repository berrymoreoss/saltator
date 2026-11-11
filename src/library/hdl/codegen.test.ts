import { describe, expect, it } from 'vitest';
import {
  HDL_CELLS,
  type HdlBit,
  type HdlCell,
  type HdlCellType,
  hdlCellOutput,
  SeededRandom,
} from '../../core';
import { analyzeHdlModule } from './analyze';
import { compileStep } from './cells';
import { compileCells, Generator, int, isNative } from './codegen';
import { bitLevel, type Layout, layoutModule, limbsOf } from './layout';
import { newPlanes } from './planes';
import { sampleModules } from './sample-modules';

/** Random words: values and unknowns, a share of unknown bits from none to most. */
function randomWords(words: number, random: SeededRandom, unknown: number) {
  const v = new Int32Array(words);
  const u = new Int32Array(words);
  for (let w = 0; w < words; w++) {
    let x = 0;
    for (let i = 0; i < 32; i++) if (random.nextUint32() / 2 ** 32 < unknown) x |= 1 << i;
    u[w] = x;
    v[w] = random.nextUint32() & ~x;
  }
  return { v, u };
}

/**
 * Runs one cell both ways from the same words — the generated code on the words, the cells'
 * semantics on byte planes made from them — and gives the bits that differ.
 */
function differences(
  cells: readonly HdlCell[],
  index: number,
  layout: Layout,
  bitCount: number,
  drives: (bit: number) => boolean,
  v: Int32Array,
  u: Int32Array,
): string[] {
  const cell = cells[index]!;
  const { val, unk } = newPlanes(bitCount);
  for (let b = 0; b < bitCount; b++) {
    const t = bitLevel(layout, v, u, b);
    unk[b] = t === 2 ? 1 : 0;
    val[b] = t === 1 ? 1 : 0;
  }
  compileStep(cell, bitCount)(val, unk);
  const V = v.slice();
  const U = u.slice();
  compileCells(cells, layout, [index])(V, U);
  const out: string[] = [];
  for (const [i, bit] of hdlCellOutput(cell).entries()) {
    if (typeof bit !== 'number' || !drives(bit)) continue;
    const want = unk[bit] ? 2 : val[bit]!;
    const got = bitLevel(layout, V, U, bit);
    if (want !== got) out.push(`${cell.type} Y[${i}]: want ${'01X'[want]}, got ${'01X'[got]}`);
  }
  return out;
}

const COMBINATIONAL = new Set(['combinational', 'latch', 'tribuf']);

describe('generated cells against the cells’ semantics', () => {
  it.each(sampleModules())('%s', (_, module) => {
    const analysis = analyzeHdlModule(module);
    const layout = layoutModule(module, analysis);
    const random = new SeededRandom(11);
    const found: string[] = [];
    for (const [index, cell] of module.cells.entries()) {
      if (!COMBINATIONAL.has(HDL_CELLS[cell.type].kind)) continue;
      for (const unknown of [0, 0.05, 0.5]) {
        for (let round = 0; round < 8; round++) {
          const { v, u } = randomWords(layout.words, random, unknown);
          found.push(
            ...differences(
              module.cells,
              index,
              layout,
              module.bitCount,
              (bit) => analysis.driver[bit] === index,
              v,
              u,
            ),
          );
        }
      }
    }
    expect(found.slice(0, 5)).toEqual([]);
  });
});

/** Ports of a cell type and their widths, drawn at random. */
function randomCell(type: HdlCellType, random: SeededRandom): HdlCell {
  const r = (n: number) => random.nextUint32() % n;
  const w = () => 1 + r(r(4) === 0 ? 70 : 34);
  const params: Record<string, number | HdlBit[]> = {};
  const ports: Record<string, number[]> = {};
  const signedness = () => {
    params.A_SIGNED = r(2);
    params.B_SIGNED = r(2);
  };
  switch (type) {
    case '$not':
    case '$pos':
    case '$neg':
      signedness();
      ports.A = Array(w());
      ports.Y = Array(w());
      break;
    case '$reduce_and':
    case '$reduce_or':
    case '$reduce_bool':
    case '$reduce_xor':
    case '$reduce_xnor':
    case '$logic_not':
      ports.A = Array(w());
      ports.Y = Array(1 + r(2));
      break;
    case '$logic_and':
    case '$logic_or':
      ports.A = Array(w());
      ports.B = Array(w());
      ports.Y = Array(1);
      break;
    case '$eq':
    case '$ne':
    case '$eqx':
    case '$nex':
    case '$lt':
    case '$le':
    case '$gt':
    case '$ge':
      signedness();
      ports.A = Array(w());
      ports.B = Array(w());
      ports.Y = Array(1 + r(2));
      break;
    case '$mux': {
      const width = w();
      ports.A = Array(width);
      ports.B = Array(width);
      ports.S = Array(1);
      ports.Y = Array(width);
      break;
    }
    case '$pmux': {
      const width = 1 + r(40);
      const cases = 1 + r(r(3) === 0 ? 40 : 6);
      ports.A = Array(width);
      ports.B = Array(width * cases);
      ports.S = Array(cases);
      ports.Y = Array(width);
      break;
    }
    case '$bwmux': {
      const width = w();
      ports.A = Array(width);
      ports.B = Array(width);
      ports.S = Array(width);
      ports.Y = Array(width);
      break;
    }
    case '$tribuf': {
      const width = w();
      ports.A = Array(width);
      ports.EN = Array(1);
      ports.Y = Array(width);
      break;
    }
    case '$dlatch':
    case '$adlatch': {
      const width = w();
      ports.D = Array(width);
      ports.EN = Array(1);
      ports.Q = Array(width);
      params.EN_POLARITY = r(2);
      if (type === '$adlatch') {
        ports.ARST = Array(1);
        params.ARST_POLARITY = r(2);
        params.ARST_VALUE = Array.from({ length: width }, () => (r(2) ? '1' : '0'));
      }
      break;
    }
    default:
      // The arithmetic and the adapter's cells: two operands.
      signedness();
      ports.A = Array(w());
      ports.B = Array(1 + r(r(2) ? 6 : 34));
      ports.Y = Array(w());
  }
  // Number the bits: the output's from 0, the inputs after it; a few constants, repeats, and
  // operands that share bits.
  let next = 0;
  const output = type === '$dlatch' || type === '$adlatch' ? 'Q' : 'Y';
  const numbered: Record<string, HdlBit[]> = {};
  numbered[output] = ports[output]!.fill(0).map(() => next++);
  let previous: HdlBit[] | undefined;
  for (const [name, list] of Object.entries(ports)) {
    if (name === output) continue;
    if (previous && previous.length === list.length && r(5) === 0) {
      numbered[name] = previous;
      continue;
    }
    const bits: HdlBit[] = [];
    for (let i = 0; i < list.length; i++) {
      const roll = r(20);
      if (roll === 0) bits.push((['0', '1', 'x'] as const)[r(3)]!);
      else if (roll === 1 && i > 0) bits.push(bits[i - 1]!);
      else bits.push(next++);
    }
    numbered[name] = bits;
    previous = bits;
  }
  return { type, src: '', ports: numbered, params };
}

/** A layout for one cell: its output from bit 0 of word 0, its inputs at random positions. */
function cellLayout(cell: HdlCell, random: SeededRandom): { layout: Layout; bitCount: number } {
  const output = hdlCellOutput(cell);
  const bits = new Set<number>();
  for (const list of Object.values(cell.ports))
    for (const b of list) if (typeof b === 'number') bits.add(b);
  const bitCount = bits.size;
  const word = new Int32Array(bitCount);
  const pos = new Uint8Array(bitCount);
  let slot = 0;
  for (const [i, b] of output.entries()) {
    word[b as number] = i >>> 5;
    pos[b as number] = i & 31;
  }
  slot = limbsOf(output.length) * 32 + (random.nextUint32() % 32);
  const placed = new Set(output as number[]);
  for (const b of [...bits].sort((p, q) => p - q)) {
    if (placed.has(b)) continue;
    word[b] = slot >>> 5;
    pos[b] = slot & 31;
    slot++;
  }
  const layout: Layout = {
    words: (slot >>> 5) + 1,
    word,
    pos,
    cellWord: Int32Array.of(0),
    cellWords: Int32Array.of(limbsOf(output.length)),
  };
  return { layout, bitCount };
}

const TYPES: HdlCellType[] = [
  '$not',
  '$pos',
  '$neg',
  '$and',
  '$or',
  '$xor',
  '$xnor',
  '$reduce_and',
  '$reduce_or',
  '$reduce_bool',
  '$reduce_xor',
  '$reduce_xnor',
  '$logic_not',
  '$logic_and',
  '$logic_or',
  '$eq',
  '$ne',
  '$eqx',
  '$nex',
  '$lt',
  '$le',
  '$gt',
  '$ge',
  '$add',
  '$sub',
  '$mul',
  '$mux',
  '$pmux',
  '$bwmux',
  '$tribuf',
  '$dlatch',
  '$adlatch',
  '$shl',
  '$shr',
  '$sshl',
  '$sshr',
  '$shift',
  '$shiftx',
  '$div',
  '$mod',
  '$divfloor',
  '$modfloor',
  '$pow',
];

describe('generated cells of every type, random shapes', () => {
  it.each(TYPES)('%s', (type) => {
    const random = new SeededRandom(1 + TYPES.indexOf(type) * 7919);
    const found: string[] = [];
    let native = 0;
    for (let shape = 0; shape < 60; shape++) {
      const cell = randomCell(type, random);
      if (isNative(cell)) native++;
      const { layout, bitCount } = cellLayout(cell, random);
      for (const unknown of [0, 0, 0.03, 0.4]) {
        for (let round = 0; round < 6; round++) {
          const { v, u } = randomWords(layout.words, random, unknown);
          found.push(...differences([cell], 0, layout, bitCount, () => true, v, u));
        }
      }
    }
    expect(found.slice(0, 5)).toEqual([]);
    if (['$shl', '$div', '$pow'].includes(type)) expect(native).toBe(0);
    if (['$mux', '$pmux', '$eq'].includes(type)) expect(native).toBe(60);
  });
});

describe('integers only', () => {
  it('int refuses anything but a safe integer', () => {
    expect(int(42)).toBe('42');
    expect(int(-7)).toBe('-7');
    for (const value of [
      1.5,
      Number.NaN,
      Infinity,
      2 ** 60,
      '1); alert(1); (' as unknown as number,
    ]) {
      expect(() => int(value)).toThrow(/integers only/);
    }
  });

  it('a polarity that is not a number never reaches the source', () => {
    const cell: HdlCell = {
      type: '$dlatch',
      src: '',
      ports: { D: [1], EN: [2], Q: [0] },
      params: { EN_POLARITY: '0); globalThis.pwned = 1; (' as unknown as number },
    };
    const layout: Layout = {
      words: 1,
      word: Int32Array.of(0, 0, 0),
      pos: Uint8Array.of(0, 1, 2),
      cellWord: Int32Array.of(0),
      cellWords: Int32Array.of(1),
    };
    expect(() => new Generator([cell], layout).cell(0, '')).toThrow(/integers only/);
  });
});
