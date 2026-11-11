import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../core';
import { analyzeHdlModule } from './analyze';
import { bitLevel, type Layout, layoutModule, usedBits } from './layout';
import {
  compileMemory,
  compileReadStep,
  compileWordWritePorts,
  compileWritePorts,
  newMemoryState,
  newWriteSamples,
  readClosure,
  sampleWrite,
  sampleWriteWords,
} from './memory-cells';
import { newPlanes } from './planes';
import { sampleModules } from './sample-modules';

const modules = sampleModules().filter(([, module]) => module.memories.length > 0);

/** Random words: unknown bits a share `unknown` of the bits in use; 0 where no bit lives. */
function randomWords(layout: Layout, random: SeededRandom, unknown: number) {
  const used = usedBits(layout);
  const v = new Int32Array(layout.words);
  const u = new Int32Array(layout.words);
  for (let w = 0; w < layout.words; w++) {
    let x = 0;
    for (let i = 0; i < 32; i++) if (random.nextUint32() / 2 ** 32 < unknown) x |= 1 << i;
    u[w] = x & used[w]!;
    // Addresses mostly small, so reads and writes land inside the memories.
    v[w] =
      (random.nextUint32() % 2 === 0 ? random.nextUint32() & 0xff : random.nextUint32()) &
      ~x &
      used[w]!;
  }
  return { v, u };
}

describe('memories on words against the planes', () => {
  it('has modules with memories', () => {
    expect(modules.length).toBeGreaterThan(8);
  });

  it.each(modules)('%s: read ports and write samples', (_, module) => {
    const analysis = analyzeHdlModule(module);
    const layout = layoutModule(module, analysis);
    const memories = module.memories.map(compileMemory);
    const reads = module.cells.flatMap((cell, index) => (cell.type === '$memrd' ? [index] : []));
    const random = new SeededRandom(23);
    const state = newMemoryState(memories, reads.length);
    // Contents with unknown bits here and there.
    for (const [m, memory] of memories.entries()) {
      for (let i = 0; i < state.mval[m]!.length; i++) {
        const u = random.nextUint32() & random.nextUint32() & random.nextUint32();
        state.munk[m]![i] = u;
        state.mval[m]![i] = random.nextUint32() & ~u;
      }
      expect(memory.limbs).toBeGreaterThan(0);
    }
    const oldPorts = compileWritePorts(
      analysis.writePorts.map((index) => module.cells[index]!),
      module.bitCount,
    );
    const ports = compileWordWritePorts(
      analysis.writePorts.map((index) => module.cells[index]!),
      layout,
    );
    const found: string[] = [];
    for (const unknown of [0, 0, 0.02, 0.2]) {
      for (let round = 0; round < 12; round++) {
        const { v, u } = randomWords(layout, random, unknown);
        const { val, unk } = newPlanes(module.bitCount);
        for (let b = 0; b < module.bitCount; b++) {
          const t = bitLevel(layout, v, u, b);
          unk[b] = t === 2 ? 1 : 0;
          val[b] = t === 1 ? 1 : 0;
        }
        for (const [port, index] of reads.entries()) {
          const cell = module.cells[index]!;
          const m = cell.params.MEMORY as number;
          compileReadStep(cell, m, memories[m]!, port, module.bitCount)(val, unk, state);
          const wordRead = state.readWord[port];
          const V = v.slice();
          const U = u.slice();
          readClosure(cell, m, memories[m]!, port, layout, layout.cellWord[index]!)(V, U, state);
          if (state.readWord[port] !== wordRead) found.push(`read ${port}: word ${wordRead}`);
          for (const [i, bit] of (cell.ports.DATA ?? []).entries()) {
            const want = unk[bit as number] ? 2 : val[bit as number]!;
            if (bitLevel(layout, V, U, bit) !== want) found.push(`read ${port} DATA[${i}]`);
          }
        }
        for (let p = 0; p < ports.length; p++) {
          for (const uncertain of [false, true]) {
            const want = newWriteSamples(oldPorts);
            const got = newWriteSamples(ports);
            sampleWrite(oldPorts, p, uncertain, val, unk, want);
            sampleWriteWords(ports, p, uncertain, v, u, got);
            expect(got).toEqual(want);
          }
        }
      }
    }
    expect(found.slice(0, 5)).toEqual([]);
  });
});

describe('a read port with an address wider than 32 bits', () => {
  // DATA (8 bits) in word 0, ADDR (40 bits) from bit 8 on: words 1 and 2.
  const cell = {
    type: '$memrd' as const,
    src: '',
    ports: {
      ADDR: Array.from({ length: 40 }, (_, i) => 8 + i),
      DATA: Array.from({ length: 8 }, (_, i) => i),
    },
    params: { MEMORY: 0 },
  };
  const layout: Layout = {
    words: 3,
    word: Int32Array.from({ length: 48 }, (_, b) => (b < 8 ? 0 : 1 + ((b - 8) >>> 5))),
    pos: Uint8Array.from({ length: 48 }, (_, b) => (b < 8 ? b : (b - 8) & 31)),
    cellWord: Int32Array.of(0),
    cellWords: Int32Array.of(1),
  };
  const memory = compileMemory({ name: 'm', width: 8, size: 4, offset: 0, init: '0:00112233' });

  it.each([
    ['all 0 above bit 31: the word', 0, 0, '00100010'],
    ['a 1 above bit 31: outside, X', 1 << 3, 0, 'XXXXXXXX'],
    ['an unknown bit above bit 31: X', 0, 1 << 3, 'XXXXXXXX'],
    ['a 1 and an unknown bit above: X', 1 << 3, 1 << 4, 'XXXXXXXX'],
  ])('%s', (_, high, highUnknown, want) => {
    const state = newMemoryState([memory], 1);
    const v = Int32Array.of(0, 2, high);
    const u = Int32Array.of(0, 0, highUnknown);
    readClosure(cell, 0, memory, 0, layout, 0)(v, u, state);
    const got = Array.from({ length: 8 }, (_, i) => '01X'[bitLevel(layout, v, u, 7 - i)]).join('');
    expect(got).toBe(want);
  });
});
