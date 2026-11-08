import { describe, expect, it } from 'vitest';
import { pinsOf, resolveProps, symbolOf } from '../../core';
import { lineWidth, schematicText, TEXT_SIZES, textBlockSize, textLines } from './text';

describe('draw/text', () => {
  it('is schematic-only, without pins, with a multi-line text, a size and a font', () => {
    expect(schematicText.schematicOnly).toBe(true);
    const props = resolveProps(schematicText);
    expect(props).toEqual({ text: 'Text', size: 'normal', font: 'sans' });
    expect(pinsOf(schematicText, props)).toEqual([]);
    expect(schematicText.props?.find((p) => p.key === 'text')?.multiline).toBe(true);
    expect(() => resolveProps(schematicText, { size: 'huge' }, 'TXT1')).toThrow(
      'TXT1: prop "size" must be one of "small", "normal", "large", "title"',
    );
  });

  it('keeps line breaks and any characters in its text', () => {
    const value = 'LDA #$FF  ; load\n\n  ~{CS} [0..7] ✓';
    expect(resolveProps(schematicText, { text: value }).text).toBe(value);
  });

  it('is a box of whole cells around its lines', () => {
    const props = resolveProps(schematicText, { text: 'one\ntwo\nthree', font: 'mono' });
    // 5 characters × 0.6 × 0.7 = 2.1 cells + 2 × 0.2 → 3; 3 lines × 1.25 × 0.7 = 2.625 → 3.
    expect(symbolOf(schematicText, props)).toEqual({ kind: 'text', width: 3, height: 3, pins: {} });
  });

  it('measures the monospaced font exactly and the sans-serif one by character class', () => {
    expect(lineWidth('ABCD', 'mono')).toBeCloseTo(2.4);
    expect(lineWidth('iiii', 'mono')).toBe(lineWidth('MMMM', 'mono'));
    expect(lineWidth('iiii', 'sans')).toBeLessThan(lineWidth('MMMM', 'sans'));
    expect(lineWidth('', 'sans')).toBe(0);
  });

  it('errs a little wide of the system UI font at 10 px', () => {
    // Chromium on macOS (SF Pro), `measureText` at 10 px, in font sizes, to 0.01.
    const measured: [string, number][] = [
      [
        'A W65C02S CPU (U1) runs the program in the AT28C256 EEPROM (U2) and keeps a count and its',
        47.2,
      ],
      ['RDY, IRQB, NMIB, BE and SOB high. DS1-DS4 show the address bus in hex.', 36.11],
      ['6502 ROM and RAM', 9.77],
      ['Wait for it: the LED blinks at 1 Hz.', 16.09],
      ['abcdefghijklmnopqrstuvwxyz', 14.07],
      ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 17.86],
      ['0123456789', 6.17],
      ['mmmmmmmmmm', 8.82],
      ['          ', 2.93],
    ];
    for (const [line, width] of measured) {
      expect(lineWidth(line, 'sans'), line).toBeGreaterThanOrEqual(width - 0.01);
      expect(lineWidth(line, 'sans'), line).toBeLessThan(width * 1.1);
    }
  });

  it('grows with the size and the longest line', () => {
    const long = 'The program counts in RAM';
    const small = textBlockSize(long, 'small', 'sans');
    const title = textBlockSize(long, 'title', 'sans');
    expect(title.width).toBeGreaterThan(2 * small.width);
    expect(title.height).toBeGreaterThan(small.height);
    expect(textBlockSize(`${long}\nshort`, 'small', 'sans').width).toBe(small.width);
    expect(TEXT_SIZES.title / TEXT_SIZES.small).toBe(3);
  });

  it('fits one line of normal text in one cell', () => {
    expect(textBlockSize('A', 'normal', 'sans').height).toBe(1);
    expect(textBlockSize('A\nB', 'normal', 'sans').height).toBe(2);
    expect(textBlockSize('A', 'title', 'sans').height).toBe(2);
  });

  it('is at least one cell, also when empty', () => {
    expect(textBlockSize('', 'small', 'sans')).toEqual({ width: 1, height: 1 });
    expect(textBlockSize('.', 'small', 'mono')).toEqual({ width: 1, height: 1 });
  });

  it('counts empty lines, and a trailing line break as one more line', () => {
    const one = textBlockSize('A', 'title', 'mono').height;
    expect(textBlockSize('A\n\n\nB', 'title', 'mono').height).toBeGreaterThan(3 * one);
    expect(textLines('A\n')).toEqual(['A', '']);
    expect(textLines('A\r\nB')).toEqual(['A', 'B']);
  });

  it('expands tabs to the next multiple of four columns', () => {
    expect(textLines('\tLDA\t#1\nAB\tC')).toEqual(['    LDA #1', 'AB  C']);
  });
});
