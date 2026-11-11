import { describe, expect, it } from 'vitest';
import { HDL_CELLS, hdlCellOutput, SeededRandom } from '../../core';
import { analyzeHdlModule } from './analyze';
import { compileStep } from './cells';
import { bitLevel, layoutModule } from './layout';
import { NO_MEMORIES, newPlanes } from './planes';
import { sampleModules } from './sample-modules';
import { compileSettle, markAll, markWord, settleOutputs } from './settle';

// Memories' read ports join the settle with HDL-6's memories on words.
const modules = sampleModules().filter(([, module]) => module.memories.length === 0);

/** Every bit `X` but 1 in 16, which is 0 or 1. */
function randomize(V: Int32Array, U: Int32Array, words: readonly number[], random: SeededRandom) {
  for (const w of words) {
    const u = random.nextUint32() & random.nextUint32() & random.nextUint32() & random.nextUint32();
    U[w] = u;
    V[w] = random.nextUint32() & ~u;
  }
}

describe('settle', () => {
  it.each(modules)('%s: only what changed runs, and it comes out as a full settle', (_, module) => {
    const analysis = analyzeHdlModule(module);
    const layout = layoutModule(module, analysis);
    const settle = compileSettle(module, analysis, layout);
    const written = new Set(settleOutputs(module, layout));
    const free = Array.from({ length: layout.words }, (_, w) => w).filter((w) => !written.has(w));
    const random = new SeededRandom(5);
    const V = new Int32Array(layout.words);
    const U = new Int32Array(layout.words).fill(-1);
    const marks = new Int32Array(settle.groups);
    randomize(V, U, free, random);
    markAll(settle, marks);
    settle.run(V, U, marks, NO_MEMORIES);
    expect([...marks].every((m) => m === 0)).toBe(true);
    for (let round = 0; round < 24; round++) {
      // A few words that pins and flip-flops write change; their readers are marked.
      const changed = free.filter(() => random.nextUint32() % 3 === 0);
      randomize(V, U, changed, random);
      for (const w of changed) markWord(settle, marks, w);
      settle.run(V, U, marks, NO_MEMORIES);
      expect([...marks].every((m) => m === 0)).toBe(true);
      const fullV = V.slice();
      const fullU = U.slice();
      markAll(settle, marks);
      settle.run(fullV, fullU, marks, NO_MEMORIES);
      expect([...V]).toEqual([...fullV]);
      expect([...U]).toEqual([...fullU]);
    }
  });

  it.each(modules.filter(([, m]) => analyzeHdlModule(m).loops.length === 0))(
    '%s: a full settle is the cells’ semantics in order',
    (_, module) => {
      const analysis = analyzeHdlModule(module);
      const layout = layoutModule(module, analysis);
      const settle = compileSettle(module, analysis, layout);
      const written = new Set(settleOutputs(module, layout));
      const free = Array.from({ length: layout.words }, (_, w) => w).filter((w) => !written.has(w));
      const random = new SeededRandom(9);
      const V = new Int32Array(layout.words);
      const U = new Int32Array(layout.words).fill(-1);
      randomize(V, U, free, random);
      const { val, unk } = newPlanes(module.bitCount);
      for (let b = 0; b < module.bitCount; b++) {
        const t = bitLevel(layout, V, U, b);
        unk[b] = t === 2 ? 1 : 0;
        val[b] = t === 1 ? 1 : 0;
      }
      for (const index of analysis.order)
        compileStep(module.cells[index]!, module.bitCount)(val, unk);
      const marks = new Int32Array(settle.groups);
      markAll(settle, marks);
      settle.run(V, U, marks, NO_MEMORIES);
      const differ: string[] = [];
      for (const index of analysis.order) {
        const cell = module.cells[index]!;
        if (HDL_CELLS[cell.type].kind === 'flip-flop') continue;
        for (const bit of hdlCellOutput(cell)) {
          if (typeof bit !== 'number' || analysis.driver[bit] !== index) continue;
          const want = unk[bit] ? 2 : val[bit]!;
          if (bitLevel(layout, V, U, bit) !== want) differ.push(`${cell.type} bit ${bit}`);
        }
      }
      expect(differ.slice(0, 5)).toEqual([]);
    },
  );

  it('splits a large module into functions and runs none while nothing is marked', () => {
    const [, module] = sampleModules().find(([name]) => name === 'differential:flavours')!;
    const analysis = analyzeHdlModule(module);
    const layout = layoutModule(module, analysis);
    const settle = compileSettle(module, analysis, layout);
    const V = new Int32Array(layout.words);
    const U = new Int32Array(layout.words).fill(-1);
    const marks = new Int32Array(settle.groups);
    markAll(settle, marks);
    settle.run(V, U, marks, NO_MEMORIES);
    const before = [...V, ...U];
    settle.run(V, U, marks, NO_MEMORIES);
    expect([...V, ...U]).toEqual(before);
  });
});
