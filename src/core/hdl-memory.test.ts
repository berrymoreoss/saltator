import { describe, expect, it } from 'vitest';
import {
  formatHdlMemoryInit,
  hdlMemoryLimbs,
  readHdlMemoryInit,
  unknownHdlMemoryWords,
} from './hdl-memory';

/** Word `i` of a read memory as [value, unknown] of its first limb. */
function word(memory: Parameters<typeof readHdlMemoryInit>[0], i: number): [number, number] {
  const words = readHdlMemoryInit(memory);
  if (typeof words === 'string') throw new Error(words);
  return [words.val[i * words.limbs]!, words.unk[i * words.limbs]!];
}

describe('readHdlMemoryInit', () => {
  const rom = { width: 8, size: 4, offset: 0 };

  it('starts every bit unknown without init, only the bits of the width', () => {
    expect(word(rom, 3)).toEqual([0, 0xff]);
    expect(word({ width: 3, size: 2, offset: 0, init: '' }, 1)).toEqual([0, 0b111]);
    const wide = unknownHdlMemoryWords({ width: 36, size: 2 });
    expect(wide.limbs).toBe(2);
    expect([...wide.unk]).toEqual([0xffffffff, 0xf, 0xffffffff, 0xf]);
  });

  it('reads runs of words at their Verilog addresses, x digits unknown', () => {
    const memory = { width: 8, size: 10, offset: 16, init: '0010:A501 0019:x7' };
    expect(word(memory, 0)).toEqual([0xa5, 0]);
    expect(word(memory, 1)).toEqual([0x01, 0]);
    expect(word(memory, 2)).toEqual([0, 0xff]);
    expect(word(memory, 9)).toEqual([0x07, 0xf0]);
  });

  it('reads words whose width is not a multiple of 4 or wider than 32 bits', () => {
    expect(word({ width: 5, size: 2, offset: 0, init: '0:1F0x' }, 0)).toEqual([0x1f, 0]);
    expect(word({ width: 5, size: 2, offset: 0, init: '0:1F0x' }, 1)).toEqual([0, 0xf]);
    const wide = readHdlMemoryInit({ width: 36, size: 1, offset: 0, init: '0:x12345678' });
    if (typeof wide === 'string') throw new Error(wide);
    expect([...wide.val]).toEqual([0x12345678, 0]);
    expect([...wide.unk]).toEqual([0, 0xf]);
    expect(word({ width: 32, size: 1, offset: 0, init: '0:FFFFFFFF' }, 0)).toEqual([0xffffffff, 0]);
  });

  it('says what is wrong with a run', () => {
    const problem = (init: string, memory: object = rom) =>
      readHdlMemoryInit({ ...rom, ...memory, init });
    expect(problem('0000')).toBe('run "0000" is not ADDR:WORDS');
    expect(problem('0:123')).toBe('run "0:123": its words take 2 digits each');
    expect(problem('3:0102')).toBe('run "3:0102" is outside the memory\'s addresses 0x0–0x3');
    expect(problem('0:01', { offset: 4 })).toBe(
      'run "0:01" is outside the memory\'s addresses 0x4–0x7',
    );
    expect(problem('0:0102 1:03')).toBe('run "1:03" overlaps another at 0x1');
    expect(problem('0:4', { width: 2 })).toBe('run "0:4": word 0x0 is wider than 2 bits');
  });
});

describe('formatHdlMemoryInit', () => {
  it('writes runs of words with a known bit; all unknown is empty', () => {
    const memory = { width: 8, size: 10, offset: 16 };
    const words = unknownHdlMemoryWords(memory);
    expect(formatHdlMemoryInit(memory, words)).toBe('');
    words.val[0] = 0xa5;
    words.unk[0] = 0;
    words.val[1] = 0x01;
    words.unk[1] = 0;
    words.val[2] = 0x10;
    words.unk[2] = 0x08; // a nibble partly unknown is x
    words.val[9] = 0x07;
    words.unk[9] = 0xf0;
    expect(formatHdlMemoryInit(memory, words)).toBe('0010:A5011x 0019:x7');
  });

  it('round-trips through readHdlMemoryInit, any width', () => {
    for (const [width, init] of [
      [1, '0000:10 0003:1'],
      [5, '0002:1Fx3'],
      [16, '0000:BEEFx0010001'],
      [36, '0001:x12345678F00000001'],
    ] as const) {
      const memory = { width, size: 4, offset: 0, init };
      const words = readHdlMemoryInit(memory);
      if (typeof words === 'string') throw new Error(words);
      expect(formatHdlMemoryInit(memory, words)).toBe(init);
    }
    expect(hdlMemoryLimbs(64)).toBe(2);
  });
});
