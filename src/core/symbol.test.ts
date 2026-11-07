import { describe, expect, it } from 'vitest';
import { defineComponent, type PinDef, resolveProps } from './component';
import { pinTextRuns, runsText, type SymbolDef, symbolOf, validateSymbol } from './symbol';

const pins: readonly PinDef[] = [
  { name: 'A', dir: 'in' },
  { name: 'B', dir: 'in' },
  { name: 'Y', dir: 'out' },
];

const symbol: SymbolDef = {
  kind: 'gate-and',
  width: 3,
  height: 4,
  pins: {
    A: { side: 'left', offset: 1 },
    B: { side: 'left', offset: 3 },
    Y: { side: 'right', offset: 2 },
  },
};

const withPins = (changes: Record<string, unknown>): SymbolDef =>
  ({ ...symbol, pins: { ...symbol.pins, ...changes } }) as SymbolDef;

describe('symbolOf', () => {
  it('returns a static symbol, evaluates a prop-dependent one, or undefined', () => {
    const base = { type: 'x/y', name: 'Y', title: 'Y', pins, create: () => ({}) };
    expect(symbolOf(defineComponent({ ...base, symbol }), {})).toBe(symbol);
    expect(symbolOf(defineComponent(base), {})).toBeUndefined();

    const sized = defineComponent<{ size: number }, undefined>({
      ...base,
      props: [{ key: 'size', label: 'Size', type: 'integer', default: 5 }],
      symbol: ({ size }) => ({ ...symbol, width: size }),
    });
    expect(symbolOf(sized, resolveProps(sized))?.width).toBe(5);
  });
});

describe('validateSymbol', () => {
  it('accepts a symbol that places every pin on its edge, corners included', () => {
    expect(() => validateSymbol(symbol, pins, 'x/y')).not.toThrow();
    const corners = withPins({
      A: { side: 'top', offset: 0 },
      B: { side: 'left', offset: 0 },
      Y: { side: 'bottom', offset: 3 },
    });
    expect(() => validateSymbol(corners, pins, 'x/y')).not.toThrow();
  });

  it.each([
    [{ ...symbol, kind: '' }, 'x/y: empty symbol kind'],
    [{ ...symbol, width: 0 }, 'x/y: symbol width must be a positive integer, got 0'],
    [{ ...symbol, height: 2.5 }, 'x/y: symbol height must be a positive integer, got 2.5'],
    [withPins({ Q: { side: 'left', offset: 2 } }), 'x/y: symbol places unknown pin "Q"'],
    [withPins({ Y: undefined }), 'x/y: symbol does not place pin "Y"'],
    [withPins({ Y: { side: 'up', offset: 1 } }), 'x/y: pin "Y" has an invalid side "up"'],
    [
      withPins({ Y: { side: 'right', offset: 5 } }),
      'x/y: pin "Y" offset must be an integer 0…4 on the right side, got 5',
    ],
    [
      withPins({ Y: { side: 'top', offset: 4 } }),
      'x/y: pin "Y" offset must be an integer 0…3 on the top side, got 4',
    ],
    [
      withPins({ Y: { side: 'bottom', offset: -1 } }),
      'x/y: pin "Y" offset must be an integer 0…3 on the bottom side, got -1',
    ],
    [
      withPins({ Y: { side: 'right', offset: 1.5 } }),
      'x/y: pin "Y" offset must be an integer 0…4 on the right side, got 1.5',
    ],
    [withPins({ B: { side: 'left', offset: 1 } }), 'x/y: pins "A" and "B" are on the same point'],
  ])('rejects %#', (bad, message) => {
    expect(() => validateSymbol(bad as SymbolDef, pins, 'x/y')).toThrow(message);
  });
});

describe('pinTextRuns', () => {
  const runs = (name: string, activeLow: boolean, label?: string) =>
    pinTextRuns({ name, activeLow, ...(label !== undefined && { label }) }).map(
      (r) => `${r.overline ? '‾' : ''}${r.text}`,
    );

  it("overlines an active-LOW pin's letters, not its digits, as the data sheets do", () => {
    expect(runs('OE', true)).toEqual(['‾OE']);
    expect(runs('1RD', true)).toEqual(['1', '‾RD']);
    expect(runs('E1', true)).toEqual(['‾E', '1']);
    expect(runs('1Y0', true)).toEqual(['1', '‾Y', '0']);
    expect(runs('1QN', true, '1Q')).toEqual(['1', '‾Q']);
    expect(runs('D0', false)).toEqual(['D0']);
  });

  it('draws a label that marks its overlined characters as marked', () => {
    expect(runs('UD', false, 'U\u0305/D')).toEqual(['‾U', '/D']);
    expect(runs('Q0N', true, 'Q\u03050\u0305')).toEqual(['‾Q0']);
  });

  it('draws another text when given one, and gives back the plain text', () => {
    expect(pinTextRuns({ name: 'NC3' }, 'NC')).toEqual([{ text: 'NC', overline: false }]);
    expect(runsText(pinTextRuns({ name: 'UD', label: 'U\u0305/D' }))).toBe('U/D');
  });
});
