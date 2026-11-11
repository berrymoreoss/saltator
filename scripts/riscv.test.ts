import { describe, expect, it } from 'vitest';
import { hexImage } from './riscv.ts';

describe('hexImage', () => {
  it('packs bytes into 32-bit words little-endian, one a line', () => {
    const bytes = Uint8Array.of(0x37, 0x11, 0x00, 0x00, 0xef, 0x00, 0x80, 0x00);
    expect(hexImage(bytes)).toBe('00001137\n008000ef\n');
  });

  it('pads the last word with zeros and puts the header first as comments', () => {
    expect(hexImage(Uint8Array.of(0xff, 0x01), ['made by a script', ''])).toBe(
      '// made by a script\n//\n000001ff\n',
    );
  });
});
