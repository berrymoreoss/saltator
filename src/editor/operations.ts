/**
 * Editing operations on the selection, as new circuits for `Editor.edit`: delete, rotate, flip
 * and nudge (wires follow, see move.ts). Pure. Spec: docs/editor.md#editing.
 */
import { type Circuit, type Point, type Rect, removeItems } from '../circuit';
import { mirror, rotation, transformItems, translation } from './move';
import type { Scene } from './scene';
import { type Selection, selectionSize } from './selection';

/** Bounding box of the selected parts (pins included) and wires, or undefined if none. */
export function selectionBounds(scene: Scene, selection: Selection): Rect | undefined {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const id of selection.parts) {
    const b = scene.partById.get(id)?.bounds;
    if (!b) continue;
    add(b.x, b.y);
    add(b.x + b.width, b.y + b.height);
  }
  for (const id of selection.wires) {
    const w = scene.wireById.get(id);
    if (!w) continue;
    add(w.from[0], w.from[1]);
    add(w.to[0], w.to[1]);
  }
  return x0 === Number.POSITIVE_INFINITY
    ? undefined
    : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The grid point nearest to the selection's center: what it rotates and flips about. */
export function selectionCenter(scene: Scene, selection: Selection): Point | undefined {
  const b = selectionBounds(scene, selection);
  return b && [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
}

export function deleteSelection(circuit: Circuit, selection: Selection): Circuit {
  return removeItems(circuit, selection);
}

/** A quarter turn of the selection about its center. */
export function rotateSelection(scene: Scene, selection: Selection, clockwise: boolean): Circuit {
  const center = selectionCenter(scene, selection);
  return center ? transformItems(scene, selection, rotation(center, clockwise)) : scene.circuit;
}

/** Mirrors the selection about its center: `horizontal` swaps left and right. */
export function flipSelection(
  scene: Scene,
  selection: Selection,
  direction: 'horizontal' | 'vertical',
): Circuit {
  const center = selectionCenter(scene, selection);
  return center ? transformItems(scene, selection, mirror(center, direction)) : scene.circuit;
}

/** Moves the selection by whole cells. */
export function moveSelection(scene: Scene, selection: Selection, dx: number, dy: number): Circuit {
  if (selectionSize(selection) === 0 || (dx === 0 && dy === 0)) return scene.circuit;
  return transformItems(scene, selection, translation(dx, dy));
}
