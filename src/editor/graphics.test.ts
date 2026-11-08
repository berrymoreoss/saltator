import { describe, expect, it } from 'vitest';
import { type Placement, ROTATIONS, transformPoint } from '../circuit';
import { CanvasGraphics, placementMatrix, uprightText } from './graphics';
import { DARK_CANVAS } from './theme';

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

describe('CanvasGraphics.textBlock', () => {
  /** Draws a block of lines in a 6 × 3 box at (1, 1) of a part placed at (10, 20); 10 px/cell. */
  function drawn(placement: Omit<Placement, 'origin'>) {
    const lines: { text: string; x: number; y: number; angle: number }[] = [];
    let at = { x: 0, y: 0, angle: 0 };
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      save: () => {},
      restore: () => {},
      setTransform: (_a: number, _b: number, _c: number, _d: number, e: number, f: number) => {
        at = { x: e, y: f, angle: 0 };
      },
      transform: () => {},
      rotate: (angle: number) => {
        at = { ...at, angle };
      },
      fillText: (text: string) => lines.push({ text, ...at }),
    } as unknown as CanvasRenderingContext2D;
    const g = new CanvasGraphics(ctx, { x: 0, y: 0, scale: 10 }, 1, DARK_CANVAS);
    g.place({ origin: [10, 20], ...placement });
    g.textBlock(
      ['one', '', 'three'],
      { x: 1, y: 1, width: 6, height: 3 },
      {
        size: 0.7,
        lineHeight: 1,
        padding: 0.2,
      },
    );
    return { lines, font: ctx.font };
  }

  it('draws the lines from the top-left of the box down, skipping empty ones', () => {
    const { lines, font } = drawn({ rotation: 0, flip: false });
    expect(lines).toEqual([
      { text: 'one', x: 112, y: 215, angle: 0 },
      { text: 'three', x: 112, y: 235, angle: 0 },
    ]);
    expect(font).toMatch(/^7px /);
  });

  it('keeps the lines upright and in order when turned or flipped', () => {
    // Turned by 180° the box spans (3, 16)–(9, 19) in the world: the block reads as before.
    expect(drawn({ rotation: 180, flip: false }).lines).toEqual([
      { text: 'one', x: 32, y: 165, angle: 0 },
      { text: 'three', x: 32, y: 185, angle: 0 },
    ]);
    expect(drawn({ rotation: 0, flip: true }).lines.map((l) => [l.text, l.y])).toEqual([
      ['one', 215],
      ['three', 235],
    ]);
  });

  it('reads bottom to top, the first line at the left, on its side', () => {
    // Turned by 90° the box spans (6, 21)–(9, 27), flipped too (6, 13)–(9, 19): the lines go
    // from x = 6 rightwards, each from the box's bottom up.
    for (const [flip, bottom] of [
      [false, 27],
      [true, 19],
    ] as const) {
      expect(drawn({ rotation: 90, flip }).lines).toEqual([
        { text: 'one', x: 65, y: (bottom - 0.2) * 10, angle: -Math.PI / 2 },
        { text: 'three', x: 85, y: (bottom - 0.2) * 10, angle: -Math.PI / 2 },
      ]);
    }
  });

  it('skips text too small to read', () => {
    const lines: string[] = [];
    const ctx = { fillText: (t: string) => lines.push(t) } as unknown as CanvasRenderingContext2D;
    const g = new CanvasGraphics(ctx, { x: 0, y: 0, scale: 4 }, 1, DARK_CANVAS);
    g.textBlock(
      ['tiny'],
      { x: 0, y: 0, width: 2, height: 1 },
      {
        size: 0.5,
        lineHeight: 1,
        padding: 0,
      },
    );
    expect(lines).toEqual([]);
  });
});
