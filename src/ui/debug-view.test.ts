import { describe, expect, it } from 'vitest';
import { Level, ms, us } from '../core';
import {
  draftOf,
  formatCount,
  formatFrequency,
  formatWall,
  statsRows,
  toDebugTerm,
} from './debug-view';

describe('debug view', () => {
  it('turns dialog drafts into terms and back', () => {
    expect(toDebugTerm({ signal: ' CLK ', condition: 'rise', value: 'x' })).toEqual({
      signal: 'CLK',
      kind: 'rise',
    });
    expect(toDebugTerm({ signal: 'Q', condition: 'level:X', value: '' })).toEqual({
      signal: 'Q',
      kind: 'level',
      level: Level.X,
    });
    const value = toDebugTerm({ signal: 'D[0..7]', condition: 'notEqual', value: ' 2B ' });
    expect(value).toEqual({ signal: 'D[0..7]', kind: 'notEqual', value: '2B' });
    expect(draftOf(value)).toEqual({ signal: 'D[0..7]', condition: 'notEqual', value: '2B' });
    expect(draftOf({ signal: 'Q', kind: 'level', level: Level.L0 }).condition).toBe('level:0');
  });

  it('writes counts, frequencies and wall time in a few digits', () => {
    expect([0, 999, 9999, 12_345, 1_234_567, 4.56e9].map(formatCount)).toEqual([
      '0',
      '999',
      '9999',
      '12.3k',
      '1.23M',
      '4.56G',
    ]);
    expect([1e6, 5e5, 1.5333, 0.25, 0].map(formatFrequency)).toEqual([
      '1 MHz',
      '500 kHz',
      '1.53 Hz',
      '0.25 Hz',
      '—',
    ]);
    expect([850, 12_345].map(formatWall)).toEqual(['850 ms', '12.3 s']);
  });

  it('lists the run statistics since power-on and for the last run', () => {
    const rows = statsRows({
      total: { time: ms(2), wall: 2000, events: 40_000, deltaCycles: 30_000, evaluations: 50_000 },
      last: { time: us(500), wall: 0, events: 0, deltaCycles: 0, evaluations: 0 },
    });
    expect(rows).toEqual([
      ['Simulated time', '2 ms', '500 µs'],
      ['Wall time running', '2 s', '0 ms'],
      ['Events', '40k', '0'],
      ['Delta cycles', '30k', '0'],
      ['Evaluations', '50k', '0'],
      ['Events per second', '20k/s', '—'],
      ['Simulated per second', '1 ms/s', '—'],
    ]);
  });
});
