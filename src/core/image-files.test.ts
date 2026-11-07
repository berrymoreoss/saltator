import { describe, expect, it } from 'vitest';
import {
  applyImageWrites,
  detectImageFormat,
  type ImageFile,
  memoryBytes,
  placeImage,
  readBinaryImage,
  readImageFile,
  readIntelHex,
  suggestedLoadAddress,
  summarizeImage,
  writeIntelHex,
} from './image-files';
import { ERASED } from './memory';
import { SeededRandom } from './random';

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const chunks = (file: ImageFile) => file.chunks.map((c) => [c.address, [...c.bytes]]);

/** Wikipedia's Intel HEX example: 64 bytes at 0x0100. */
const EXAMPLE = [
  ':10010000214601360121470136007EFE09D2190140',
  ':100110002146017E17C20001FF5F16002148011928',
  ':10012000194E79234623965778239EDA3F01B2CAA7',
  ':100130003F0156702B5E712B722B732146013421C7',
  ':00000001FF',
].join('\r\n');

describe('detectImageFormat', () => {
  it('knows Intel HEX by its extension, else by its first line', () => {
    expect(detectImageFormat('rom.hex', new Uint8Array([0, 1]))).toBe('intel-hex');
    expect(detectImageFormat('ROM.IHX', new Uint8Array())).toBe('intel-hex');
    expect(detectImageFormat('rom.bin', ascii(EXAMPLE))).toBe('intel-hex');
    expect(detectImageFormat('rom', ascii('  :00000001FF\n'))).toBe('intel-hex');
    expect(detectImageFormat('rom.bin', new Uint8Array([0x3a, 0xff, 0x00]))).toBe('binary');
    expect(detectImageFormat('rom.bin', ascii(':hello\n'))).toBe('binary');
  });
});

describe('binary files', () => {
  it('hold every byte from address 0', () => {
    const file = readBinaryImage(new Uint8Array([1, 2, 3]));
    expect(file.format).toBe('binary');
    expect(chunks(file)).toEqual([[0, [1, 2, 3]]]);
    expect(summarizeImage(file)).toEqual({ low: 0, high: 2, bytes: 3, checksum: 6 });
  });

  it('rejects an empty file', () => {
    expect(() => readImageFile('binary', new Uint8Array())).toThrow('the file is empty');
  });
});

describe('readIntelHex', () => {
  it('reads data records into chunks, with the sum of the bytes as the checksum', () => {
    const file = readImageFile('intel-hex', ascii(EXAMPLE));
    expect(file.format).toBe('intel-hex');
    expect(file.chunks).toHaveLength(1);
    expect(file.chunks[0]!.address).toBe(0x100);
    expect([...file.chunks[0]!.bytes.subarray(0, 4)]).toEqual([0x21, 0x46, 0x01, 0x36]);
    const summary = summarizeImage(file);
    expect(summary).toMatchObject({ low: 0x100, high: 0x13f, bytes: 64 });
    expect(summary.checksum).toBe([...file.chunks[0]!.bytes].reduce((a, b) => a + b, 0) & 0xffff);
  });

  it('splits chunks at gaps and joins adjacent records in any order', () => {
    const file = readIntelHex(':020011000909DB\n\n  :020000007E3050 \n:00000001FF\n');
    expect(chunks(file)).toEqual([
      [0x00, [0x7e, 0x30]],
      [0x11, [9, 9]],
    ]);
    const joined = readIntelHex(':03001000010203E7\n:020000007E3050\n:00000001FF');
    expect(chunks(joined)).toEqual([
      [0x00, [0x7e, 0x30]],
      [0x10, [1, 2, 3]],
    ]);
  });

  it('applies extended linear (04) and segment (02) addresses', () => {
    expect(chunks(readIntelHex(':020000040001F9\n:0100000042BD\n:00000001FF'))).toEqual([
      [0x10000, [0x42]],
    ]);
    expect(chunks(readIntelHex(':020000021000EC\n:0100000042BD\n:00000001FF'))).toEqual([
      [0x10000, [0x42]],
    ]);
  });

  it('wraps a record within its 64 KB segment', () => {
    expect(chunks(readIntelHex(':02FFFF00AABB9B\n:00000001FF'))).toEqual([
      [0x0000, [0xbb]],
      [0xffff, [0xaa]],
    ]);
  });

  it('keeps a start address (03, 05) and ignores what follows the end record', () => {
    expect(readIntelHex(':0100000042BD\n:040000050000800077\n:00000001FF\ngarbage').start).toBe(
      0x8000,
    );
    expect(readIntelHex(':0400000312340005AE\n:0100000042BD\n:00000001FF').start).toBe(0x12340 + 5);
  });

  it.each([
    ['0100000042BD\n:00000001FF', 'line 1: a record starts with ":"'],
    [':0100000042B\n:00000001FF', 'line 1: a record is ":" and hex digit pairs'],
    [':01000000GGBD\n:00000001FF', 'line 1: a record is ":" and hex digit pairs'],
    [':0100\n:00000001FF', 'line 1: too short for a record'],
    [':0200000042BD\n:00000001FF', 'line 1: the record says 2 data bytes but has 1'],
    [':0100000042BE\n:00000001FF', 'line 1: checksum 0xBE, expected 0xBD'],
    [':0100000042BD\n:0100000600F9\n:00000001FF', 'line 2: unknown record type 0x06'],
    [':0100000442B9\n:00000001FF', 'line 1: a type 04 record has 2 data bytes, not 1'],
    [':0100000042BD', 'no end-of-file record (":00000001FF")'],
    [':00000001FF', 'the file holds no data'],
    [
      ':03001000010203E7\n:020011000909DB\n:00000001FF',
      'line 2: overlaps the data of line 1 at 0x0011',
    ],
    [
      ':020011000909DB\n:03001000010203E7\n:00000001FF',
      'line 2: overlaps the data of line 1 at 0x0011',
    ],
  ])('reports %j: %s', (text, message) => {
    expect(() => readIntelHex(text)).toThrow(message);
  });
});

describe('placing a file into a memory', () => {
  const file = readIntelHex(':03001000010203E7\n:020013000909D9\n:00000001FF');

  it('moves the file to the load address, or fills an erased memory around it', () => {
    expect(placeImage(file, 64, { at: 0x10, eraseRest: false })).toEqual([
      { address: 0x10, bytes: new Uint8Array([1, 2, 3, 9, 9]) },
    ]);
    expect(placeImage(file, 64, { at: 0x3b, eraseRest: false })).toEqual([
      { address: 0x3b, bytes: new Uint8Array([1, 2, 3, 9, 9]) },
    ]);
    const writes = placeImage(file, 8, { at: 2, eraseRest: true });
    expect(writes).toEqual([
      { address: 0, bytes: new Uint8Array([ERASED, ERASED, 1, 2, 3, 9, 9, ERASED]) },
    ]);
  });

  it('refuses what does not fit', () => {
    expect(placeImage(file, 64, { at: 0x3c, eraseRest: false })).toBe(
      'the file covers 5 addresses from 0x003C, past the last address 0x003F by 1',
    );
    expect(placeImage(file, 64, { at: 64, eraseRest: false })).toBe(
      'the load address must be 0x0000–0x003F',
    );
    expect(placeImage(file, 64, { at: -1, eraseRest: true })).toBe(
      'the load address must be 0x0000–0x003F',
    );
  });

  it('suggests the file’s own address, or that address in a smaller chip', () => {
    const summary = (low: number, high: number) => ({ low, high, bytes: 1, checksum: 0 });
    expect(suggestedLoadAddress(summary(0x10, 0x20), 0x800)).toBe(0x10);
    // A BE6502 ROM assembled for 0x8000–0xFFFF into an AT28C256 (32 KB).
    expect(suggestedLoadAddress(summary(0x8000, 0xffff), 0x8000)).toBe(0);
    expect(suggestedLoadAddress(summary(0xe000, 0xffff), 0x8000)).toBe(0x6000);
  });

  it('applies the writes to a ROM’s bytes', () => {
    const bytes = new Uint8Array(8).fill(7);
    const writes = placeImage(file, 8, { at: 0, eraseRest: false });
    expect([...applyImageWrites(bytes, writes as never)]).toEqual([1, 2, 3, 9, 9, 7, 7, 7]);
  });
});

describe('writing files', () => {
  it('writes a memory with its unknown bits as 0, counting the bytes that had them', () => {
    const data = new Uint8Array([0xff, 0x0f, 0x12]);
    const unknown = new Uint8Array([0x00, 0x03, 0x00]);
    const { bytes, unknownBytes } = memoryBytes(data, unknown);
    expect([...bytes]).toEqual([0xff, 0x0c, 0x12]);
    expect(unknownBytes).toBe(1);
  });

  it('writes Intel HEX with 16-byte records and the end record', () => {
    const bytes = new Uint8Array(0x40);
    for (let i = 0; i < bytes.length; i++) bytes[i] = readIntelHex(EXAMPLE).chunks[0]!.bytes[i]!;
    expect(writeIntelHex(bytes, { base: 0x100 })).toBe(`${EXAMPLE.replaceAll('\r\n', '\n')}\n`);
  });

  it('leaves out erased records on request and adds 04 records above 64 KB', () => {
    const bytes = new Uint8Array(0x10020).fill(ERASED);
    bytes[0x10] = 0x42;
    bytes[0x10010] = 0x43;
    expect(writeIntelHex(bytes, { omitErased: true }).split('\n')).toEqual([
      `:1000100042${'FF'.repeat(15)}AD`,
      ':020000040001F9',
      `:1000100043${'FF'.repeat(15)}AC`,
      ':00000001FF',
      '',
    ]);
  });

  it('round-trips any sparse image through Intel HEX and binary', () => {
    const random = new SeededRandom(7);
    for (let trial = 0; trial < 40; trial++) {
      const words = 1 << (4 + (random.nextUint32() % 13)); // 16 bytes to 64 KB
      const bytes = new Uint8Array(words).fill(ERASED);
      const runs = 1 + (random.nextUint32() % 6);
      for (let r = 0; r < runs; r++) {
        const at = random.nextUint32() % words;
        const length = Math.min(words - at, 1 + (random.nextUint32() % 40));
        random.fill(bytes.subarray(at, at + length));
      }
      bytes[random.nextUint32() % words] = 0x5a; // at least one programmed byte
      const base = (random.nextUint32() % 4) * 0x8000;
      const hex = readIntelHex(writeIntelHex(bytes, { base, omitErased: true }));
      const summary = summarizeImage(hex);
      const first = summary.low - base; // the first programmed byte's address in the memory
      if (base % words === 0) expect(suggestedLoadAddress(summary, words)).toBe(first);
      const placed = placeImage(hex, words, { at: first, eraseRest: true });
      expect(placed).toEqual([{ address: 0, bytes }]);
      const binary = placeImage(readBinaryImage(bytes), words, { at: 0, eraseRest: false });
      expect(binary).toEqual([{ address: 0, bytes }]);
    }
  });
});
