import { describe, expect, it } from 'vitest';
import { CIRCUIT_ID, circuitIdFor } from './document';

describe('circuitIdFor', () => {
  it('turns a name into a slug', () => {
    expect(circuitIdFor('Decade Counter')).toBe('decade-counter');
    expect(circuitIdFor('  8-Bit  Register (A) ')).toBe('8-bit-register-a');
    expect(circuitIdFor('Mémoire')).toBe('memoire');
  });

  it('falls back to "circuit" when nothing is left', () => {
    expect(circuitIdFor('***')).toBe('circuit');
    expect(circuitIdFor('')).toBe('circuit');
  });

  it('numbers a taken id', () => {
    expect(circuitIdFor('Main', ['main'])).toBe('main-2');
    expect(circuitIdFor('Main', ['main', 'main-2'])).toBe('main-3');
  });

  it('always gives a valid circuit id', () => {
    for (const name of ['A', 'a b', '-x-', 'Ünïcödé', '1', 'ALU / 2']) {
      expect(circuitIdFor(name)).toMatch(CIRCUIT_ID);
    }
  });
});
