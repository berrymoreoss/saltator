import { describe, expect, it } from 'vitest';
import { bitLevel, type Layout } from './layout';
import { compileMemory, newMemoryState, readClosure } from './memory-cells';

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
