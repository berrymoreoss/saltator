import { defineComponent, Level, type PinDef } from '../../core';
import { type LedColor, ledColorProp } from './lights';

/**
 * The digit a hex display shows for its inputs `D0`…`D3` (levels, D0 first): 0–15, or `undefined`
 * when any input is `X` or `Z`.
 */
export function hexDigit(levels: readonly Level[]): number | undefined {
  let value = 0;
  for (let i = levels.length - 1; i >= 0; i--) {
    const level = levels[i];
    if (level !== Level.L0 && level !== Level.L1) return undefined;
    value = value * 2 + level;
  }
  return value;
}

/**
 * Hex digit display (abstract, like Logisim's): shows the 4-bit value on `D0`…`D3` as 0–F, or an
 * unknown mark if any input is `X`/`Z`. Stateless: the renderer reads the pin levels and calls
 * `hexDigit`.
 */
export const hexDisplay = defineComponent<{ color: LedColor }, undefined>({
  type: 'io/hex-display',
  name: 'HEX',
  title: 'Hex digit display',
  keywords: ['hex', 'digit', 'display', 'nibble', 'output', 'til311'],
  props: [ledColorProp],
  pins: ['D0', 'D1', 'D2', 'D3'].map((name): PinDef => ({ name, dir: 'in', sense: true })),
  // Inputs along the bottom, most significant bit on the left.
  symbol: {
    kind: 'hex-display',
    width: 5,
    height: 7,
    pins: {
      D3: { side: 'bottom', offset: 1 },
      D2: { side: 'bottom', offset: 2 },
      D1: { side: 'bottom', offset: 3 },
      D0: { side: 'bottom', offset: 4 },
    },
  },
  create: () => ({}),
});
