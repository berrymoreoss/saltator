import { describe, expect, it } from 'vitest';
import {
  addressDigits,
  bytesPerRow,
  cellChar,
  cellText,
  type HexCursor,
  hexKey,
  rowAddress,
  scrollToRow,
} from './memory-view';

describe('hex view layout', () => {
  it('writes row addresses with at least 4 digits', () => {
    expect(addressDigits(2048)).toBe(4);
    expect(addressDigits(0x10000)).toBe(4);
    expect(addressDigits(0x20000)).toBe(5);
    expect(rowAddress(0x7f0, 4)).toBe('07F0');
  });

  it('fits 32, 16 or 8 cells a row', () => {
    // 16 cells: 4 + 2 + 48 + 1 + 2 + 16 = 73 characters; 32 cells: 4 + 2 + 96 + 3 + 2 + 32 = 139.
    expect(bytesPerRow(139 * 7, 7, 4)).toBe(32);
    expect(bytesPerRow(139 * 7 - 1, 7, 4)).toBe(16);
    expect(bytesPerRow(73 * 7, 7, 4)).toBe(16);
    expect(bytesPerRow(73 * 7 - 1, 7, 4)).toBe(8);
    expect(bytesPerRow(10, 7, 4)).toBe(8);
  });
});

describe('cells', () => {
  it('shows hex digits, X for nibbles with unknown bits', () => {
    expect(cellText(0x3c, 0, 8)).toBe('3C');
    expect(cellText(0x05, 0x80, 8)).toBe('X5');
    expect(cellText(0x05, 0x01, 8)).toBe('0X');
    expect(cellText(0, 0xff, 8)).toBe('XX');
    expect(cellText(0xa, 0, 4)).toBe('A');
  });

  it('shows printable ASCII in the text column, dots for the rest', () => {
    expect(cellChar(0x41, 0)).toBe('A');
    expect(cellChar(0x20, 0)).toBe(' ');
    expect([cellChar(0x7f, 0), cellChar(0x0a, 0), cellChar(0x41, 1)]).toEqual(['.', '.', '.']);
  });
});

describe('hexKey', () => {
  const context = { words: 64, width: 8, perRow: 16, pageRows: 2 };
  const at = (address: number, typed = ''): HexCursor => ({ address, typed });
  const key = (cursor: HexCursor, k: string) => hexKey(cursor, k, context);

  it('writes a cell when its last digit is typed and moves on', () => {
    const first = key(at(5), 'a');
    expect(first).toEqual({ cursor: at(5, 'A'), handled: true });
    expect(key(first.cursor, '7')).toEqual({
      cursor: at(6),
      write: { address: 5, value: 0xa7 },
      handled: true,
    });
    expect(hexKey(at(5), 'c', { ...context, width: 4 }).write).toEqual({ address: 5, value: 0xc });
  });

  it('writes a half-typed cell on Enter; Escape and Backspace drop it', () => {
    expect(key(at(5, 'A'), 'Enter')).toEqual({
      cursor: at(6),
      write: { address: 5, value: 0xa },
      handled: true,
    });
    expect(key(at(5), 'Enter').handled).toBe(false);
    expect(key(at(5, 'A'), 'Escape')).toEqual({ cursor: at(5), handled: true });
    expect(key(at(5, 'A'), 'Backspace')).toEqual({ cursor: at(5), handled: true });
    expect(key(at(5), 'Escape').handled).toBe(false);
  });

  it('moves with arrows, Home/End and Page Up/Down, inside the memory', () => {
    expect(key(at(20), 'ArrowLeft').cursor).toEqual(at(19));
    expect(key(at(20), 'ArrowRight').cursor).toEqual(at(21));
    expect(key(at(20), 'ArrowUp').cursor).toEqual(at(4));
    expect(key(at(20), 'ArrowDown').cursor).toEqual(at(36));
    expect(key(at(20), 'Home').cursor).toEqual(at(16));
    expect(key(at(20), 'End').cursor).toEqual(at(31));
    expect(key(at(20), 'PageDown').cursor).toEqual(at(52));
    expect(key(at(20), 'PageUp').cursor).toEqual(at(0));
    expect(key(at(0), 'ArrowLeft').cursor).toEqual(at(0));
    expect(key(at(60), 'ArrowDown').cursor).toEqual(at(63));
    expect(key(at(20, 'A'), 'ArrowRight').cursor).toEqual(at(21)); // moving drops what was typed
    expect(key(at(20), 'q').handled).toBe(false);
  });
});

describe('scrollToRow', () => {
  it('scrolls only when the row is out of view', () => {
    expect(scrollToRow(5, 0, 10)).toBeUndefined();
    expect(scrollToRow(12, 0, 10)).toBe(3);
    expect(scrollToRow(2, 4, 10)).toBe(2);
  });
});
