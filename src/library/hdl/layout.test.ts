import { describe, expect, it } from 'vitest';
import { type HdlBit, hdlCellOutput, SeededRandom } from '../../core';
import { analyzeHdlModule, PIN } from './analyze';
import {
  bitLevel,
  extendBits,
  type Layout,
  layoutModule,
  operand,
  readOperand,
  setBit,
} from './layout';
import { sampleModules } from './sample-modules';

const modules = sampleModules();

/** Random planes for a layout: values and unknowns, `v` 0 wherever `u` is 1. */
function randomPlanes(layout: Layout, random: SeededRandom) {
  const v = new Int32Array(layout.words);
  const u = new Int32Array(layout.words);
  for (let w = 0; w < layout.words; w++) {
    u[w] = random.nextUint32() & random.nextUint32();
    v[w] = random.nextUint32() & ~u[w]!;
  }
  return { v, u };
}

/** An operand's bits read one by one: 0, 1 or 2 (`X`), least significant first. */
const bitByBit = (layout: Layout, v: Int32Array, u: Int32Array, bits: readonly HdlBit[]) =>
  bits.map((bit) => bitLevel(layout, v, u, bit));

/** The same read through the operand's runs. */
function throughRuns(layout: Layout, v: Int32Array, u: Int32Array, bits: readonly HdlBit[]) {
  const op = operand(layout, bits);
  const ov = new Uint32Array(op.length);
  const ou = new Uint32Array(op.length);
  readOperand(v, u, op, ov, ou);
  return bits.map((_, i) => {
    const k = i >>> 5;
    const s = i & 31;
    return (ou[k]! >>> s) & 1 ? 2 : (ov[k]! >>> s) & 1;
  });
}

describe('layout', () => {
  it('has modules to check', () => {
    expect(modules.length).toBeGreaterThan(40);
  });

  it.each(modules)(
    '%s: every bit has a place of its own; outputs from bit 0 of their words',
    (_, module) => {
      const analysis = analyzeHdlModule(module);
      const layout = layoutModule(module, analysis);
      const seen = new Set<number>();
      for (let b = 0; b < module.bitCount; b++) {
        const w = layout.word[b]!;
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThan(layout.words);
        const slot = w * 32 + layout.pos[b]!;
        expect(seen.has(slot), `bit ${b}`).toBe(false);
        seen.add(slot);
      }
      for (const [index, cell] of module.cells.entries()) {
        const output = hdlCellOutput(cell);
        for (const [i, bit] of output.entries()) {
          if (typeof bit !== 'number' || analysis.driver[bit] !== index) continue;
          expect(layout.word[bit]).toBe(layout.cellWord[index]! + (i >>> 5));
          expect(layout.pos[bit]).toBe(i & 31);
        }
        if (layout.cellWord[index]! >= 0) {
          expect(layout.cellWords[index]).toBe(Math.max(1, Math.ceil(output.length / 32)));
        }
      }
      // A port's bits read from pins sit in order in their own words.
      for (const port of module.ports) {
        if (port.dir !== 'in') continue;
        const first = port.bits[0];
        if (typeof first !== 'number' || analysis.driver[first] !== PIN) continue;
        for (const [i, bit] of port.bits.entries()) {
          if (typeof bit !== 'number' || analysis.driver[bit] !== PIN) continue;
          if (port.bits.indexOf(bit) !== i) continue;
          expect(layout.pos[bit]).toBe(i & 31);
        }
      }
    },
  );

  it.each(modules)('%s: every operand read through its runs is its bits', (_, module) => {
    const layout = layoutModule(module, analyzeHdlModule(module));
    const random = new SeededRandom(7);
    const { v, u } = randomPlanes(layout, random);
    for (const cell of module.cells) {
      for (const [port, bits] of Object.entries(cell.ports)) {
        const extended = [
          bits,
          extendBits(bits, bits.length + 37, true),
          extendBits(bits, bits.length + 5, false),
          extendBits(bits, Math.max(0, bits.length - 3)),
        ];
        for (const list of extended) {
          expect(throughRuns(layout, v, u, list), `${cell.type}.${port}`).toEqual(
            bitByBit(layout, v, u, list),
          );
        }
      }
    }
  });
});

describe('operands', () => {
  // A hand-made layout: bits 0–39 of one output (two words), bits 40–47 of another.
  const layout: Layout = {
    words: 3,
    word: Int32Array.from({ length: 48 }, (_, b) => (b < 32 ? 0 : b < 40 ? 1 : 2)),
    pos: Uint8Array.from({ length: 48 }, (_, b) => (b < 40 ? b & 31 : b - 40)),
    cellWord: new Int32Array(0),
    cellWords: new Int32Array(0),
  };

  it('a whole word is one run; a slice is shifted into place', () => {
    const whole = operand(
      layout,
      Array.from({ length: 32 }, (_, i) => i),
    );
    expect(whole).toEqual([
      {
        runs: [{ kind: 'bits', word: 0, from: 0, to: 0, length: 32 }],
        ones: 0,
        unknown: 0,
        width: 32,
      },
    ]);
    const slice = operand(layout, [36, 37, 38, 39, 40, 41]);
    expect(slice[0]!.runs).toEqual([
      { kind: 'bits', word: 1, from: 4, to: 0, length: 4 },
      { kind: 'bits', word: 2, from: 0, to: 4, length: 2 },
    ]);
  });

  it('constants are masks; a repeated bit is a fill', () => {
    const op = operand(layout, ['1', 'x', '0', 5, 5, 5, 6, 7, 7]);
    expect(op[0]).toEqual({
      runs: [
        { kind: 'fill', word: 0, from: 5, to: 3, length: 3 },
        { kind: 'bits', word: 0, from: 6, to: 6, length: 2 },
        { kind: 'bits', word: 0, from: 7, to: 8, length: 1 },
      ],
      ones: 0b1,
      unknown: 0b10,
      width: 9,
    });
  });

  it('a signed extension past 32 bits fills the next limbs with the sign bit', () => {
    const bits = extendBits([0, 1, 2], 70, true);
    const op = operand(layout, bits);
    expect(op.map((limb) => limb.width)).toEqual([32, 32, 6]);
    expect(op[1]!.runs).toEqual([{ kind: 'fill', word: 0, from: 2, to: 0, length: 32 }]);
    const v = new Int32Array(3);
    const u = new Int32Array(3);
    setBit(layout, v, u, 2, 1);
    setBit(layout, v, u, 0, 2);
    const ov = new Uint32Array(3);
    const ou = new Uint32Array(3);
    readOperand(v, u, op, ov, ou);
    expect([...ov]).toEqual([0xfffffffc, 0xffffffff, 0x3f]);
    expect([...ou]).toEqual([1, 0, 0]);
  });
});
