/**
 * Geometric connectivity: which pins and wires form one net. Everything that touches connects
 * (Logisim-like), except two wire interiors that merely cross. Spec: docs/circuit.md#connectivity.
 *
 * - A wire end connects to pins, wire ends and wire interiors at its point (T-junction).
 * - A pin connects to wire ends and wire interiors at its point, and to other pins there.
 * - Crossing interiors don't connect; collinear overlapping wires do (an end lies on the other).
 * - Pins given the same name connect wherever they are (net labels, VCC and GND symbols).
 *
 * Union-find over the points where something ends (wire ends, pins). Points inside wires are found
 * through rows/columns of those points sorted by coordinate: O((P + W) log P), so recompiling large
 * schematics on every edit stays cheap.
 */
import { comparePoints, type Point, pointKey } from './geometry';

export interface WireSegment {
  readonly from: Point;
  readonly to: Point;
}

export interface WireEnd {
  /** Index of the wire in the input. */
  readonly wire: number;
  readonly end: 'from' | 'to';
  readonly at: Point;
}

export interface Connectivity {
  /** Number of nets. Nets are numbered in order of first appearance: pins first, then wires. */
  readonly netCount: number;
  /** Net of each input pin. */
  readonly pinNet: Int32Array;
  /** Net of each input wire. */
  readonly wireNet: Int32Array;
  /** Points where three or more things meet (a wire through a point counts twice), sorted. */
  readonly junctions: readonly Point[];
  /** Wire ends that touch nothing else, in wire order. */
  readonly danglingEnds: readonly WireEnd[];
}

/**
 * Computes the nets formed by pins (given by their grid points) and axis-aligned wires. `names`
 * (by pin index, `undefined` for most pins) joins every pin of one name into one net; that adds
 * no junction dots, since it isn't a geometric connection.
 */
export function connect(
  pins: readonly Point[],
  wires: readonly WireSegment[],
  names: readonly (string | undefined)[] = [],
): Connectivity {
  // Nodes: every distinct point where a wire ends or a pin sits.
  const nodeOf = new Map<number, number>();
  const points: Point[] = [];
  const node = (p: Point): number => {
    const key = pointKey(p);
    let n = nodeOf.get(key);
    if (n === undefined) {
      n = points.length;
      nodeOf.set(key, n);
      points.push(p);
    }
    return n;
  };
  const pinNode = pins.map(node);
  const wireFrom = wires.map((w) => node(w.from));
  const wireTo = wires.map((w) => node(w.to));

  const count = points.length;
  const parent = new Int32Array(count);
  for (let n = 0; n < count; n++) parent[n] = n;
  const find = (n: number): number => {
    let x = n;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!; // path halving
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Degree of each node, for junction dots and dangling ends.
  const degree = new Int32Array(count);
  for (const n of pinNode) degree[n]!++;
  for (let w = 0; w < wires.length; w++) {
    degree[wireFrom[w]!]!++;
    degree[wireTo[w]!]!++;
    union(wireFrom[w]!, wireTo[w]!);
  }

  const named = new Map<string, number>();
  names.forEach((name, pin) => {
    if (name === undefined) return;
    const first = named.get(name);
    if (first === undefined) named.set(name, pinNode[pin]!);
    else union(first, pinNode[pin]!);
  });

  // Nodes strictly inside a wire join it (T-junctions, pins on a wire, overlapping wires).
  const rows = groupNodes(points, 1, 0); // nodes by y, sorted by x — for horizontal wires
  const columns = groupNodes(points, 0, 1); // nodes by x, sorted by y — for vertical wires
  wires.forEach((wire, w) => {
    const horizontal = wire.from[1] === wire.to[1];
    const [along, across] = horizontal ? [0, 1] : [1, 0];
    const line = (horizontal ? rows : columns).get(wire.from[across]!);
    if (!line) return;
    const lo = Math.min(wire.from[along]!, wire.to[along]!);
    const hi = Math.max(wire.from[along]!, wire.to[along]!);
    for (let i = firstAfter(line, points, along, lo); i < line.length; i++) {
      const n = line[i]!;
      if (points[n]![along]! >= hi) break;
      union(wireFrom[w]!, n);
      degree[n]! += 2;
    }
  });

  // Number nets in order of first appearance.
  const netOfRoot = new Int32Array(count).fill(-1);
  let netCount = 0;
  const netOf = (n: number): number => {
    const root = find(n);
    if (netOfRoot[root] === -1) netOfRoot[root] = netCount++;
    return netOfRoot[root]!;
  };
  const pinNet = Int32Array.from(pinNode, netOf);
  const wireNet = Int32Array.from(wireFrom, netOf);

  const junctions = points.filter((_, n) => degree[n]! >= 3).sort(comparePoints);
  const danglingEnds: WireEnd[] = [];
  wires.forEach((wire, w) => {
    if (degree[wireFrom[w]!] === 1) danglingEnds.push({ wire: w, end: 'from', at: wire.from });
    if (degree[wireTo[w]!] === 1) danglingEnds.push({ wire: w, end: 'to', at: wire.to });
  });

  return { netCount, pinNet, wireNet, junctions, danglingEnds };
}

/** Node indices grouped by `points[n][by]`, each group sorted by `points[n][along]`. */
function groupNodes(points: readonly Point[], by: 0 | 1, along: 0 | 1): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  points.forEach((p, n) => {
    const group = groups.get(p[by]);
    if (group) group.push(n);
    else groups.set(p[by], [n]);
  });
  for (const group of groups.values()) {
    if (group.length > 1) group.sort((a, b) => points[a]![along] - points[b]![along]);
  }
  return groups;
}

/** Index of the first node in a sorted line whose coordinate is greater than `value`. */
function firstAfter(
  line: readonly number[],
  points: readonly Point[],
  along: number,
  value: number,
) {
  let lo = 0;
  let hi = line.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[line[mid]!]![along]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
