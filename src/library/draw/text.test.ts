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
