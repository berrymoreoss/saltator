/**
 * What is under a point, and what a selection box covers. Works on the scene in world
 * coordinates (grid cells); the caller converts a pixel tolerance with the camera scale.
 */
import type { Point, Rect } from '../circuit';
import type { Scene } from './scene';

export type Hit =
  | { readonly kind: 'part'; readonly id: string }
  | { readonly kind: 'wire'; readonly id: string };

/** Squared distance from `p` to the segment `a`–`b`. */
export function segmentDistance2(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

export function rectContainsPoint(rect: Rect, p: Point, margin = 0): boolean {
  return (
    p[0] >= rect.x - margin &&
    p[0] <= rect.x + rect.width + margin &&
    p[1] >= rect.y - margin &&
    p[1] <= rect.y + rect.height + margin
  );
}

/**
 * The item under `point`: a part's body (with `tolerance` around it) or the nearest pin stub or
 * wire within `tolerance` cells. Bodies win; among stubs and wires the nearest wins, parts on
 * ties; later items (drawn on top) win over earlier ones.
 */
export function hitTest(scene: Scene, point: Point, tolerance: number): Hit | undefined {
  const tol2 = tolerance * tolerance;
  for (let i = scene.parts.length - 1; i >= 0; i--) {
    const part = scene.parts[i]!;
    if (rectContainsPoint(part.body, point, tolerance)) return { kind: 'part', id: part.id };
  }
  let best: Hit | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = scene.parts.length - 1; i >= 0; i--) {
    const part = scene.parts[i]!;
    if (!rectContainsPoint(part.bounds, point, tolerance)) continue;
    for (const pin of part.pins) {
      const d = segmentDistance2(point, pin.base, pin.at);
      if (d <= tol2 && d < bestDistance) {
        best = { kind: 'part', id: part.id };
        bestDistance = d;
      }
    }
  }
  for (let i = scene.wires.length - 1; i >= 0; i--) {
    const wire = scene.wires[i]!;
    const d = segmentDistance2(point, wire.from, wire.to);
    if (d <= tol2 && d < bestDistance) {
      best = { kind: 'wire', id: wire.id };
      bestDistance = d;
    }
  }
  return best;
}

/** Box selection modes: items entirely inside the box, or every item the box touches. */
export type BoxMode = 'inside' | 'touching';

/** Normalizes a box dragged from `a` to `b` in any direction. */
export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
}

function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  );
}

/** Ids of the parts and wires a selection box covers. */
export function boxHits(
  scene: Scene,
  box: Rect,
  mode: BoxMode,
): { parts: string[]; wires: string[] } {
  const parts: string[] = [];
  const wires: string[] = [];
  for (const part of scene.parts) {
    const covered =
      mode === 'inside'
        ? rectInside(part.bounds, box)
        : rectsIntersect(part.body, box) ||
          part.pins.some((pin) => rectsIntersect(rectFromPoints(pin.base, pin.at), box));
    if (covered) parts.push(part.id);
  }
  for (const wire of scene.wires) {
    // Wires are axis-aligned, so their own bounding box is the segment.
    const segment = rectFromPoints(wire.from, wire.to);
    if (mode === 'inside' ? rectInside(segment, box) : rectsIntersect(segment, box)) {
      wires.push(wire.id);
    }
  }
  return { parts, wires };
}
