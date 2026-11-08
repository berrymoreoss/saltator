import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  type CircuitDocument,
  type ComponentInstance,
  emptyCircuit,
  SCHEMA_VERSION,
} from './document';
import {
  addCircuit,
  circuitsContaining,
  circuitUses,
  duplicateCircuit,
  fragmentDocument,
  importCircuits,
  placementsOf,
  removeCircuit,
  renameCircuit,
  renamePartInDocument,
  replaceCircuit,
  setTopCircuit,
} from './document-edit';

const part = (id: string, type: string): ComponentInstance => ({
  id,
  type,
  x: 0,
  y: 0,
  rotation: 0,
  flip: false,
  props: {},
});
const circuit = (id: string, components: ComponentInstance[] = [], extra = {}): Circuit => ({
  ...emptyCircuit(id, id.toUpperCase()),
  components,
  ...extra,
});
const doc = (...circuits: Circuit[]): CircuitDocument => ({
  schemaVersion: SCHEMA_VERSION,
  circuits,
});
const ids = (d: CircuitDocument) => d.circuits.map((c) => c.id);

// main places a cell twice and a pair; the pair places a cell twice.
const cell = circuit('cell', [part('U1', 'test/and')]);
const pair = circuit('pair', [part('B1', 'sub/cell'), part('B2', 'sub/cell')]);
const main = circuit('main', [
  part('A1', 'sub/cell'),
  part('A2', 'sub/pair'),
  part('U1', 'test/and'),
]);
const design = doc(main, pair, cell);

describe('circuit operations', () => {
  it('adds an empty circuit with an id from its name', () => {
    const { document, id } = addCircuit(design, 'Decade Counter');
    expect(id).toBe('decade-counter');
    expect(document.circuits.at(-1)).toEqual(emptyCircuit('decade-counter', 'Decade Counter'));
    expect(addCircuit(design, 'Cell').id).toBe('cell-2');
  });

  it('renames a placed circuit by name only, keeping its id', () => {
    const renamed = renameCircuit(design, 'cell', 'Register');
    expect(renamed.circuits[2]).toEqual({ ...cell, name: 'Register' });
    expect(renamed.circuits[0]).toBe(main);
    expect(renameCircuit(design, 'cell', 'CELL')).toBe(design);
    expect(() => renameCircuit(design, 'nope', 'X')).toThrow('no circuit "nope"');
  });

  it('gives a circuit nothing places an id from its new name', () => {
    const { document } = addCircuit(design, 'Circuit 4');
    const renamed = renameCircuit(document, 'circuit-4', 'Inverter');
    expect(ids(renamed)).toEqual(['main', 'pair', 'cell', 'inverter']);
    expect(renamed.circuits[3]!.name).toBe('Inverter');
    // The top is placed nowhere either: it follows its name, avoiding the ids taken.
    expect(ids(renameCircuit(design, 'main', 'Pair'))).toEqual(['pair-2', 'pair', 'cell']);
  });

  it('duplicates a circuit right after it, under a new id', () => {
    const { document, id } = duplicateCircuit(design, 'pair');
    expect(id).toBe('pair-copy');
    expect(ids(document)).toEqual(['main', 'pair', 'pair-copy', 'cell']);
    expect(document.circuits[2]).toEqual({ ...pair, id: 'pair-copy', name: 'PAIR copy' });
    const tested = doc(circuit('cell', [], { testScript: ["bench('and', (b) => {});"] }));
    expect(duplicateCircuit(tested, 'cell').document.circuits[1]!.testScript).toEqual([
      "bench('and', (b) => {});",
    ]);
  });

  it('removes a circuit with its instances, never the last one', () => {
    const removed = removeCircuit(design, 'cell');
    expect(ids(removed)).toEqual(['main', 'pair']);
    expect(removed.circuits[0]!.components.map((c) => c.id)).toEqual(['A2', 'U1']);
    expect(removed.circuits[1]!.components).toEqual([]);
    expect(ids(removeCircuit(design, 'main'))).toEqual(['pair', 'cell']);
    expect(() => removeCircuit(doc(cell), 'cell')).toThrow('a document keeps at least one circuit');
  });

  it('makes a circuit the top by moving it to the front', () => {
    expect(ids(setTopCircuit(design, 'cell'))).toEqual(['cell', 'main', 'pair']);
    expect(setTopCircuit(design, 'main')).toBe(design);
  });

  it('says where a circuit is placed', () => {
    expect(circuitUses(design, 'cell')).toEqual([
      { circuit: 'main', components: ['A1'] },
      { circuit: 'pair', components: ['B1', 'B2'] },
    ]);
    expect(circuitUses(design, 'main')).toEqual([]);
  });

  it('knows which circuits contain a circuit, so placing them would recurse', () => {
    expect([...circuitsContaining(design, 'cell')].sort()).toEqual(['cell', 'main', 'pair']);
    expect([...circuitsContaining(design, 'pair')].sort()).toEqual(['main', 'pair']);
    expect([...circuitsContaining(design, 'main')]).toEqual(['main']);
  });

  it('lists the instance paths of a circuit below another', () => {
    expect(placementsOf(design, 'main', 'cell')).toEqual(['A1', 'A2/B1', 'A2/B2']);
    expect(placementsOf(design, 'pair', 'cell')).toEqual(['B1', 'B2']);
    expect(placementsOf(design, 'main', 'main')).toEqual(['']);
    expect(placementsOf(design, 'cell', 'main')).toEqual([]);
    // A loop doesn't loop forever.
    const loop = doc(circuit('a', [part('X1', 'sub/b')]), circuit('b', [part('Y1', 'sub/a')]));
    expect(placementsOf(loop, 'a', 'b')).toEqual(['X1']);
  });

  it('replaces a circuit, keeping the document when nothing changed', () => {
    expect(replaceCircuit(design, cell)).toBe(design);
    const other = { ...cell, name: 'Other' };
    expect(replaceCircuit(design, other).circuits[2]).toBe(other);
  });
});

describe('renamePartInDocument', () => {
  const probes = [
    { ref: 'A1/U1.Y' },
    { ref: 'A2/B2/U1.Y' },
    { ref: 'U1.Y' },
    { name: 'G', members: ['A2/B1/U1.Y', 'A1.X'] },
  ];
  const probed = doc({ ...main, probes }, pair, cell);

  it('renames a part inside a subcircuit in every instance path that reaches it', () => {
    const renamed = renamePartInDocument(probed, 'cell', 'U1', 'U7');
    expect(renamed.circuits[2]!.components[0]!.id).toBe('U7');
    expect(renamed.circuits[0]!.probes).toEqual([
      { ref: 'A1/U7.Y' },
      { ref: 'A2/B2/U7.Y' },
      { ref: 'U1.Y' }, // the top's own U1
      { name: 'G', members: ['A2/B1/U7.Y', 'A1.X'] },
    ]);
    expect(renamed.circuits[1]).toBe(pair);
  });

  it('renames an instance and the paths through it', () => {
    const renamed = renamePartInDocument(probed, 'main', 'A2', 'ALU');
    expect(renamed.circuits[0]!.probes.map((p) => ('ref' in p ? p.ref : p.members))).toEqual([
      'A1/U1.Y',
      'ALU/B2/U1.Y',
      'U1.Y',
      ['ALU/B1/U1.Y', 'A1.X'],
    ]);
  });

  it('rewrites references in other circuits that place the renamed one', () => {
    const withPairProbes = doc(main, { ...pair, probes: [{ ref: 'B1/U1.Y' }] }, cell);
    const renamed = renamePartInDocument(withPairProbes, 'cell', 'U1', 'U2');
    expect(renamed.circuits[1]!.probes).toEqual([{ ref: 'B1/U2.Y' }]);
    expect(renamePartInDocument(withPairProbes, 'cell', 'U1', 'U1')).toBe(withPairProbes);
  });
});

describe('copying instances between documents', () => {
  const fragment = circuit('main', [part('A2', 'sub/pair')]);

  it('carries the circuits a fragment needs, transitively, in document order', () => {
    const clip = fragmentDocument(design, fragment);
    expect(ids(clip)).toEqual(['clipboard', 'pair', 'cell']);
    expect(clip.circuits[0]!.components).toEqual(fragment.components);
    expect(ids(fragmentDocument(design, circuit('main', [part('U1', 'test/and')])))).toEqual([
      'clipboard',
    ]);
    // The circuits carried keep their test scripts.
    const script = ["bench('and', (b) => {});"];
    const tested = doc(main, pair, { ...cell, testScript: script });
    expect(fragmentDocument(tested, fragment).circuits.map((c) => c.testScript)).toEqual([
      [],
      [],
      script,
    ]);
    // A carried circuit called `clipboard` keeps its id; the fragment takes another.
    const odd = doc(circuit('main', [part('A1', 'sub/clipboard')]), circuit('clipboard'));
    expect(ids(fragmentDocument(odd, odd.circuits[0]!))).toEqual(['clipboard-2', 'clipboard']);
  });

  it('pastes into a document without them by adding them', () => {
    const clip = fragmentDocument(design, fragment);
    const { document, fragment: pasted } = importCircuits(doc(circuit('main')), clip);
    expect(ids(document)).toEqual(['main', 'cell', 'pair']);
    expect(pasted.components).toEqual(fragment.components);
  });

  it('reuses identical circuits and renames differing ones, retargeting their instances', () => {
    const clip = fragmentDocument(design, fragment);
    // The same pair and cell: nothing is added.
    const same = importCircuits(design, clip);
    expect(same.document).toEqual(design);
    expect(same.fragment.components[0]!.type).toBe('sub/pair');
    // Another cell under the same id: the clipboard's comes in as cell-2, and so does a pair
    // that places it (it differs from the document's pair now).
    const otherCell = circuit('cell', [part('U9', 'test/and')]);
    const target = doc(main, pair, otherCell);
    const { document, fragment: pasted } = importCircuits(target, clip);
    expect(ids(document)).toEqual(['main', 'pair', 'cell', 'cell-2', 'pair-2']);
    expect(document.circuits[3]).toEqual({ ...cell, id: 'cell-2' });
    expect(document.circuits[4]!.components.map((c) => c.type)).toEqual([
      'sub/cell-2',
      'sub/cell-2',
    ]);
    expect(pasted.components[0]!.type).toBe('sub/pair-2');
  });
});
