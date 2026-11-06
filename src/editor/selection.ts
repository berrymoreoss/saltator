/**
 * Selection: a set of part ids and a set of wire ids. Immutable; operations return the same
 * object when nothing changes, so stores can compare by identity.
 */
import type { Hit } from './hit-test';
import type { Scene } from './scene';

export interface Selection {
  readonly parts: ReadonlySet<string>;
  readonly wires: ReadonlySet<string>;
}

export const EMPTY_SELECTION: Selection = { parts: new Set(), wires: new Set() };

export function selectionOf(parts: Iterable<string>, wires: Iterable<string> = []): Selection {
  return { parts: new Set(parts), wires: new Set(wires) };
}

export function selectionSize(selection: Selection): number {
  return selection.parts.size + selection.wires.size;
}

export function isSelected(selection: Selection, hit: Hit): boolean {
  return (hit.kind === 'part' ? selection.parts : selection.wires).has(hit.id);
}

/** Just the hit item. */
export function selectHit(hit: Hit): Selection {
  return hit.kind === 'part' ? selectionOf([hit.id]) : selectionOf([], [hit.id]);
}

/** Adds the item if absent, removes it if present (Shift-click). */
export function toggleHit(selection: Selection, hit: Hit): Selection {
  const parts = new Set(selection.parts);
  const wires = new Set(selection.wires);
  const set = hit.kind === 'part' ? parts : wires;
  if (set.has(hit.id)) set.delete(hit.id);
  else set.add(hit.id);
  return { parts, wires };
}

export function unionSelection(a: Selection, b: Selection): Selection {
  if (selectionSize(b) === 0) return a;
  if (selectionSize(a) === 0) return b;
  return { parts: new Set([...a.parts, ...b.parts]), wires: new Set([...a.wires, ...b.wires]) };
}

export function selectAll(scene: Scene): Selection {
  return selectionOf(
    scene.parts.map((p) => p.id),
    scene.wires.map((w) => w.id),
  );
}

/** Drops ids that no longer exist in the scene (after the document changed). */
export function pruneSelection(selection: Selection, scene: Scene): Selection {
  const parts = [...selection.parts].filter((id) => scene.partById.has(id));
  const wires = [...selection.wires].filter((id) => scene.wireById.has(id));
  return parts.length === selection.parts.size && wires.length === selection.wires.size
    ? selection
    : selectionOf(parts, wires);
}

export function sameSelection(a: Selection, b: Selection): boolean {
  if (a === b) return true;
  if (a.parts.size !== b.parts.size || a.wires.size !== b.wires.size) return false;
  for (const id of a.parts) if (!b.parts.has(id)) return false;
  for (const id of a.wires) if (!b.wires.has(id)) return false;
  return true;
}
