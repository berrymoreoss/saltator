/**
 * Parts panel model: definitions grouped by family and filtered by a search query.
 */
import { circuitsContaining, type DocumentRegistry, subcircuitOf } from '../circuit';
import { type AnyComponentDefinition, type ComponentRegistry, familyOf } from '../core';

export interface PartGroup {
  readonly family: string;
  readonly label: string;
  readonly parts: readonly AnyComponentDefinition[];
}

/** Display names and order of part families; unknown families follow, alphabetically. */
const FAMILIES: readonly (readonly [string, string])[] = [
  ['sub', 'Subcircuits'],
  ['74xx', '74HC Logic'],
  ['timer', 'Timers'],
  ['mem', 'Memory'],
  ['cpu', 'CPUs'],
  ['periph', 'Peripherals'],
  ['prim', 'Primitives'],
  ['io', 'Input / Output'],
  ['net', 'Nets'],
  ['dev', 'Developer Fixtures'],
];

/** True if every word of the query occurs in the part's name, title, type or keywords. */
export function matchesQuery(definition: AnyComponentDefinition, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    definition.name,
    definition.title,
    definition.type,
    ...(definition.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Matching parts grouped by family, families in display order, parts in registry order. */
export function groupParts(
  definitions: readonly AnyComponentDefinition[],
  query: string,
): PartGroup[] {
  const byFamily = new Map<string, AnyComponentDefinition[]>();
  for (const definition of definitions) {
    if (!matchesQuery(definition, query)) continue;
    const family = familyOf(definition.type);
    const list = byFamily.get(family) ?? [];
    list.push(definition);
    byFamily.set(family, list);
  }
  const known = new Map(FAMILIES);
  const order = [
    ...FAMILIES.map(([family]) => family),
    ...[...byFamily.keys()].filter((f) => !known.has(f)).sort(),
  ];
  return order.flatMap((family) => {
    const parts = byFamily.get(family);
    return parts ? [{ family, label: known.get(family) ?? family, parts }] : [];
  });
}

/** Data type of a part dragged from the Parts panel onto the canvas (the value is its type). */
export const PART_DRAG_TYPE = 'application/x-logic-part';

/**
 * The parts that may be placed in circuit `open`: every part of the document's registry but the
 * circuits that contain `open` (itself included), which would make it contain itself (R11a).
 */
export function placeableParts(registry: DocumentRegistry, open: string): ComponentRegistry {
  const outer = circuitsContaining(registry.document, open);
  const hidden = (type: string) => outer.has(subcircuitOf(type) ?? '');
  return {
    get: (type) => registry.get(type),
    has: (type) => registry.has(type),
    list: () => registry.list().filter((definition) => !hidden(definition.type)),
  };
}
