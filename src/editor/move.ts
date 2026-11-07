/**
 * Moving, rotating and flipping a selection while its wires stay connected (rubber-banding).
 * A transform maps every moving point — pin tips of moved parts, ends of selected wires and
 * whatever was attached to a selected wire's middle — and gives moved parts their new placement.
 * For each moving point that touched something fixed before:
 *
 * 1. an unselected wire with both ends moving moves along;
 * 2. an unselected wire with one end there follows it: stretched if it stays straight; else, if
 *    its fixed end is a plain corner (one perpendicular wire, nothing else), the corner slides
 *    and the neighbour stretches (KiCad's drag); else it becomes a Z bent at the midpoint, so
 *    both ends keep their direction;
 * 3. a fixed pin or a fixed wire's interior there gets a new wire from the old point to the new
 *    one, leaving a pin head-on (one cell out before turning) and a wire at a right angle.
 *
 * Bus lines and wires are separate layers (bus lines connect only to bus lines and bus pins):
 * each layer rubber-bands on its own, and new segments take the layer of what they continue.
 * The result is not normalized (`Editor.edit` does that). Pure. Spec: docs/editor.md#moving.
 */
import {
  type Circuit,
  type ComponentInstance,
  IdAllocator,
  type Point,
  pointKey,
  type Rotation,
  type Side,
  WIRE_PREFIX,
  type Wire,
} from '../circuit';
import type { Scene } from './scene';
import type { Selection } from './selection';

/** Where moving points and moved parts go. */
export interface ItemTransform {
  point(p: Point): Point;
  placement(instance: ComponentInstance): Pick<ComponentInstance, 'x' | 'y' | 'rotation' | 'flip'>;
}

const rot = (r: number): Rotation => (((r % 360) + 360) % 360) as Rotation;

export function translation(dx: number, dy: number): ItemTransform {
  return {
    point: (p) => [p[0] + dx, p[1] + dy],
    placement: (c) => ({ x: c.x + dx, y: c.y + dy, rotation: c.rotation, flip: c.flip }),
  };
}

/** A quarter turn about a grid point, clockwise (as on screen) or counter-clockwise. */
export function rotation(center: Point, clockwise: boolean): ItemTransform {
  const [cx, cy] = center;
  // Clockwise with y down: (x, y) → (−y, x) about the center.
  const turn = (p: Point): Point =>
    clockwise ? [cx - (p[1] - cy), cy + (p[0] - cx)] : [cx + (p[1] - cy), cy - (p[0] - cx)];
  return {
    point: turn,
    placement: (c) => {
      const [x, y] = turn([c.x, c.y]);
      return { x, y, rotation: rot(c.rotation + (clockwise ? 90 : 270)), flip: c.flip };
    },
  };
}

/**
 * A mirror image: `horizontal` swaps left and right (about the vertical line through the center),
 * `vertical` swaps top and bottom. A part's own flip is horizontal, so mirroring it toggles the
 * flip and negates the rotation (plus a half turn for a vertical mirror).
 */
export function mirror(center: Point, direction: 'horizontal' | 'vertical'): ItemTransform {
  const [cx, cy] = center;
  const horizontal = direction === 'horizontal';
  const reflect = (p: Point): Point => (horizontal ? [2 * cx - p[0], p[1]] : [p[0], 2 * cy - p[1]]);
  return {
    point: reflect,
    placement: (c) => {
      const [x, y] = reflect([c.x, c.y]);
      return { x, y, rotation: rot((horizontal ? 0 : 180) - c.rotation), flip: !c.flip };
    },
  };
}

type Segment = readonly [Point, Point];

/** Direction a pin on each side points away from its part. */
const OUTWARD: Readonly<Record<Side, Point>> = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
};

interface Line {
  /** Wires lying on a row (horizontal, keyed by y) or a column (vertical, keyed by x). */
  readonly rows: Map<number, number[]>;
  readonly cols: Map<number, number[]>;
}

function lineIndex(wires: readonly Wire[], include: (i: number) => boolean): Line {
  const rows = new Map<number, number[]>();
  const cols = new Map<number, number[]>();
  wires.forEach((w, i) => {
    if (!include(i)) return;
    const horizontal = w.from[1] === w.to[1];
    const map = horizontal ? rows : cols;
    const key = horizontal ? w.from[1] : w.from[0];
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  });
  return { rows, cols };
}

/** Index of a wire (from `index`) whose interior contains `p`, or -1. */
function interiorAt(wires: readonly Wire[], index: Line, p: Point): number {
  const inside = (i: number, along: 0 | 1) => {
    const w = wires[i]!;
    const lo = Math.min(w.from[along], w.to[along]);
    const hi = Math.max(w.from[along], w.to[along]);
    return p[along] > lo && p[along] < hi;
  };
  for (const i of index.rows.get(p[1]) ?? []) if (inside(i, 0)) return i;
  for (const i of index.cols.get(p[0]) ?? []) if (inside(i, 1)) return i;
  return -1;
}

const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];

/** Applies a transform to the selected parts and wires, keeping their connections. */
export function transformItems(scene: Scene, items: Selection, t: ItemTransform): Circuit {
  const { circuit } = scene;
  const out: Wire[] = [...circuit.wires];
  const extra = [false, true].map((bus) => transformLayer(scene, items, t, bus, out));
  const components = circuit.components.map((c) =>
    items.parts.has(c.id) ? { ...c, ...t.placement(c) } : c,
  );
  const ids = IdAllocator.of(circuit);
  const added = extra.flatMap((segments, layer) =>
    segments
      .filter(([a, b]) => !same(a, b))
      .map(([from, to]): Wire => {
        const id = ids.next(WIRE_PREFIX);
        return layer === 1 ? { id, from, to, bus: true } : { id, from, to };
      }),
  );
  return { ...circuit, components, wires: [...out, ...added] };
}

/**
 * Rubber-bands one layer (bus lines and bus pins, or wires and the other pins): updates its
 * wires in `out` and returns the new segments it needs.
 */
function transformLayer(
  scene: Scene,
  items: Selection,
  t: ItemTransform,
  bus: boolean,
  out: Wire[],
): Segment[] {
  const wires = scene.circuit.wires;
  const inLayer = (i: number) => (wires[i]!.bus === true) === bus;
  const selectedWire = (i: number) => items.wires.has(wires[i]!.id);
  const pinsOf = (part: Scene['parts'][number]) => part.pins.filter((pin) => pin.bus === bus);

  // Fixed things by point.
  const fixedPins = new Map<number, Side>();
  for (const part of scene.parts) {
    if (items.parts.has(part.id)) continue;
    for (const pin of pinsOf(part)) fixedPins.set(pointKey(pin.at), pin.side);
  }
  const fixedEnds = new Map<number, number[]>();
  wires.forEach((w, i) => {
    if (!inLayer(i) || selectedWire(i)) return;
    for (const end of [w.from, w.to]) {
      const key = pointKey(end);
      const list = fixedEnds.get(key);
      if (list) list.push(i);
      else fixedEnds.set(key, [i]);
    }
  });
  const fixedLines = lineIndex(wires, (i) => inLayer(i) && !selectedWire(i));
  const movingLines = lineIndex(wires, (i) => inLayer(i) && selectedWire(i));

  // Moving points: pin tips of moved parts, ends of selected wires, and fixed wire ends or pins
  // sitting on a selected wire's interior (they were connected to it).
  const moving = new Map<number, Point>();
  const addMoving = (p: Point) => moving.set(pointKey(p), p);
  for (const part of scene.parts) {
    if (items.parts.has(part.id)) for (const pin of pinsOf(part)) addMoving(pin.at);
  }
  wires.forEach((w, i) => {
    if (inLayer(i) && selectedWire(i)) {
      addMoving(w.from);
      addMoving(w.to);
    }
  });
  if (movingLines.rows.size + movingLines.cols.size > 0) {
    const attached = (p: Point) => {
      if (interiorAt(wires, movingLines, p) >= 0) addMoving(p);
    };
    for (const part of scene.parts) {
      if (!items.parts.has(part.id)) for (const pin of pinsOf(part)) attached(pin.at);
    }
    wires.forEach((w, i) => {
      if (inLayer(i) && !selectedWire(i)) {
        attached(w.from);
        attached(w.to);
      }
    });
  }
  const isMoving = (p: Point) => moving.has(pointKey(p));

  const extra: Segment[] = [];
  const claimed = new Set<number>();

  // Selected wires move with the selection.
  wires.forEach((w, i) => {
    if (inLayer(i) && selectedWire(i)) out[i] = { ...w, from: t.point(w.from), to: t.point(w.to) };
  });

  /** The single perpendicular wire at a plain corner `a` of wire `i`, or -1. */
  const plainCorner = (i: number, a: Point): number => {
    const key = pointKey(a);
    if (fixedPins.has(key)) return -1;
    const others = (fixedEnds.get(key) ?? []).filter((j) => j !== i);
    if (others.length !== 1) return -1;
    const j = others[0]!;
    if (claimed.has(j)) return -1;
    const v = wires[j]!;
    const horizontal = (w: Wire) => w.from[1] === w.to[1];
    if (horizontal(v) === horizontal(wires[i]!)) return -1;
    const far = same(v.from, a) ? v.to : v.from;
    if (isMoving(far)) return -1;
    if (interiorAt(wires, fixedLines, a) >= 0 || interiorAt(wires, movingLines, a) >= 0) return -1;
    return j;
  };

  wires.forEach((w, i) => {
    if (!inLayer(i) || selectedWire(i)) return;
    const fromMoves = isMoving(w.from);
    const toMoves = isMoving(w.to);
    if (fromMoves && toMoves) {
      out[i] = { ...w, from: t.point(w.from), to: t.point(w.to) };
      return;
    }
    if (!fromMoves && !toMoves) return;
    const m = fromMoves ? w.from : w.to;
    const a = fromMoves ? w.to : w.from;
    const m2 = t.point(m);
    if (same(m, m2)) return;
    const horizontal = w.from[1] === w.to[1];
    const along = horizontal ? 1 : 0; // the coordinate that must stay equal along the wire
    const put = (s: Segment) =>
      fromMoves ? { ...w, from: s[1], to: s[0] } : { ...w, from: s[0], to: s[1] };
    if (a[along] === m2[along]) {
      out[i] = put([a, m2]);
      return;
    }
    const j = plainCorner(i, a);
    if (j >= 0) {
      claimed.add(j);
      const a2: Point = horizontal ? [a[0], m2[1]] : [m2[0], a[1]];
      out[i] = put([a2, m2]);
      const v = wires[j]!;
      out[j] = same(v.from, a) ? { ...v, from: a2 } : { ...v, to: a2 };
      return;
    }
    // Z bent at the midpoint: both ends keep the wire's direction.
    const mid = Math.round((a[1 - along]! + m2[1 - along]!) / 2);
    const b1: Point = horizontal ? [mid, a[1]] : [a[0], mid];
    const b2: Point = horizontal ? [mid, m2[1]] : [m2[0], mid];
    out[i] = put([a, b1]);
    extra.push([b1, b2], [b2, m2]);
  });

  // Rule 3: connections that weren't wire ends get a new wire from the old point to the new.
  for (const p of moving.values()) {
    const p2 = t.point(p);
    if (same(p, p2)) continue;
    const pinSide = fixedPins.get(pointKey(p));
    const onWire = pinSide === undefined ? interiorAt(wires, fixedLines, p) : -1;
    if (pinSide === undefined && onWire < 0) continue;
    if (pinSide !== undefined) {
      // Leave the pin head-on: straight along its axis, otherwise one cell out first, so the
      // new wire doesn't run along the part's row of pin tips (it would connect to each).
      const [dx, dy] = OUTWARD[pinSide];
      if (dx !== 0 ? p[1] === p2[1] : p[0] === p2[0]) {
        extra.push([p, p2]);
        continue;
      }
      const out: Point = [p[0] + dx, p[1] + dy];
      const corner: Point = dx !== 0 ? [out[0], p2[1]] : [p2[0], out[1]];
      extra.push([p, out], [out, corner], [corner, p2]);
      continue;
    }
    // Leave a wire at a right angle.
    if (p[0] === p2[0] || p[1] === p2[1]) {
      extra.push([p, p2]);
      continue;
    }
    const wireIsHorizontal = wires[onWire]!.from[1] === wires[onWire]!.to[1];
    const corner: Point = wireIsHorizontal ? [p[0], p2[1]] : [p2[0], p[1]];
    extra.push([p, corner], [corner, p2]);
  }
  return extra;
}
