/**
 * Routing for the wire tool: the L-shaped path from the last fixed point to the pointer, which
 * way it bends, and where a new path would connect to what is already drawn. Pure.
 * Spec: docs/editor.md#drawing-wires.
 */
import { type Point, pointKey, type Side } from '../circuit';
import type { Scene } from './scene';

/** Which leg of an L comes first. */
export type Posture = 'horizontal' | 'vertical';

export const otherPosture = (p: Posture): Posture =>
  p === 'horizontal' ? 'vertical' : 'horizontal';

/**
 * The points after `from` on the way to `to`: `[to]` when they line up, `[corner, to]` for an L
 * whose first leg follows `posture`, `[]` when they coincide.
 */
export function routeL(from: Point, to: Point, posture: Posture): Point[] {
  if (from[0] === to[0] && from[1] === to[1]) return [];
  if (from[0] === to[0] || from[1] === to[1]) return [to];
  const corner: Point = posture === 'horizontal' ? [to[0], from[1]] : [from[0], to[1]];
  return [corner, to];
}

/** Straight segments through a polyline's points (repeated points skipped). */
export function polylineSegments(points: readonly Point[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([a, b]);
  }
  return out;
}

/**
 * What is drawn where, for routing: pin tips, wire ends, wires by row and column — of one layer,
 * wires and their pins or (`bus`) bus lines and bus pins, which never connect to each other.
 * Built once per gesture from the committed scene.
 */
export class ConnectionIndex {
  readonly #pins = new Map<number, Side>();
  readonly #ends = new Set<number>();
  readonly #rows = new Map<number, [number, number][]>();
  readonly #cols = new Map<number, [number, number][]>();

  constructor(scene: Scene, bus = false) {
    for (const part of scene.parts) {
      for (const pin of part.pins) if (pin.bus === bus) this.#pins.set(pointKey(pin.at), pin.side);
    }
    for (const { from, to, bus: line } of scene.wires) {
      if (line !== bus) continue;
      this.#ends.add(pointKey(from));
      this.#ends.add(pointKey(to));
      const horizontal = from[1] === to[1];
      const map = horizontal ? this.#rows : this.#cols;
      const key = horizontal ? from[1] : from[0];
      const span: [number, number] = horizontal
        ? [Math.min(from[0], to[0]), Math.max(from[0], to[0])]
        : [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
      const list = map.get(key);
      if (list) list.push(span);
      else map.set(key, [span]);
    }
  }

  /** Side of the pin whose tip is at `p`, if any. */
  pinSide(p: Point): Side | undefined {
    return this.#pins.get(pointKey(p));
  }

  /** A wire ending at `p` would connect: a pin tip, a wire end or a wire's interior. */
  connectsEnd(p: Point): boolean {
    const key = pointKey(p);
    if (this.#pins.has(key) || this.#ends.has(key)) return true;
    const on = (spans: [number, number][] | undefined, at: number) =>
      spans?.some(([lo, hi]) => at >= lo && at <= hi) === true;
    return on(this.#rows.get(p[1]), p[0]) || on(this.#cols.get(p[0]), p[1]);
  }

  /** A wire passing through `p` would connect: a pin tip or a wire end (crossings don't). */
  connectsInterior(p: Point): boolean {
    const key = pointKey(p);
    return this.#pins.has(key) || this.#ends.has(key);
  }
}

/**
 * The posture a leg starting at `from` takes: out of a pin head-on, at a right angle to the
 * previous leg, otherwise along the axis the pointer moved along most.
 */
export function legPosture(
  index: ConnectionIndex,
  from: Point,
  previous: Point | undefined,
  pointer: Point,
): Posture {
  const side = index.pinSide(from);
  if (side) return side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
  if (previous) return previous[1] === from[1] ? 'vertical' : 'horizontal';
  return Math.abs(pointer[0] - from[0]) >= Math.abs(pointer[1] - from[1])
    ? 'horizontal'
    : 'vertical';
}

/** Points where a new path touches what is drawn, so it will connect there (sorted by path). */
export function pathConnections(index: ConnectionIndex, points: readonly Point[]): Point[] {
  const seen = new Set<number>();
  const out: Point[] = [];
  const add = (p: Point) => {
    const key = pointKey(p);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  };
  const segments = polylineSegments(points);
  if (segments.length === 0) {
    if (points[0] && index.connectsEnd(points[0])) add(points[0]);
    return out;
  }
  for (const [a, b] of segments) {
    const dx = Math.sign(b[0] - a[0]);
    const dy = Math.sign(b[1] - a[1]);
    const n = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    for (let i = 0; i <= n; i++) {
      const p: Point = [a[0] + dx * i, a[1] + dy * i];
      // Segment ends (the path's ends and corners) connect to wire interiors too.
      if (i === 0 || i === n ? index.connectsEnd(p) : index.connectsInterior(p)) add(p);
    }
  }
  return out;
}
