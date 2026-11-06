import { describe, expect, it } from 'vitest';
import { type Placement, ROTATIONS, transformPoint } from '../circuit';
import { placementMatrix, uprightText } from './graphics';

const placements: Placement[] = ROTATIONS.flatMap((rotation) =>
  [false, true].map((flip) => ({ origin: [3, -2] as const, rotation, flip })),
);

describe('placementMatrix', () => {
  it('matches transformPoint for every placement', () => {
    for (const placement of placements) {
      const [a, b, c, d, e, f] = placementMatrix(placement);
      for (const [x, y] of [
        [0, 0],
        [2, 1],
        [-1, 5],
      ] as const) {
        expect([a * x + c * y + e, b * x + d * y + f]).toEqual(transformPoint([x, y], placement));
      }
    }
  });
});

describe('uprightText', () => {
  const at = (rotation: 0 | 90 | 180 | 270, flip = false): Placement => ({
    origin: [0, 0],
    rotation,
    flip,
  });

  it('keeps horizontal text as is when not rotated', () => {
    expect(uprightText(at(0), { align: 'left', baseline: 'top' })).toEqual({
      angle: 0,
      align: 'left',
      baseline: 'top',
    });
  });

  it('turns text upright on a part rotated by 180°', () => {
    // Local +x points left on screen: left-aligned text must extend to the left.
    expect(uprightText(at(180), { align: 'left', baseline: 'top' })).toEqual({
      angle: 0,
      align: 'right',
      baseline: 'bottom',
    });
  });

  it('reads vertical text bottom-to-top', () => {
    // Rotated 90° clockwise, local +x points down; text reads upwards, so `left` becomes `right`.
    expect(uprightText(at(90), { align: 'left', baseline: 'middle' })).toEqual({
      angle: -90,
      align: 'right',
      baseline: 'middle',
    });
    expect(uprightText(at(270), { align: 'left', baseline: 'middle' })).toEqual({
      angle: -90,
      align: 'left',
      baseline: 'middle',
    });
  });

  it('never mirrors text on flipped parts', () => {
    expect(uprightText(at(0, true), { align: 'left', baseline: 'top' })).toEqual({
      angle: 0,
      align: 'right',
      baseline: 'top',
    });
  });

  it('rotates text written along local y', () => {
    expect(uprightText(at(0), { rotate: 90, align: 'center' }).angle).toBe(-90);
    expect(uprightText(at(90), { rotate: 90, align: 'center' }).angle).toBe(0);
  });

  it('is horizontal or bottom-to-top in all 8 placements', () => {
    for (const placement of placements) {
      for (const rotate of [0, 90] as const) {
        expect([0, -90]).toContain(uprightText(placement, { rotate }).angle);
      }
    }
  });
});
