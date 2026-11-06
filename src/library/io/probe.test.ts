import { describe, expect, it } from 'vitest';
import { Bench } from '../../core/testing';
import { probe } from './probe';

describe('io/probe', () => {
  it.each([0, 1, 'X', 'Z'] as const)('shows %s without complaining', (level) => {
    const bench = new Bench(probe);
    bench.set({ A: level }).settle();
    expect(bench.levels()).toEqual({ A: String(level) });
    bench.expectNoDiagnostics(); // probing a floating net is no mistake
  });
});
