import { describe, expect, it } from 'vitest';
import {
  COORD_LIMIT,
  comparePoints,
  inSegmentInterior,
  isAxisAligned,
  isRotation,
  type Placement,
  type Point,
  pointKey,
  pointOfKey,
  ROTATIONS,
  type Side,
  samePoint,
  transformPoint,
  transformRect,
  transformSide,
} from './geometry';

const at = (rotation: Placement['rotation'], flip = false, origin: Point = [0, 0]): Placement => ({
  origin,
  rotation,
  flip,
});

describe('pointKey', () => {
  it('is unique and reversible across the coordinate range', () => {
    const points: Point[] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [COORD_LIMIT, -COORD_LIMIT],
      [-COORD_LIMIT, COORD_LIMIT],
    ];
    const keys = points.map(pointKey);
    expect(new Set(keys).size).toBe(points.length);
    for (const [i, key] of keys.entries()) {
      expect(Number.isSafeInteger(key)).toBe(true);
      expect(pointOfKey(key)).toEqual(points[i]);
    }
  });
});

describe('points', () => {
  it('compares by x, then y', () => {
    const sorted = (
      [
        [2, 0],
        [1, 5],
        [1, -1],
      ] as Point[]
    ).sort(comparePoints);
    expect(sorted).toEqual([
      [1, -1],
      [1, 5],
      [2, 0],
    ]);
    expect(samePoint([1, 2], [1, 2])).toBe(true);
    expect(samePoint([1, 2], [2, 1])).toBe(false);
  });

  it('recognizes rotations', () => {
    expect(ROTATIONS.every(isRotation)).toBe(true);
    expect([45, -90, 360, '90', null].some(isRotation)).toBe(false);
  });
});

describe('transformPoint', () => {
  // A pin to the right of the origin and one below it.
  const right: Point = [2, 0];
  const below: Point = [0, 1];

  it('rotates clockwise on screen (y grows downwards)', () => {
    expect([right, below].map((p) => transformPoint(p, at(0)))).toEqual([
      [2, 0],
      [0, 1],
    ]);
    expect([right, below].map((p) => transformPoint(p, at(90)))).toEqual([
      [0, 2],
      [-1, 0],
    ]);
    expect([right, below].map((p) => transformPoint(p, at(180)))).toEqual([
      [-2, 0],
      [0, -1],
    ]);
    expect([right, below].map((p) => transformPoint(p, at(270)))).toEqual([
      [0, -2],
      [1, 0],
    ]);
  });

  it('mirrors horizontally before rotating, then translates', () => {
    expect(transformPoint(right, at(0, true))).toEqual([-2, 0]);
    expect(transformPoint(below, at(0, true))).toEqual([0, 1]);
    expect(transformPoint(right, at(90, true))).toEqual([0, -2]);
    expect(transformPoint(right, at(90, true, [10, 20]))).toEqual([10, 18]);
  });

  it('never produces -0', () => {
    for (const rotation of ROTATIONS) {
      for (const flip of [false, true]) {
        const [x, y] = transformPoint([0, 0], at(rotation, flip));
        expect(Object.is(x, 0) && Object.is(y, 0)).toBe(true);
      }
    }
  });
});

describe('transformSide', () => {
  it('follows the rotation clockwise', () => {
    expect(ROTATIONS.map((r) => transformSide('left', at(r)))).toEqual([
      'left',
      'top',
      'right',
      'bottom',
    ]);
    expect(transformSide('bottom', at(90))).toBe('left');
  });

  it('mirrors left/right but not top/bottom', () => {
    expect(transformSide('left', at(0, true))).toBe('right');
    expect(transformSide('top', at(0, true))).toBe('top');
    expect(transformSide('left', at(90, true))).toBe('bottom');
  });

  it('agrees with transformPoint for a pin sticking out of a unit box', () => {
    const pins: [Side, Point][] = [
      ['left', [-1, 0]],
      ['top', [0, -1]],
      ['right', [1, 0]],
      ['bottom', [0, 1]],
    ];
    const sideOf = ([x, y]: Point) => pins.find(([, p]) => p[0] === x && p[1] === y)![0];
    for (const rotation of ROTATIONS) {
      for (const flip of [false, true]) {
        for (const [side, p] of pins) {
          expect(transformSide(side, at(rotation, flip))).toBe(
            sideOf(transformPoint(p, at(rotation, flip))),
          );
        }
      }
    }
  });
});

describe('transformRect', () => {
  const rect = { x: 0, y: 0, width: 4, height: 2 };

  it('normalizes the corners after rotation and mirroring', () => {
    expect(transformRect(rect, at(0, false, [5, 5]))).toEqual({ x: 5, y: 5, width: 4, height: 2 });
    expect(transformRect(rect, at(90))).toEqual({ x: -2, y: 0, width: 2, height: 4 });
    expect(transformRect(rect, at(180))).toEqual({ x: -4, y: -2, width: 4, height: 2 });
    expect(transformRect(rect, at(0, true))).toEqual({ x: -4, y: 0, width: 4, height: 2 });
  });
});

describe('segments', () => {
  it('accepts only horizontal or vertical segments of non-zero length', () => {
    expect(isAxisAligned([0, 0], [3, 0])).toBe(true);
    expect(isAxisAligned([0, 3], [0, -1])).toBe(true);
    expect(isAxisAligned([0, 0], [0, 0])).toBe(false);
    expect(isAxisAligned([0, 0], [1, 1])).toBe(false);
  });

  it('finds points strictly inside a segment', () => {
    expect(inSegmentInterior([1, 0], [0, 0], [3, 0])).toBe(true);
    expect(inSegmentInterior([1, 0], [3, 0], [0, 0])).toBe(true);
    expect(inSegmentInterior([0, 0], [0, 0], [3, 0])).toBe(false); // an end, not the interior
    expect(inSegmentInterior([3, 0], [0, 0], [3, 0])).toBe(false);
    expect(inSegmentInterior([1, 1], [0, 0], [3, 0])).toBe(false);
    expect(inSegmentInterior([0, 2], [0, 0], [0, 3])).toBe(true);
    expect(inSegmentInterior([1, 2], [0, 0], [0, 3])).toBe(false);
  });
});
