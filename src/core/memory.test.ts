import { describe, expect, it } from 'vitest';
import { defineComponent, type PropDef, resolveProps } from './component';
import {
  ERASED,
  formatImage,
  isPokeAction,
  parseImage,
  programmedBytes,
  readImage,
} from './memory';
import { SeededRandom } from './random';

const bytesOf = (size: number, at: Record<number, number>) => {
  const bytes = new Uint8Array(size).fill(ERASED);
  for (const [address, value] of Object.entries(at)) bytes[Number(address)] = value;
  return bytes;
};

describe('parseImage', () => {
  it('reads runs of bytes at their addresses; everything else is erased', () => {
    const bytes = parseImage('0000:A9FF8D 7FFC:0080', 0x8000);
    expect(bytes.length).toBe(0x8000);
    expect([...bytes.subarray(0, 4)]).toEqual([0xa9, 0xff, 0x8d, ERASED]);
    expect([...bytes.subarray(0x7ffc)]).toEqual([0x00, 0x80, ERASED, ERASED]);
    expect(programmedBytes(bytes)).toBe(4);
  });

  it('takes empty text as an erased memory, any whitespace between runs, any case', () => {
    expect(programmedBytes(parseImage('', 16))).toBe(0);
    expect(programmedBytes(parseImage('  \n ', 16))).toBe(0);
    expect([...parseImage('\t2:ab\n  0:0c ', 4)]).toEqual([0x0c, ERASED, 0xab, ERASED]);
  });

  it('accepts runs in any order and adjacent runs', () => {
    expect([...parseImage('2:0304 0:0102', 4)]).toEqual([1, 2, 3, 4]);
  });

  it.each([
    ['0000', 'run "0000" is not ADDR:BYTES in hex'],
    ['0000:', 'run "0000:" is not ADDR:BYTES in hex'],
    ['0000:ABC', 'run "0000:ABC" is not ADDR:BYTES in hex'],
    ['00G0:AB', 'run "00G0:AB" is not ADDR:BYTES in hex'],
    [':AB', 'run ":AB" is not ADDR:BYTES in hex'],
    ['000F:AB', undefined],
    ['0010:AB', 'run "0010:AB" reaches past the last address 0xF'],
    ['000E:ABCD', undefined],
    ['000E:ABCDEF', 'run "000E:ABCDEF" reaches past the last address 0xF'],
    ['0:0102 1:03', 'run "1:03" overlaps another at 0x1'],
  ])('%j → %s', (text, problem) => {
    const result = readImage(text, 16);
    if (problem === undefined) expect(result).toBeInstanceOf(Uint8Array);
    else expect(result).toBe(problem);
  });

  it('throws the problem', () => {
    expect(() => parseImage('zz', 16)).toThrow('invalid image: run "zz" is not ADDR:BYTES in hex');
  });

  it('shortens long runs in messages', () => {
    expect(readImage(`0:${'00'.repeat(20)}`, 8)).toBe(
      `run "0:${'0'.repeat(19)}..." reaches past the last address 0x7`,
    );
  });
});

describe('formatImage', () => {
  it('writes nothing for an erased memory', () => {
    expect(formatImage(new Uint8Array(2048).fill(ERASED))).toBe('');
    expect(formatImage(new Uint8Array(0))).toBe('');
  });

  it('writes runs of programmed bytes with 4-digit uppercase addresses', () => {
    expect(formatImage(bytesOf(0x8000, { 0: 0xa9, 1: 0x0f, 32764: 0, 32765: 0x80 }))).toBe(
      '0000:A90F 7FFC:0080',
    );
  });

  it('keeps erased gaps of up to 3 bytes inside a run, splits longer ones', () => {
    expect(formatImage(bytesOf(16, { 0: 1, 4: 2 }))).toBe('0000:01FFFFFF02');
    expect(formatImage(bytesOf(16, { 0: 1, 5: 2 }))).toBe('0000:01 0005:02');
  });

  it('leaves erased bytes out at the ends of runs', () => {
    expect(formatImage(bytesOf(16, { 3: 0, 15: 0x10 }))).toBe('0003:00 000F:10');
  });

  it('uses more address digits for memories above 64 KB', () => {
    expect(formatImage(bytesOf(0x20000, { 131071: 0x42 }))).toBe('1FFFF:42');
  });

  it('round-trips any contents through text', () => {
    const random = new SeededRandom(12);
    for (let trial = 0; trial < 50; trial++) {
      const size = 1 + (random.nextUint32() % 300);
      const bytes = new Uint8Array(size);
      random.fill(bytes);
      // Mostly erased, like real images: keep a few bytes, erase the rest.
      const keep = random.nextUint32() % 4;
      for (let i = 0; i < size; i++) if (random.nextUint32() % 4 >= keep) bytes[i] = ERASED;
      const text = formatImage(bytes);
      expect(parseImage(text, size)).toEqual(bytes);
      expect(formatImage(parseImage(text, size))).toBe(text);
    }
  });
});

describe('image props', () => {
  const contents: PropDef = {
    key: 'contents',
    label: 'Contents',
    type: 'image',
    default: '',
    max: 16,
  };
  const rom = defineComponent({
    type: 'mem/test',
    name: 'ROM',
    title: 'test ROM',
    pins: [],
    props: [contents],
    create: () => ({}),
  });

  it('are validated as images of their size', () => {
    expect(resolveProps(rom, {})).toEqual({ contents: '' });
    expect(resolveProps(rom, { contents: '0:12' })).toEqual({ contents: '0:12' });
    expect(() => resolveProps(rom, { contents: '10:12' }, 'U1')).toThrow(
      'U1: prop "contents" must be hex runs "ADDR:BYTES" separated by spaces (run "10:12" reaches past the last address 0xF), got "10:12"',
    );
    expect(() => resolveProps(rom, { contents: 3 }, 'U1')).toThrow(
      'U1: prop "contents" must be a string, got 3',
    );
  });

  it('cut long values short in messages', () => {
    expect(() => resolveProps(rom, { contents: `0:${'0'.repeat(41)}` }, 'U1')).toThrow(
      `got "0:${'0'.repeat(34)}..."`,
    );
  });
});

describe('isPokeAction', () => {
  it('recognizes debug writes', () => {
    expect(isPokeAction({ type: 'poke', address: 3, data: [1, 2] })).toBe(true);
    expect(isPokeAction({ type: 'poke', address: 1.5, data: [] })).toBe(false);
    expect(isPokeAction({ type: 'poke', address: 3 })).toBe(false);
    expect(isPokeAction({ type: 'toggle' })).toBe(false);
    expect(isPokeAction(null)).toBe(false);
  });
});
