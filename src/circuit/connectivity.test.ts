import { describe, expect, it } from 'vitest';
import { connect, type WireSegment } from './connectivity';
import { inSegmentInterior, type Point, samePoint } from './geometry';

const w = (x1: number, y1: number, x2: number, y2: number): WireSegment => ({
  from: [x1, y1],
  to: [x2, y2],
});

/** Groups of element labels per net: pins are `p0…`, wires `w0…`. */
function nets(pins: Point[], wires: WireSegment[]): string[][] {
  const c = connect(pins, wires);
  const groups: string[][] = Array.from({ length: c.netCount }, () => []);
  for (let i = 0; i < pins.length; i++) groups[c.pinNet[i]!]!.push(`p${i}`);
  for (let i = 0; i < wires.length; i++) groups[c.wireNet[i]!]!.push(`w${i}`);
  return groups;
}

describe('connect', () => {
  it('handles an empty circuit', () => {
    expect(connect([], [])).toEqual({
      netCount: 0,
      pinNet: new Int32Array(0),
      wireNet: new Int32Array(0),
      junctions: [],
      danglingEnds: [],
      openPins: [],
    });
  });

  it('connects a wire end to a pin at the same point', () => {
    expect(
      nets(
        [
          [0, 0],
          [5, 0],
          [9, 9],
        ],
        [w(0, 0, 5, 0)],
      ),
    ).toEqual([['p0', 'p1', 'w0'], ['p2']]);
  });

  it('connects pins that sit on the same point', () => {
    expect(
      nets(
        [
          [3, 3],
          [3, 3],
          [3, 4],
        ],
        [],
      ),
    ).toEqual([['p0', 'p1'], ['p2']]);
  });

  it('connects wire ends at the same point (chains and corners)', () => {
    expect(
      nets(
        [
          [0, 0],
          [4, 4],
        ],
        [w(0, 0, 4, 0), w(4, 0, 4, 4)],
      ),
    ).toEqual([['p0', 'p1', 'w0', 'w1']]);
  });

  it('connects a wire end landing on another wire (T-junction) and draws a dot', () => {
    const wires = [w(0, 0, 10, 0), w(5, 0, 5, 5)];
    expect(nets([], wires)).toEqual([['w0', 'w1']]);
    expect(connect([], wires).junctions).toEqual([[5, 0]]);
  });

  it('connects a pin lying on the middle of a wire and draws a dot', () => {
    expect(nets([[0, 3]], [w(0, 0, 0, 6)])).toEqual([['p0', 'w0']]);
    expect(connect([[0, 3]], [w(0, 0, 0, 6)]).junctions).toEqual([[0, 3]]);
  });

  it('does not connect wires that cross', () => {
    const wires = [w(0, 5, 10, 5), w(5, 0, 5, 10)];
    expect(nets([], wires)).toEqual([['w0'], ['w1']]);
    expect(connect([], wires).junctions).toEqual([]);
  });

  it('connects collinear overlapping wires', () => {
    expect(nets([], [w(0, 0, 4, 0), w(6, 0, 2, 0)])).toEqual([['w0', 'w1']]);
    expect(nets([], [w(0, 0, 0, 4), w(0, 1, 0, 3)])).toEqual([['w0', 'w1']]);
  });

  it('does not connect parallel wires or a wire to a point just past its end', () => {
    expect(
      nets(
        [
          [5, 2],
          [11, 0],
        ],
        [w(0, 0, 10, 0), w(0, 1, 10, 1)],
      ),
    ).toEqual([['p0'], ['p1'], ['w0'], ['w1']]);
  });

  it('joins pins of the same name wherever they are, without a junction dot', () => {
    // p0, p1 named A far apart; p2 named B alone; p3 unnamed. w0 runs from p1 to (9, 0).
    const pins: Point[] = [
      [0, 0],
      [5, 0],
      [20, 20],
      [30, 30],
    ];
    const c = connect(pins, [w(5, 0, 9, 0)], ['A', 'A', 'B', undefined]);
    expect(Array.from(c.pinNet)).toEqual([0, 0, 1, 2]);
    expect(Array.from(c.wireNet)).toEqual([0]);
    expect(c.junctions).toEqual([]);
    expect(c.danglingEnds).toEqual([{ wire: 0, end: 'to', at: [9, 0] }]);
    expect(c.openPins).toEqual([0, 2, 3]); // p0 touches nothing; its partner p1 has the wire
  });

  it('numbers nets by first appearance, pins first', () => {
    const c = connect(
      [
        [9, 9],
        [0, 0],
      ],
      [w(20, 20, 21, 20), w(0, 0, 1, 0)],
    );
    expect([...c.pinNet]).toEqual([0, 1]);
    expect([...c.wireNet]).toEqual([2, 1]);
    expect(c.netCount).toBe(3);
  });

  describe('junction dots', () => {
    it('are drawn where three or more wire ends or pins meet', () => {
      expect(connect([], [w(0, 0, 2, 0), w(2, 0, 4, 0), w(2, 0, 2, 2)]).junctions).toEqual([
        [2, 0],
      ]);
      expect(connect([[2, 0]], [w(0, 0, 2, 0), w(2, 0, 2, 2)]).junctions).toEqual([[2, 0]]);
      expect(connect([], [w(0, 2, 4, 2), w(2, 0, 2, 2), w(2, 2, 2, 4)]).junctions).toEqual([
        [2, 2],
      ]);
    });

    it('are not drawn at plain corners, end-to-end joints or pin contacts', () => {
      expect(connect([], [w(0, 0, 2, 0), w(2, 0, 2, 2)]).junctions).toEqual([]);
      expect(connect([], [w(0, 0, 2, 0), w(2, 0, 4, 0)]).junctions).toEqual([]);
      expect(
        connect(
          [
            [0, 0],
            [0, 0],
          ],
          [],
        ).junctions,
      ).toEqual([]);
      expect(connect([[0, 0]], [w(0, 0, 3, 0)]).junctions).toEqual([]);
    });

    it('are sorted by x, then y', () => {
      const wires = [w(0, 5, 10, 5), w(7, 5, 7, 0), w(0, 0, 0, 9), w(0, 3, 4, 3), w(3, 5, 3, 9)];
      expect(connect([], wires).junctions).toEqual([
        [0, 3],
        [0, 5],
        [3, 5],
        [7, 5],
      ]);
    });
  });

  describe('dangling ends', () => {
    it('reports wire ends that touch nothing', () => {
      expect(connect([[0, 0]], [w(0, 0, 4, 0), w(10, 0, 10, 3)]).danglingEnds).toEqual([
        { wire: 0, end: 'to', at: [4, 0] },
        { wire: 1, end: 'from', at: [10, 0] },
        { wire: 1, end: 'to', at: [10, 3] },
      ]);
    });

    it('does not report ends at pins, other wire ends or on other wires', () => {
      const wires = [w(0, 0, 4, 0), w(4, 0, 4, 4), w(2, 0, 2, 9), w(4, 4, 0, 4)];
      expect(
        connect(
          [
            [0, 0],
            [2, 9],
            [0, 4],
          ],
          wires,
        ).danglingEnds,
      ).toEqual([]);
    });
  });

  it('matches a brute-force reference on random grids', () => {
    let seed = 12345;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      const size = 6;
      const pins: Point[] = Array.from({ length: random(6) }, () => [random(size), random(size)]);
      const wires: WireSegment[] = [];
      for (let i = random(8); i > 0; i--) {
        const a: Point = [random(size), random(size)];
        const length = 1 + random(size - 1);
        const b: Point = random(2) === 0 ? [a[0] + length, a[1]] : [a[0], a[1] + length];
        wires.push({ from: a, to: b });
      }
      expect(
        nets(pins, wires)
          .map((g) => g.sort())
          .sort(),
      ).toEqual(
        reference(pins, wires)
          .map((g) => g.sort())
          .sort(),
      );
    }
  });
});

/** O(n²) reference: elements touch if a pin or wire end lies on the other element. */
function reference(pins: Point[], wires: WireSegment[]): string[][] {
  const labels = [...pins.map((_, i) => `p${i}`), ...wires.map((_, i) => `w${i}`)];
  const onWire = (p: Point, s: WireSegment) =>
    samePoint(p, s.from) || samePoint(p, s.to) || inSegmentInterior(p, s.from, s.to);
  const touches = (a: number, b: number): boolean => {
    const pa = pins[a];
    const pb = pins[b];
    const wa = wires[a - pins.length];
    const wb = wires[b - pins.length];
    if (pa && pb) return samePoint(pa, pb);
    if (pa && wb) return onWire(pa, wb);
    if (wa && pb) return onWire(pb, wa);
    return (
      onWire(wa!.from, wb!) || onWire(wa!.to, wb!) || onWire(wb!.from, wa!) || onWire(wb!.to, wa!)
    );
  };
  const parent = labels.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : find(parent[i]!));
  for (let a = 0; a < labels.length; a++) {
    for (let b = a + 1; b < labels.length; b++) {
      if (touches(a, b)) parent[find(b)] = find(a);
    }
  }
  const groups = new Map<number, string[]>();
  labels.forEach((label, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), label]);
  });
  return [...groups.values()];
}
