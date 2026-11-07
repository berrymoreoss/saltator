/**
 * A 74HC4511 driving a common-cathode 7-segment display directly, as on a breadboard (current
 * limiting resistors are not modeled): every BCD code shows its digit, 10–15 are blank.
 */
import { describe, expect, it } from 'vitest';
import { Level } from '../../src/core';
import { isLightsState, Light, SEGMENTS } from '../../src/library';
import { set, simulate } from './support';

const DIGITS: Readonly<Record<number, string>> = {
  0: 'abcdef',
  1: 'bc',
  2: 'abdeg',
  3: 'abcdg',
  4: 'bcfg',
  5: 'acdfg',
  6: 'cdefg', // no tail: the 4511's 6
  7: 'abc',
  8: 'abcdefg',
  9: 'abcfg', // no tail: the 4511's 9
};

describe('a 74HC4511 driving a common-cathode display', () => {
  it('shows every BCD digit and blanks codes 10–15', () => {
    const sim = simulate((b) => {
      b.add('U1', '74xx/74hc4511').add('DS1', 'io/seven-segment', { common: 'cathode' });
      b.add('V', 'io/vcc').add('G', 'io/gnd');
      b.net('vcc', 'V.Y', 'U1.LT', 'U1.BI').net('gnd', 'G.Y', 'U1.LE', 'DS1.COM', 'DS1.dp');
      for (const s of 'abcdefg') b.net(s, `U1.${s}`, `DS1.${s}`);
      for (const pin of 'ABCD')
        b.add(pin, 'test/driver').net(pin.toLowerCase() + '_in', `${pin}.Y`, `U1.${pin}`);
      return b;
    });
    for (let code = 0; code < 16; code++) {
      for (const [n, pin] of [...'ABCD'].entries()) {
        set(sim, pin, (code >> n) & 1 ? Level.L1 : Level.L0);
      }
      sim.settle();
      const state = sim.stateOf('DS1');
      expect(isLightsState(state)).toBe(true);
      if (!isLightsState(state)) return;
      const lit = SEGMENTS.filter((_, i) => state.light[i] === Light.ON).join('');
      expect(lit, `code ${code}`).toBe(DIGITS[code] ?? '');
    }
  });
});
