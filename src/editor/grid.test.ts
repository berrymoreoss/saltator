import { describe, expect, it } from 'vitest';
import { gridSpacing } from './grid';
import { intersects } from './renderer';

describe('gridSpacing', () => {
  it('shows every cell at 100 % with a major dot every 10 cells', () => {
    expect(gridSpacing(16)).toEqual({ step: 1, major: 10 });
  });

  it('thins dots out when zoomed out', () => {
    expect(gridSpacing(4)).toEqual({ step: 5, major: 10 });
    expect(gridSpacing(1)).toEqual({ step: 10, major: 100 });
    expect(gridSpacing(0.01)).toEqual({ step: 1000, major: 10000 });
  });
});

describe('intersects', () => {
  it('detects overlap with a margin', () => {
    const a = { x: 0, y: 0, width: 2, height: 2 };
    expect(intersects(a, { x: 2, y: 2, width: 1, height: 1 })).toBe(true);
    expect(intersects(a, { x: 3, y: 0, width: 1, height: 1 })).toBe(false);
    expect(intersects(a, { x: 3, y: 0, width: 1, height: 1 }, 1)).toBe(true);
  });
});
