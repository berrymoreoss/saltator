import { describe, expect, it } from 'vitest';
import { emptyDocument, SCHEMA_VERSION } from './document';
import { DocumentError, loadDocument, parseDocument } from './schema';

/** Problems reported for a document, or [] if it loads. */
function problemsOf(value: unknown, options?: Parameters<typeof loadDocument>[1]): string[] {
  try {
    loadDocument(value, options);
    return [];
  } catch (error) {
    if (error instanceof DocumentError) return [...error.problems];
    throw error;
  }
}

const doc = (circuit: Record<string, unknown>) => ({
  schemaVersion: 1,
  circuits: [{ id: 'main', name: 'Main', components: [], wires: [], ...circuit }],
});

describe('loadDocument', () => {
  it('loads a valid document and fills defaults', () => {
    const loaded = loadDocument(
      doc({
        components: [
          { id: 'U1', type: 'prim/nand', x: 2, y: -3 },
          {
            id: 'SW1',
            type: 'prim/constant',
            label: 'RESET',
            x: 0,
            y: 0,
            rotation: 90,
            flip: true,
            props: { value: '0', delay: 1000, on: false },
          },
        ],
        wires: [{ id: 'w1', from: [0, 0], to: [0, 5] }],
      }),
    );
    expect(loaded).toEqual({
      schemaVersion: SCHEMA_VERSION,
      circuits: [
        {
          id: 'main',
          name: 'Main',
          components: [
            { id: 'U1', type: 'prim/nand', x: 2, y: -3, rotation: 0, flip: false, props: {} },
            {
              id: 'SW1',
              type: 'prim/constant',
              label: 'RESET',
              x: 0,
              y: 0,
              rotation: 90,
              flip: true,
              props: { value: '0', delay: 1000, on: false },
            },
          ],
          wires: [{ id: 'w1', from: [0, 0], to: [0, 5] }],
        },
      ],
    });
    expect('label' in loaded.circuits[0]!.components[0]!).toBe(false);
  });

  it('copies the input instead of keeping references to it', () => {
    const from = [0, 0];
    const loaded = loadDocument(doc({ wires: [{ id: 'w1', from, to: [1, 0] }] }));
    from[0] = 99;
    expect(loaded.circuits[0]!.wires[0]!.from).toEqual([0, 0]);
  });

  it('loads bus lines; plain wires have no bus field', () => {
    const loaded = loadDocument(
      doc({
        wires: [
          { id: 'w1', from: [0, 0], to: [0, 5], bus: true },
          { id: 'w2', from: [0, 5], to: [3, 5], bus: false },
          { id: 'w3', from: [3, 5], to: [3, 7] },
        ],
      }),
    );
    expect(loaded.circuits[0]!.wires).toEqual([
      { id: 'w1', from: [0, 0], to: [0, 5], bus: true },
      { id: 'w2', from: [0, 5], to: [3, 5] },
      { id: 'w3', from: [3, 5], to: [3, 7] },
    ]);
    expect('bus' in loaded.circuits[0]!.wires[1]!).toBe(false);
    expect(problemsOf(doc({ wires: [{ id: 'w1', from: [0, 0], to: [0, 5], bus: 1 }] }))).toEqual([
      'circuits[0].wires[0].bus: expected true or false, got 1',
    ]);
  });

  it('opens a schema v1 document (before buses) unchanged', () => {
    const v1 = {
      schemaVersion: 1,
      circuits: [
        {
          id: 'main',
          name: 'Main',
          components: [],
          wires: [{ id: 'w1', from: [0, 0], to: [2, 0] }],
        },
      ],
    };
    expect(loadDocument(v1)).toEqual({ ...v1, schemaVersion: SCHEMA_VERSION });
    expect(SCHEMA_VERSION).toBe(2);
  });

  it('loads an empty document', () => {
    expect(loadDocument(emptyDocument())).toEqual(emptyDocument());
  });

  it('rejects non-objects and bad versions with one problem', () => {
    expect(problemsOf(null)).toEqual(['document: expected an object, got null']);
    expect(problemsOf([])).toEqual(['document: expected an object, got []']);
    expect(problemsOf({ circuits: [] })).toEqual([
      'schemaVersion: expected an integer ≥ 1, got nothing',
    ]);
    expect(problemsOf({ schemaVersion: 0, circuits: [] })).toEqual([
      'schemaVersion: expected an integer ≥ 1, got 0',
    ]);
  });

  it('rejects a file from a newer version with a clear message', () => {
    expect(problemsOf({ schemaVersion: SCHEMA_VERSION + 1, circuits: [] })).toEqual([
      `schemaVersion: this file was saved by a newer version of the app (schema ${SCHEMA_VERSION + 1}; this version reads up to ${SCHEMA_VERSION})`,
    ]);
  });

  it('reports structural problems of the root and circuits with paths', () => {
    expect(problemsOf({ schemaVersion: 1, circuits: [], extra: 1 })).toEqual([
      'document: unknown field "extra"',
      'circuits: expected at least one circuit',
    ]);
    expect(problemsOf({ schemaVersion: 1 })).toEqual(['circuits: missing (expected an array)']);
    expect(
      problemsOf({
        schemaVersion: 1,
        circuits: [
          { id: 'main', name: 'A', components: [], wires: [] },
          { id: 'main', name: 2, components: {}, color: 'red' },
          'x',
        ],
      }),
    ).toEqual([
      'circuits[1]: unknown field "color"',
      'circuits[1].name: expected a string, got 2',
      'circuits[1].components: expected an array, got {}',
      'circuits[1].wires: missing (expected an array)',
      'circuits[2]: expected an object, got "x"',
      'circuits[1].id: duplicate circuit id "main"',
    ]);
  });

  it('reports every component problem at once', () => {
    expect(
      problemsOf(
        doc({
          components: [
            { id: 'U.1', type: '', x: 1.5, y: 2_000_000, rotation: 45, flip: 'no', rot: 90 },
            { type: 'prim/nand', x: 0, y: 0, label: 7, props: { delay: null, ok: 1 } },
            { id: 'U3', type: 'prim/nand', x: 0, y: 0, props: [] },
            42,
          ],
        }),
      ),
    ).toEqual([
      'circuits[0].components[0]: unknown field "rot"',
      'circuits[0].components[0].id: expected an id (a letter or _, then letters, digits, _ or -), got "U.1"',
      'circuits[0].components[0].type: expected a non-empty string, got ""',
      'circuits[0].components[0].x: expected an integer within ±1000000, got 1.5',
      'circuits[0].components[0].y: expected an integer within ±1000000, got 2000000',
      'circuits[0].components[0].rotation: expected 0, 90, 180 or 270, got 45',
      'circuits[0].components[0].flip: expected true or false, got "no"',
      'circuits[0].components[1].id: missing (expected an id (a letter or _, then letters, digits, _ or -))',
      'circuits[0].components[1].props.delay: expected a number, string or boolean, got null',
      'circuits[0].components[1].label: expected a string, got 7',
      'circuits[0].components[2].props: expected an object, got []',
      'circuits[0].components[3]: expected an object, got 42',
    ]);
  });

  it('reports wire problems: shape, coordinates, diagonals, zero length', () => {
    expect(
      problemsOf(
        doc({
          wires: [
            { id: 'w1', from: [0, 0], to: [3, 3] },
            { id: 'w2', from: [1, 1], to: [1, 1] },
            { id: 'w3', from: [0], to: [0, 1.5] },
            { id: '9', from: [0, 0], to: [1, 0], via: [] },
          ],
        }),
      ),
    ).toEqual([
      'circuits[0].wires[0]: a wire must be horizontal or vertical with non-zero length',
      'circuits[0].wires[1]: a wire must be horizontal or vertical with non-zero length',
      'circuits[0].wires[2].from: expected [x, y] with integers within ±1000000, got [0]',
      'circuits[0].wires[2].to: expected [x, y] with integers within ±1000000, got [0,1.5]',
      'circuits[0].wires[3]: unknown field "via"',
      'circuits[0].wires[3].id: expected an id (a letter or _, then letters, digits, _ or -), got "9"',
    ]);
  });

  it('requires ids to be unique across components and wires of a circuit', () => {
    expect(
      problemsOf(
        doc({
          components: [
            { id: 'U1', type: 'prim/nand', x: 0, y: 0 },
            { id: 'U1', type: 'prim/nand', x: 5, y: 0 },
          ],
          wires: [{ id: 'U1', from: [0, 0], to: [1, 0] }],
        }),
      ),
    ).toEqual([
      'circuits[0].components[1].id: duplicate id "U1"',
      'circuits[0].wires[0].id: duplicate id "U1"',
    ]);
  });

  it('truncates long values in messages', () => {
    expect(problemsOf(doc({ name: 'x'.repeat(10), components: 'y'.repeat(100) }))).toEqual([
      `circuits[0].components: expected an array, got "${'y'.repeat(36)}...`,
    ]);
  });
});

describe('migrations on load', () => {
  // Pretend the current schema is 3: v1 called the circuit list "sheets", v2 had no wires.
  const migrations = {
    1: ({ sheets, ...rest }: Record<string, unknown>) => ({ ...rest, circuits: sheets }),
    2: (raw: Record<string, unknown>) => ({
      ...raw,
      circuits: (raw.circuits as Record<string, unknown>[]).map((c) => ({ ...c, wires: [] })),
    }),
  };

  it('upgrades an old document step by step before validating it', () => {
    const v1 = { schemaVersion: 1, sheets: [{ id: 'main', name: 'Main', components: [] }] };
    expect(loadDocument(v1, { version: 3, migrations })).toEqual(emptyDocument());
    const v2 = { schemaVersion: 2, circuits: [{ id: 'main', name: 'Main', components: [] }] };
    expect(loadDocument(v2, { version: 3, migrations })).toEqual(emptyDocument());
  });

  it('validates the migrated document', () => {
    const v1 = { schemaVersion: 1, sheets: [{ id: 'main', name: 'Main' }] };
    expect(problemsOf(v1, { version: 3, migrations })).toEqual([
      'circuits[0].components: missing (expected an array)',
    ]);
  });
});

describe('parseDocument', () => {
  it('parses JSON text', () => {
    expect(parseDocument(JSON.stringify(emptyDocument()))).toEqual(emptyDocument());
  });

  it('reports invalid JSON as a DocumentError', () => {
    expect(() => parseDocument('{ "schemaVersion": 1, ')).toThrow(DocumentError);
    expect(() => parseDocument('nope')).toThrow(/not valid JSON/);
  });

  it('lists all problems in the error message', () => {
    expect(() => parseDocument('{ "schemaVersion": 1, "circuits": [], "x": 0 }')).toThrow(
      'invalid circuit document:\n  document: unknown field "x"\n  circuits: expected at least one circuit',
    );
  });
});
