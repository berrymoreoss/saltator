import { describe, expect, it } from 'vitest';
import {
  describeImage,
  type ImageFileInfo,
  imageFileBytes,
  imageFileName,
  readImageForLoad,
} from './image-dialogs';

const ascii = (text: string) => new TextEncoder().encode(text);

describe('loading a file', () => {
  it('reads a binary file and describes it as a programmer does', () => {
    const info = readImageForLoad('rom.bin', new Uint8Array([1, 2, 0xff]));
    expect(info).toMatchObject({ name: 'rom.bin', format: 'binary' });
    expect(describeImage((info as ImageFileInfo).summary)).toBe(
      '0x0000–0x0002 · 3 bytes · sum 0x0102',
    );
  });

  it('reads Intel HEX, even under another extension', () => {
    const info = readImageForLoad('prog.txt', ascii(':03001000010203E7\n:00000001FF\n'));
    expect(info).toMatchObject({ format: 'intel-hex' });
    expect(describeImage((info as ImageFileInfo).summary)).toBe(
      '0x0010–0x0012 · 3 bytes · sum 0x0006',
    );
  });

  it('says why a file can’t be loaded', () => {
    expect(readImageForLoad('bad.hex', ascii(':0100000042BE\n:00000001FF'))).toBe(
      'bad.hex: line 1: checksum 0xBE, expected 0xBD',
    );
    expect(readImageForLoad('empty.bin', new Uint8Array())).toBe('empty.bin: the file is empty');
  });
});

describe('saving a file', () => {
  const bytes = new Uint8Array(32).fill(0xff);
  bytes[0x11] = 0x42;

  it('writes the bytes as they are, or Intel HEX text', () => {
    expect([...imageFileBytes(bytes, { kind: 'binary', base: 0, omitErased: true })]).toEqual([
      ...bytes,
    ]);
    const hex = new TextDecoder().decode(
      imageFileBytes(bytes, { kind: 'intel-hex', base: 0x8000, omitErased: true }),
    );
    expect(hex).toBe(`:10801000FF42${'FF'.repeat(14)}2D\n:00000001FF\n`);
  });

  it('names the file after the memory', () => {
    expect([imageFileName('U3', 'binary'), imageFileName('U3', 'intel-hex')]).toEqual([
      'U3.bin',
      'U3.hex',
    ]);
  });
});
