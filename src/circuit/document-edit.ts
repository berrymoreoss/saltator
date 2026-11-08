/**
 * Document operations over circuits (R11a): pure `CircuitDocument → CircuitDocument` functions
 * for the Circuits list — add, rename, duplicate, remove, set as top — part renames that rewrite
 * references in every circuit, and the circuits a copied fragment needs. Unchanged circuits are
 * kept as they are, so undo snapshots share them. Spec: docs/circuit.md#editing.
 */
import {
  type Circuit,
  type CircuitDocument,
  type ComponentInstance,
  circuitIdFor,
  emptyCircuit,
  isGroupProbe,
} from './document';
import { renameComponent, renameReference, sameCircuit } from './edit';
import { subcircuitOf, subcircuitType } from './subcircuit';

/** The document with `circuit` in place of the circuit of its id. */
export function replaceCircuit(document: CircuitDocument, circuit: Circuit): CircuitDocument {
  const index = document.circuits.findIndex((c) => c.id === circuit.id);
  if (index < 0) throw new Error(`no circuit "${circuit.id}"`);
  if (document.circuits[index] === circuit) return document;
  const circuits = [...document.circuits];
  circuits[index] = circuit;
  return { ...document, circuits };
}

/** A circuit by id, or a thrown error naming it. */
function circuitOf(document: CircuitDocument, id: string): Circuit {
  const circuit = document.circuits.find((c) => c.id === id);
  if (!circuit) throw new Error(`no circuit "${id}"`);
  return circuit;
}

/** Adds an empty circuit called `name` after the others, with an id made from the name. */
export function addCircuit(
  document: CircuitDocument,
  name: string,
): { readonly document: CircuitDocument; readonly id: string } {
  const id = circuitIdFor(
    name,
    document.circuits.map((c) => c.id),
  );
  return {
    document: { ...document, circuits: [...document.circuits, emptyCircuit(id, name)] },
    id,
  };
}

/**
 * Renames a circuit. While nothing places it, its id follows the name (`Circuit 2` renamed
 * `Inverter` becomes `inverter`: nothing refers to it yet); once placed, the id stays, so its
 * instances keep their type. The circuit keeps its place in the order.
 */
export function renameCircuit(
  document: CircuitDocument,
  id: string,
  name: string,
): CircuitDocument {
  const circuit = circuitOf(document, id);
  if (circuit.name === name) return document;
  const placed = circuitUses(document, id).length > 0;
  const others = document.circuits.filter((c) => c !== circuit).map((c) => c.id);
  const newId = placed ? id : circuitIdFor(name, others);
  const circuits = document.circuits.map((c) => (c === circuit ? { ...c, id: newId, name } : c));
  return { ...document, circuits };
}

/** A copy of a circuit right after it, called `name` (default: "<name> copy"), with a new id. */
export function duplicateCircuit(
  document: CircuitDocument,
  id: string,
  name = `${circuitOf(document, id).name} copy`,
): { readonly document: CircuitDocument; readonly id: string } {
  const source = circuitOf(document, id);
  const copy = {
    ...source,
    id: circuitIdFor(
      name,
      document.circuits.map((c) => c.id),
    ),
    name,
  };
  const circuits = [...document.circuits];
  circuits.splice(circuits.indexOf(source) + 1, 0, copy);
  return { document: { ...document, circuits }, id: copy.id };
}

/** Where a circuit is placed: each circuit placing it with the designators of its instances. */
export function circuitUses(
  document: CircuitDocument,
  id: string,
): readonly { readonly circuit: string; readonly components: readonly string[] }[] {
  const type = subcircuitType(id);
  return document.circuits.flatMap((c) => {
    const components = c.components.filter((x) => x.type === type).map((x) => x.id);
    return components.length > 0 ? [{ circuit: c.id, components }] : [];
  });
}

/**
 * Removes a circuit and every instance of it (wires attached to them stay, dangling, as when a
 * part is deleted). The last circuit can't be removed; removing the top makes the next one the
 * top.
 */
export function removeCircuit(document: CircuitDocument, id: string): CircuitDocument {
  circuitOf(document, id);
  if (document.circuits.length === 1) throw new Error('a document keeps at least one circuit');
  const type = subcircuitType(id);
  const circuits = document.circuits.flatMap((c) => {
    if (c.id === id) return [];
    if (!c.components.some((x) => x.type === type)) return [c];
    return [{ ...c, components: c.components.filter((x) => x.type !== type) }];
  });
  return { ...document, circuits };
}

/** Makes a circuit the top (moves it to the front); the others keep their order. */
export function setTopCircuit(document: CircuitDocument, id: string): CircuitDocument {
  const circuit = circuitOf(document, id);
  if (document.circuits[0] === circuit) return document;
  return { ...document, circuits: [circuit, ...document.circuits.filter((c) => c !== circuit)] };
}

/** The ids of the circuits a circuit places, directly. */
function placed(circuit: Circuit): Set<string> {
  const ids = new Set<string>();
  for (const c of circuit.components) {
    const id = subcircuitOf(c.type);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/**
 * The circuits that contain circuit `id`, directly or through others, `id` included: placing any
 * of them in `id` would make it contain itself.
 */
export function circuitsContaining(document: CircuitDocument, id: string): ReadonlySet<string> {
  const found = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const circuit of document.circuits) {
      if (found.has(circuit.id)) continue;
      if ([...placed(circuit)].some((inner) => found.has(inner))) {
        found.add(circuit.id);
        grew = true;
      }
    }
  }
  return found;
}

/**
 * The circuits circuit `id` places, directly or through others, `id` included: what its
 * simulation as the top is made of (a bench's results change with any of them).
 */
export function circuitsInside(document: CircuitDocument, id: string): ReadonlySet<string> {
  const byId = new Map(document.circuits.map((c) => [c.id, c]));
  const found = new Set<string>();
  const visit = (circuit: string) => {
    const c = byId.get(circuit);
    if (!c || found.has(circuit)) return;
    found.add(circuit);
    for (const inner of placed(c)) visit(inner);
  };
  visit(id);
  return found;
}

/**
 * The instance paths at which circuit `target` sits in the hierarchy below circuit `root`
 * (`''` when they are the same): where a reference written in `root` reaches into `target`.
 */
export function placementsOf(
  document: CircuitDocument,
  root: string,
  target: string,
): readonly string[] {
  const byId = new Map(document.circuits.map((c) => [c.id, c]));
  const paths: string[] = [];
  const walk = (id: string, path: string, open: ReadonlySet<string>) => {
    if (id === target) paths.push(path);
    const circuit = byId.get(id);
    if (!circuit) return;
    for (const c of circuit.components) {
      const inner = subcircuitOf(c.type);
      if (inner === undefined || open.has(inner) || !byId.has(inner)) continue;
      walk(inner, path === '' ? c.id : `${path}/${c.id}`, new Set([...open, inner]));
    }
  };
  walk(root, '', new Set([root]));
  return paths;
}

/**
 * Renames part `from` of circuit `circuitId` to `to` (an editor command: its id is its
 * designator) and rewrites the probe references that reach it in every circuit: its own pins
 * (`U5.A0`), and through each instance path that leads into `circuitId` (`A1/U5.A0`); renaming an
 * instance rewrites the paths through it (`A1/…` → `A3/…`). Throws a designator error as
 * `renameComponent` does.
 */
export function renamePartInDocument(
  document: CircuitDocument,
  circuitId: string,
  from: string,
  to: string,
): CircuitDocument {
  const renamed = renameComponent(circuitOf(document, circuitId), from, to);
  if (renamed === circuitOf(document, circuitId)) return document;
  let next = replaceCircuit(document, renamed);
  for (const circuit of next.circuits) {
    if (circuit.id === circuitId || circuit.probes.length === 0) continue;
    const scopes = placementsOf(next, circuit.id, circuitId);
    if (scopes.length === 0) continue;
    const rename = (ref: string) => renameReference(ref, from, to, scopes);
    let changed = false;
    const probes = circuit.probes.map((probe) => {
      const next = isGroupProbe(probe)
        ? { ...probe, members: probe.members.map(rename) }
        : { ...probe, ref: rename(probe.ref) };
      const same = isGroupProbe(probe)
        ? (next as typeof probe).members.every((m, i) => m === probe.members[i])
        : (next as typeof probe).ref === probe.ref;
      if (same) return probe;
      changed = true;
      return next;
    });
    if (changed) next = replaceCircuit(next, { ...circuit, probes });
  }
  return next;
}

/**
 * The clipboard document for a fragment of a circuit of `document`: the fragment first, then
 * every circuit its instances need, directly or through others, in document order.
 */
export function fragmentDocument(document: CircuitDocument, fragment: Circuit): CircuitDocument {
  const byId = new Map(document.circuits.map((c) => [c.id, c]));
  const needed = new Set<string>();
  const visit = (circuit: Circuit) => {
    for (const id of placed(circuit)) {
      const inner = byId.get(id);
      if (!inner || needed.has(id)) continue;
      needed.add(id);
      visit(inner);
    }
  };
  visit(fragment);
  const circuits = document.circuits.filter((c) => needed.has(c.id));
  const fragmentId = circuitIdFor('clipboard', needed);
  return { ...document, circuits: [{ ...fragment, id: fragmentId }, ...circuits] };
}

/**
 * Brings the circuits a clipboard document carries (all but its first) into `document`, for
 * pasting its first circuit: a circuit of the same id and content is reused, one whose id is
 * free is added, one whose id holds something else is added under a new id — and every
 * instance of it, in the fragment and the circuits brought along, is retargeted. Inner circuits
 * are brought first, so a circuit is compared after its own instances were retargeted.
 */
export function importCircuits(
  document: CircuitDocument,
  clipboard: CircuitDocument,
): { readonly document: CircuitDocument; readonly fragment: Circuit } {
  const [fragment, ...carried] = clipboard.circuits as [Circuit, ...Circuit[]];
  const byId = new Map(carried.map((c) => [c.id, c]));
  // Leaves first: a circuit after the circuits it places.
  const order: Circuit[] = [];
  const seen = new Set<string>();
  const visit = (circuit: Circuit) => {
    if (seen.has(circuit.id)) return;
    seen.add(circuit.id);
    for (const id of placed(circuit)) {
      const inner = byId.get(id);
      if (inner) visit(inner);
    }
    order.push(circuit);
  };
  for (const circuit of carried) visit(circuit);

  const retarget = new Map<string, string>(); // clipboard type → document type
  const remap = (circuit: Circuit): Circuit => {
    if (!circuit.components.some((c) => retarget.has(c.type))) return circuit;
    const components = circuit.components.map(
      (c): ComponentInstance => (retarget.has(c.type) ? { ...c, type: retarget.get(c.type)! } : c),
    );
    return { ...circuit, components };
  };
  let circuits = [...document.circuits];
  for (const original of order) {
    const circuit = remap(original);
    const existing = circuits.find((c) => c.id === circuit.id);
    if (existing && sameCircuit(existing, circuit)) continue;
    if (!existing) {
      circuits.push(circuit);
      continue;
    }
    const id = circuitIdFor(circuit.name, [...circuits.map((c) => c.id), ...byId.keys()]);
    retarget.set(subcircuitType(original.id), subcircuitType(id));
    circuits = [...circuits, { ...circuit, id }];
  }
  return { document: { ...document, circuits }, fragment: remap(fragment) };
}
