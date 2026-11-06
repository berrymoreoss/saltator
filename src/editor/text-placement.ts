/**
 * Where a part's designator and label go. Text outside a part is always drawn horizontally, so it
 * reads the same at any rotation; it goes on a side of the part's bounding box (pin stubs
 * included) that has no pins, so it never sits where wires arrive. Spec: docs/editor.md#text.
 */
import type { Point, Rect, Side } from '../circuit';

export type TextAlign = 'left' | 'center' | 'right';
export type TextBaseline = 'top' | 'middle' | 'bottom';
export type TextRole = 'designator' | 'label' | 'name';

/** A line of text in world coordinates. */
export interface SceneText {
  readonly text: string;
  readonly role: TextRole;
  /** Anchor point; `align` and `baseline` say which point of the text it is. */
  readonly at: Point;
  readonly align: TextAlign;
  readonly baseline: TextBaseline;
  /** Font size in grid cells. */
  readonly size: number;
}

/** Font size of designators and labels, in cells (12 px at 100 %). */
export const TEXT_SIZE = 0.75;
/** Distance between the bounding box and the text, in cells. */
export const TEXT_GAP = 0.25;
const LINE_HEIGHT = TEXT_SIZE * 1.25;

/** Preferred sides for a part's text block, best first. */
const PREFERENCE: readonly Side[] = ['top', 'bottom', 'right', 'left'];

const OPPOSITE: Readonly<Record<Side, Side>> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
};

export interface TextLine {
  readonly text: string;
  readonly role: TextRole;
}

/**
 * The side a part's text block goes on: the first of top, bottom, right, left without pins
 * (top if every side has pins). `oppositeOf` puts it opposite that side instead (power symbols:
 * the rail name at the end away from the pin).
 */
export function textSide(pinSides: Iterable<Side>, oppositeOf?: Side): Side {
  if (oppositeOf !== undefined) return OPPOSITE[oppositeOf];
  const used = new Set(pinSides);
  return PREFERENCE.find((side) => !used.has(side)) ?? 'top';
}

/** Lays out lines of text as a block next to `bounds` on `side`, first line nearest the top. */
export function placeTextBlock(lines: readonly TextLine[], bounds: Rect, side: Side): SceneText[] {
  return lines.map(({ text, role }, i) => ({
    text,
    role,
    size: TEXT_SIZE,
    ...lineAnchor(bounds, side, i, lines.length),
  }));
}

type Anchor = Pick<SceneText, 'at' | 'align' | 'baseline'>;

/** Anchor of line `i` of `n` in a text block on `side` of `bounds`. */
function lineAnchor(bounds: Rect, side: Side, i: number, n: number): Anchor {
  const cx = bounds.x + bounds.width / 2;
  const top = bounds.y + bounds.height / 2 - (n * LINE_HEIGHT) / 2 + i * LINE_HEIGHT;
  switch (side) {
    case 'top':
      return {
        at: [cx, bounds.y - TEXT_GAP - (n - 1 - i) * LINE_HEIGHT],
        align: 'center',
        baseline: 'bottom',
      };
    case 'bottom':
      return {
        at: [cx, bounds.y + bounds.height + TEXT_GAP + i * LINE_HEIGHT],
        align: 'center',
        baseline: 'top',
      };
    case 'right':
      return { at: [bounds.x + bounds.width + TEXT_GAP, top], align: 'left', baseline: 'top' };
    case 'left':
      return { at: [bounds.x - TEXT_GAP, top], align: 'right', baseline: 'top' };
  }
}
