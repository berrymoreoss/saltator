import { describe, expect, it } from 'vitest';
import { HDL_CELLS, type HdlBit, type HdlCell, type HdlCellType, SeededRandom } from '../../core';
import { analyzeHdlModule } from './analyze';
import { applyAsync, compileFlipFlop, nextState } from './cells';
import { compileAsyncControls, compileLoads, compileNextStates, isAsync } from './flip-flops';
import { bitLevel, type Layout, layoutModule, limbsOf, usedBits } from './layout';
import { newPlanes } from './planes';
import { sampleModules } from './sample-modules';

/** Random words over the bits a layout uses (the others 0). */
function randomWords(layout: Layout, random: SeededRandom, unknown: number) {
  const used = usedBits(layout);
  const v = new Int32Array(layout.words);
  const u = new Int32Array(layout.words);
  for (let w = 0; w < layout.words; w++) {
    let x = 0;
    for (let i = 0; i < 32; i++) if (random.nextUint32() / 2 ** 32 < unknown) x |= 1 << i;
    u[w] = x & used[w]!;
    v[w] = random.nextUint32() & ~x & used[w]!;
  }
  return { v, u };
}

const TX = '01X';

/**
 * One flip-flop both ways from the same words: its next state (certain and uncertain edges), its
 * load, and its asynchronous controls. Gives what differs.
 */
function differences(
  cells: readonly HdlCell[],
  index: number,
  layout: Layout,
  bitCount: number,
  v: Int32Array,
  u: Int32Array,
): string[] {
  const cell = cells[index]!;
  const out: string[] = [];
  const toPlanes = (V: Int32Array, U: Int32Array) => {
    const { val, unk } = newPlanes(bitCount);
    for (let b = 0; b < bitCount; b++) {
      const t = bitLevel(layout, V, U, b);
      unk[b] = t === 2 ? 1 : 0;
      val[b] = t === 1 ? 1 : 0;
    }
    return { val, unk };
  };
  const ff = compileFlipFlop(cell, bitCount, 0);
  const q = cell.ports.Q!;
  for (const uncertain of [false, true]) {
    const { val, unk } = toPlanes(v, u);
    const next = new Uint8Array(q.length);
    nextState(ff, uncertain, val, unk, next);
    const NV = new Int32Array(layout.words);
    const NU = new Int32Array(layout.words);
    compileNextStates(cells, layout, [index])(v, u, NV, NU, uncertain ? 1 : 0);
    for (const [i, bit] of q.entries()) {
      const got = bitLevel(layout, NV, NU, bit);
      if (got !== next[i]) {
        out.push(
          `${cell.type} next${uncertain ? ' (uncertain)' : ''} Q[${i}]: want ${TX[next[i]!]}, got ${TX[got]}`,
        );
      }
    }
    // The load: the state becomes the next state; the readers are marked where it changed.
    const V = v.slice();
    const U = u.slice();
    const D = new Int32Array(1);
    compileLoads(layout, [index], () => 'D[0] |= 1;')(V, U, NV, NU, D);
    let changed = false;
    for (const [i, bit] of q.entries()) {
      if (bitLevel(layout, V, U, bit) !== next[i]) out.push(`${cell.type} load Q[${i}]`);
      if (bitLevel(layout, v, u, bit) !== next[i]) changed = true;
    }
    if ((D[0] === 1) !== changed) out.push(`${cell.type} load marks: ${D[0]}, changed ${changed}`);
  }
  if (isAsync(cell)) {
    const { val, unk } = toPlanes(v, u);
    const want = applyAsync(ff, val, unk);
    const V = v.slice();
    const U = u.slice();
    const D = new Int32Array(1);
    const got = compileAsyncControls(cells, layout, [index], () => 'D[0] |= 1;')(V, U, D);
    if (got !== want) out.push(`${cell.type} async changed: want ${want}, got ${got}`);
    if ((D[0] === 1) !== want) out.push(`${cell.type} async marks`);
    for (const [i, bit] of q.entries()) {
      const t = unk[bit as number] ? 2 : val[bit as number]!;
      if (bitLevel(layout, V, U, bit) !== t) {
        out.push(
          `${cell.type} async Q[${i}]: want ${TX[t]}, got ${TX[bitLevel(layout, V, U, bit)]}`,
        );
      }
    }
  }
  return out;
}

describe('generated flip-flops against the cells’ semantics', () => {
  it.each(sampleModules())('%s', (_, module) => {
    const analysis = analyzeHdlModule(module);
    const layout = layoutModule(module, analysis);
    const random = new SeededRandom(3);
    const found: string[] = [];
    for (const index of analysis.flipFlops) {
      for (const unknown of [0, 0.05, 0.5]) {
        for (let round = 0; round < 6; round++) {
          const { v, u } = randomWords(layout, random, unknown);
          found.push(...differences(module.cells, index, layout, module.bitCount, v, u));
        }
      }
    }
    expect(found.slice(0, 5)).toEqual([]);
  });
});

const TYPES: HdlCellType[] = [
  '$dff',
  '$dffe',
  '$adff',
  '$adffe',
  '$sdff',
  '$sdffe',
  '$sdffce',
  '$dffsr',
  '$dffsre',
  '$aldff',
  '$aldffe',
];

/** A flip-flop of `type` with random widths, polarities, values and operand bits. */
function randomFlipFlop(
  type: HdlCellType,
  random: SeededRandom,
): { cell: HdlCell; bitCount: number } {
  const r = (n: number) => random.nextUint32() % n;
  const width = 1 + r(r(3) === 0 ? 70 : 33);
  let next = 0;
  const q = Array.from({ length: width }, () => next++);
  // Synchronous inputs may read Q itself (a counter's D); asynchronous ones don't: the cells'
  // semantics apply those bit by bit in place, an order a board doesn't have.
  const bits = (n: number, fromQ: boolean): HdlBit[] =>
    Array.from({ length: n }, () => {
      const roll = r(16);
      if (roll === 0) return (['0', '1', 'x'] as const)[r(3)]!;
      return roll === 1 && fromQ ? q[r(width)]! : next++;
    });
  const ports: Record<string, HdlBit[]> = { CLK: bits(1, false), D: bits(width, true), Q: q };
  const params: Record<string, number | HdlBit[]> = { CLK_POLARITY: r(2) };
  const spec = HDL_CELLS[type];
  const asynchronous = ['ARST', 'SET', 'CLR', 'ALOAD', 'AD'];
  for (const port of spec.inputs) {
    if (port === 'CLK' || port === 'D') continue;
    const wide = port === 'SET' || port === 'CLR' || port === 'AD';
    ports[port] = bits(wide ? width : 1, !asynchronous.includes(port));
  }
  for (const flag of spec.flags) params[flag] = r(2);
  for (const value of spec.values) {
    params[value] = Array.from({ length: width }, () => (r(2) ? '1' : '0'));
  }
  return { cell: { type, src: '', ports, params }, bitCount: next };
}

/** Q from bit 0 of word 0; every other bit at its own place after it, at a random offset. */
function layoutFor(cell: HdlCell, bitCount: number, random: SeededRandom): Layout {
  const width = cell.ports.Q!.length;
  const word = new Int32Array(bitCount);
  const pos = new Uint8Array(bitCount);
  for (let b = 0; b < width; b++) {
    word[b] = b >>> 5;
    pos[b] = b & 31;
  }
  let slot = limbsOf(width) * 32 + (random.nextUint32() % 32);
  for (let b = width; b < bitCount; b++, slot++) {
    word[b] = slot >>> 5;
    pos[b] = slot & 31;
  }
  return {
    words: (slot >>> 5) + 1,
    word,
    pos,
    cellWord: Int32Array.of(0),
    cellWords: Int32Array.of(limbsOf(width)),
  };
}

describe('generated flip-flops of every type, random shapes', () => {
  it.each(TYPES)('%s', (type) => {
    const random = new SeededRandom(17 + TYPES.indexOf(type) * 104729);
    const found: string[] = [];
    for (let shape = 0; shape < 40; shape++) {
      const { cell, bitCount } = randomFlipFlop(type, random);
      const layout = layoutFor(cell, bitCount, random);
      for (const unknown of [0, 0, 0.05, 0.4]) {
        for (let round = 0; round < 6; round++) {
          const { v, u } = randomWords(layout, random, unknown);
          found.push(...differences([cell], 0, layout, bitCount, v, u));
        }
      }
    }
    expect(found.slice(0, 5)).toEqual([]);
  });
});
