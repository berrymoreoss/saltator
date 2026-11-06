/**
 * Grid geometry shared by layouts, connectivity and (later) the editor. Coordinates are integer
 * grid cells; x grows to the right and y grows downwards, as on a canvas, so a clockwise rotation
 * looks clockwise on screen.
 */
import type { PinSide } from '../core';

/** A grid point `[x, y]`. */
export type Point = readonly [x: number, y: number];

/** Clockwise rotation in degrees. */
export type Rotation = 0 | 90 | 180 | 270;

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/** Largest absolute coordinate a document may use (keeps `pointKey` exact and collision-free). */
export const COORD_LIMIT = 1_000_000;

const KEY_OFFSET = 2 ** 21; // > COORD_LIMIT
const KEY_STRIDE = 2 ** 22;

/** A unique integer key for a point within ±COORD_LIMIT, for maps and union-find. */
export function pointKey(p: Point): number {
  return (p[0] + KEY_OFFSET) * KEY_STRIDE + (p[1] + KEY_OFFSET);
}

/** Inverse of `pointKey`. */
export function pointOfKey(key: number): Point {
  return [Math.floor(key / KEY_STRIDE) - KEY_OFFSET, (key % KEY_STRIDE) - KEY_OFFSET];
}

export function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Orders points by x, then y (deterministic output order). */
export function comparePoints(a: Point, b: Point): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** A placement: mirror horizontally if `flip`, then rotate clockwise, then move to `origin`. */
export interface Placement {
  readonly origin: Point;
  readonly rotation: Rotation;
  readonly flip: boolean;
}

/** Maps a point in a part's local coordinates to grid coordinates. */
export function transformPoint(local: Point, placement: Placement): Point {
  const x = placement.flip ? -local[0] : local[0];
  const y = local[1];
  const [ox, oy] = placement.origin;
  // `+ 0` turns -0 into 0, so results compare equal with toEqual and serialize cleanly.
  switch (placement.rotation) {
    case 0:
      return [ox + x + 0, oy + y + 0];
    case 90:
      return [ox - y + 0, oy + x + 0];
    case 180:
      return [ox - x + 0, oy - y + 0];
    case 270:
      return [ox + y + 0, oy - x + 0];
  }
}

/** Side of a part a pin sticks out of (the same type as core's `PinSide`). */
export type Side = PinSide;

const CLOCKWISE: readonly Side[] = ['left', 'top', 'right', 'bottom'];

/** Side after the same mirror + rotation as `transformPoint`. */
export function transformSide(side: Side, placement: Placement): Side {
  const mirrored = placement.flip && (side === 'left' || side === 'right') ? opposite(side) : side;
  const index = CLOCKWISE.indexOf(mirrored) + placement.rotation / 90;
  return CLOCKWISE[index % 4]!;
}

function opposite(side: Side): Side {
  return CLOCKWISE[(CLOCKWISE.indexOf(side) + 2) % 4]!;
}

/** Axis-aligned rectangle with integer corner `[x, y]` and size. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The grid rectangle covered by a local rectangle after placement. */
export function transformRect(rect: Rect, placement: Placement): Rect {
  const a = transformPoint([rect.x, rect.y], placement);
  const b = transformPoint([rect.x + rect.width, rect.y + rect.height], placement);
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, width: Math.max(a[0], b[0]) - x, height: Math.max(a[1], b[1]) - y };
}

/** True if `a`–`b` is a horizontal or vertical segment of non-zero length. */
export function isAxisAligned(a: Point, b: Point): boolean {
  return (a[0] === b[0]) !== (a[1] === b[1]);
}

/** True if `p` lies on the axis-aligned segment `a`–`b` strictly between its endpoints. */
export function inSegmentInterior(p: Point, a: Point, b: Point): boolean {
  if (a[1] === b[1]) {
    return p[1] === a[1] && p[0] > Math.min(a[0], b[0]) && p[0] < Math.max(a[0], b[0]);
  }
  return p[0] === a[0] && p[1] > Math.min(a[1], b[1]) && p[1] < Math.max(a[1], b[1]);
}
