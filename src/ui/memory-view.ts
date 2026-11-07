/**
 * The Memory tab's pure pieces: the hex view's layout (bytes per row, address digits), what a
 * cell shows (hex digits with `X` nibbles, its ASCII character), Go to addresses, and the hex
 * editor's keys. The component (`MemoryPanel`) renders them. Spec: docs/editor.md#memory-tab.
 */

/** Height of one row of the hex view, px (the virtualized list counts rows with it). */
export const ROW_HEIGHT = 18;

/** Hex digits of the row addresses of a memory of `words`: at least 4 (`0x07F0` → `07F0`). */
export function addressDigits(words: number): number {
  return Math.max(4, (Math.max(words, 1) - 1).toString(16).length);
}

/** `07F0` */
export function rowAddress(address: number, digits: number): string {
  return address.toString(16).toUpperCase().padStart(digits, '0');
}

/** Hex digits per cell: one for a 4-bit memory, two for 8 bits. */
export function cellDigits(width: number): number {
  return Math.ceil(width / 4);
}

/**
 * Characters a row of `perRow` cells takes: the address and two spaces, each cell with a space,
 * an extra space between groups of 8, two spaces, the ASCII column.
 */
function rowChars(perRow: number, digits: number, cell: number): number {
  return digits + 2 + perRow * (cell + 1) + (perRow / 8 - 1) + 2 + perRow;
}

/** 8, 16 or 32 cells per row: the most that fit in `width` px at `charWidth` px a character. */
export function bytesPerRow(width: number, charWidth: number, digits: number, cell = 2): number {
  for (const perRow of [32, 16]) {
    if (rowChars(perRow, digits, cell) * charWidth <= width) return perRow;
  }
  return 8;
}

/** A cell's digits, `X` for a nibble with an unknown bit: `3C`, `X5`, `XX`. */
export function cellText(value: number, unknown: number, width: number): string {
  let text = '';
  for (let digit = cellDigits(width) - 1; digit >= 0; digit--) {
    const shift = digit * 4;
    text += (unknown >> shift) & 0xf ? 'X' : ((value >> shift) & 0xf).toString(16).toUpperCase();
  }
  return text;
}

/** The ASCII column: printable ASCII as itself, anything else (or unknown) `.`. */
export function cellChar(value: number, unknown: number): string {
  return unknown === 0 && value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : '.';
}

/** The hex editor's cursor: a cell, and the digits typed into it so far. */
export interface HexCursor {
  readonly address: number;
  /** Digits typed and not yet written (the high nibble first). */
  readonly typed: string;
}

export interface HexKeyContext {
  readonly words: number;
  readonly width: number;
  readonly perRow: number;
  /** Rows a page holds (Page Up / Page Down). */
  readonly pageRows: number;
}

export interface HexKeyResult {
  readonly cursor: HexCursor;
  /** A value to write at an address: the last digit of a cell typed, or Enter. */
  readonly write?: { readonly address: number; readonly value: number };
  /** The key meant something here (the caller then prevents its default and shortcuts). */
  readonly handled: boolean;
}

/**
 * One key in the hex view: hex digits fill the cell (the last one writes it and moves on), Enter
 * writes what was typed, Escape and Backspace drop it, arrows, Home/End and Page Up/Down move.
 */
export function hexKey(cursor: HexCursor, key: string, context: HexKeyContext): HexKeyResult {
  const { words, width, perRow, pageRows } = context;
  const at = (address: number): HexCursor => ({
    address: Math.min(words - 1, Math.max(0, address)),
    typed: '',
  });
  const { address, typed } = cursor;
  if (/^[0-9a-f]$/i.test(key)) {
    const digits = typed + key.toUpperCase();
    if (digits.length < cellDigits(width))
      return { cursor: { address, typed: digits }, handled: true };
    return {
      cursor: at(address + 1),
      write: { address, value: Number.parseInt(digits, 16) },
      handled: true,
    };
  }
  switch (key) {
    case 'Enter':
      if (typed === '') return { cursor, handled: false };
      return {
        cursor: at(address + 1),
        write: { address, value: Number.parseInt(typed, 16) },
        handled: true,
      };
    case 'Escape':
    case 'Backspace':
      return { cursor: { address, typed: '' }, handled: typed !== '' };
    case 'ArrowLeft':
      return { cursor: at(address - 1), handled: true };
    case 'ArrowRight':
      return { cursor: at(address + 1), handled: true };
    case 'ArrowUp':
      return { cursor: at(address - perRow), handled: true };
    case 'ArrowDown':
      return { cursor: at(address + perRow), handled: true };
    case 'Home':
      return { cursor: at(address - (address % perRow)), handled: true };
    case 'End':
      return { cursor: at(address - (address % perRow) + perRow - 1), handled: true };
    case 'PageUp':
      return { cursor: at(address - pageRows * perRow), handled: true };
    case 'PageDown':
      return { cursor: at(address + pageRows * perRow), handled: true };
    default:
      return { cursor, handled: false };
  }
}

/** The first row to scroll to so `row` is in view, or `undefined` when it already is. */
export function scrollToRow(
  row: number,
  firstVisible: number,
  visibleRows: number,
): number | undefined {
  if (row < firstVisible) return row;
  if (row >= firstVisible + visibleRows) return row - visibleRows + 1;
  return undefined;
}
