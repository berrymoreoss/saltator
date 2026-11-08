/**
 * The program listing drawn on the 6502 ROM and RAM example (a `draw/text`, PLT-1) is what its
 * ROM holds: every byte a listing line gives is U2's at the line's CPU address − $8000, and every
 * programmed byte of U2 is in the listing — so the listing can't drift from the image.
 */
import { describe, expect, it } from 'vitest';
import { exampleDocument } from '../../src/app/example-files';
import { readImage } from '../../src/core';

/** `8009  20 10 80  …`: a CPU address and the bytes there. */
const LINE = /^([0-9A-F]{4}) {2}((?:[0-9A-F]{2} )*[0-9A-F]{2})(?: |$)/;

/** The ROM's window in the CPU's address space: A15 high. */
const ROM_BASE = 0x8000;

describe('the 6502 ROM and RAM listing', () => {
  const main = exampleDocument('6502-rom-ram').circuits[0]!;
  const rom = main.components.find((c) => c.id === 'U2')!;
  const image = readImage(String(rom.props.contents), 0x8000);
  const texts = main.components.filter((c) => c.type === 'draw/text');
  const listing = texts.find((c) => String(c.props.text).includes('.org $8000'))!;

  it('is a monospaced text on the canvas, beside the description', () => {
    expect(rom.type).toBe('mem/at28c256');
    expect(listing.props.font).toBe('mono');
    expect(texts.map((t) => t.id)).toEqual(['TXT1', 'TXT2', 'TXT3']);
  });

  it('lists every byte of the ROM image at its address, and nothing else', () => {
    if (typeof image === 'string') throw new Error(image);
    const listed = new Map<number, number>();
    for (const line of String(listing.props.text).split('\n')) {
      const match = LINE.exec(line);
      if (!match) continue;
      const address = Number.parseInt(match[1]!, 16);
      match[2]!.split(' ').forEach((byte, i) => {
        listed.set(address + i, Number.parseInt(byte, 16));
      });
    }
    expect(listed.size).toBeGreaterThan(20);
    for (const [address, byte] of listed) {
      const offset = address - ROM_BASE;
      expect(offset, `$${address.toString(16)}`).toBeGreaterThanOrEqual(0);
      expect(image[offset], `$${address.toString(16).toUpperCase()}`).toBe(byte);
    }
    image.forEach((byte, offset) => {
      if (byte !== 0xff) {
        expect(listed.has(ROM_BASE + offset), `$${(ROM_BASE + offset).toString(16)}`).toBe(true);
      }
    });
  });
});
