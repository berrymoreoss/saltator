import { describe, expect, it } from 'vitest';
import { emptyDocument, SCHEMA_VERSION } from './document';
import { DocumentError, loadDocument, parseDocument } from './schema';
import { testModule, testSpecifyModule } from './test-parts';

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
          probes: [],
          testScript: [],
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
    expect(loadDocument(v1)).toEqual({
      schemaVersion: SCHEMA_VERSION,
      circuits: [{ ...v1.circuits[0], probes: [], testScript: [] }],
    });
    expect(SCHEMA_VERSION).toBe(10);
  });

  it('opens a schema v2 document (before probes) with none', () => {
    const v2 = {
      schemaVersion: 2,
      circuits: [{ id: 'main', name: 'Main', components: [], wires: [] }],
    };
    expect(loadDocument(v2).circuits[0]!.probes).toEqual([]);
  });

  it('opens a schema v3 document with its circuit ids turned into slugs', () => {
    const v3 = {
      schemaVersion: 3,
      circuits: [
        { id: 'main', name: 'Main', components: [], wires: [] },
        { id: 'Adder_4', name: 'Adder', components: [], wires: [] },
        { id: 'adder-4', name: 'Taken', components: [], wires: [] },
      ],
    };
    expect(loadDocument(v3).circuits.map((c) => c.id)).toEqual(['main', 'adder-4-2', 'adder-4']);
  });

  it('opens a schema v4 document (before test scripts) with none', () => {
    const v4 = {
      schemaVersion: 4,
      circuits: [{ id: 'main', name: 'Main', components: [], wires: [] }],
    };
    expect(loadDocument(v4).circuits[0]!.testScript).toEqual([]);
  });

  it('loads a test script line by line and rejects lines that are no lines', () => {
    const script = ["bench('x', (b) => {", '  b.wait(us(1));', '});', ''];
    expect(loadDocument(doc({ testScript: script })).circuits[0]!.testScript).toEqual(script);
    expect(problemsOf(doc({ testScript: 'bench()' }))).toEqual([
      'circuits[0].testScript: expected an array, got "bench()"',
    ]);
    expect(problemsOf(doc({ testScript: ['ok', 'a\nb', 3] }))).toEqual([
      'circuits[0].testScript[1]: expected a line of text (a string without line breaks), got "a\\nb"',
      'circuits[0].testScript[2]: expected a line of text (a string without line breaks), got 3',
    ]);
  });

  it('requires circuit ids to be slugs', () => {
    expect(
      problemsOf({
        schemaVersion: SCHEMA_VERSION,
        circuits: [
          { id: 'Main', name: 'Main', components: [], wires: [] },
          { id: 'a--b', name: 'B', components: [], wires: [] },
        ],
      }),
    ).toEqual([
      'circuits[0].id: expected a circuit id (lowercase letters and digits, runs joined by -), got "Main"',
      'circuits[1].id: expected a circuit id (lowercase letters and digits, runs joined by -), got "a--b"',
    ]);
  });

  it('loads probes: signals by reference, groups of members, radixes', () => {
    const loaded = loadDocument(
      doc({
        probes: [
          { ref: 'CLK' },
          { ref: 'D[0..7]', name: 'data', radix: 'bin' },
          { name: 'PC', members: ['U3.Q0', 'U3.Q1'], radix: 'dec' },
        ],
      }),
    );
    expect(loaded.circuits[0]!.probes).toEqual([
      { ref: 'CLK' },
      { ref: 'D[0..7]', name: 'data', radix: 'bin' },
      { name: 'PC', members: ['U3.Q0', 'U3.Q1'], radix: 'dec' },
    ]);
    expect('name' in loaded.circuits[0]!.probes[0]!).toBe(false);
  });

  it('reports every problem of a probe with its path', () => {
    expect(
      problemsOf(
        doc({
          probes: [
            { ref: '' },
            { ref: 'A', radix: 'oct' },
            { name: 'G', members: [] },
            { members: ['A', 3] },
            { ref: 'A', members: ['B'] },
            'CLK',
          ],
        }),
      ),
    ).toEqual([
      'circuits[0].probes[0].ref: expected a non-empty string, got ""',
      'circuits[0].probes[1].radix: expected "hex", "dec", "bin", "ascii", got "oct"',
      'circuits[0].probes[2].members: expected at least one member',
      'circuits[0].probes[3].name: missing (expected a non-empty string)',
      'circuits[0].probes[3].members[1]: expected a non-empty string, got 3',
      'circuits[0].probes[4]: unknown field "ref"',
      'circuits[0].probes[4].name: missing (expected a non-empty string)',
      'circuits[0].probes[5]: expected an object, got "CLK"',
    ]);
    expect(problemsOf(doc({ probes: {} }))).toEqual([
      'circuits[0].probes: expected an array, got {}',
    ]);
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

describe('loadDocument: Verilog modules (v6)', () => {
  const v6 = (circuit: Record<string, unknown>) => ({
    schemaVersion: 6,
    circuits: [{ id: 'main', name: 'Main', components: [], wires: [] }, circuit],
  });

  it('loads a module not compiled yet, and one with its IR, without parts or wires', () => {
    const loaded = loadDocument(
      v6({ id: 'gate', name: 'Gate', verilog: { module: testModule }, testScript: ['// t'] }),
    );
    expect(loaded.circuits[1]).toEqual({
      id: 'gate',
      name: 'Gate',
      components: [],
      wires: [],
      probes: [],
      testScript: ['// t'],
      verilog: { module: testModule },
    });
    expect(
      loadDocument(v6({ id: 'gate', name: 'Gate', verilog: {} })).circuits[1]?.verilog,
    ).toEqual({});
    expect(loadDocument(v6({ id: 'gate', name: 'Gate', verilog: {} })).circuits[0]?.verilog).toBe(
      undefined,
    );
  });

  it('reports an IR that is not one, with its path', () => {
    const module = { ...testModule, cells: [{ ...testModule.cells[0], type: '$lut' }] };
    expect(problemsOf(v6({ id: 'gate', name: 'Gate', verilog: { module } }))).toEqual([
      'circuits[1].verilog.module.cells[0].type: not a cell modules run: "$lut"',
    ]);
    expect(problemsOf(v6({ id: 'gate', name: 'Gate', verilog: { modul: 1 } }))).toEqual([
      'circuits[1].verilog: unknown field "modul"',
    ]);
    expect(problemsOf(v6({ id: 'gate', name: 'Gate', verilog: 1 }))).toEqual([
      'circuits[1].verilog: expected an object, got 1',
    ]);
  });

  it('refuses parts or wires in a module', () => {
    const component = { id: 'U1', type: 'prim/nand', x: 0, y: 0 };
    expect(
      problemsOf(v6({ id: 'gate', name: 'Gate', verilog: {}, components: [component] })),
    ).toEqual(['circuits[1].components: a Verilog module has no parts or wires']);
  });

  it('opens a v5 document unchanged', () => {
    const loaded = loadDocument({ ...doc({}), schemaVersion: 5 });
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.circuits[0]?.verilog).toBeUndefined();
  });

  it('opens a v6 module unchanged as v7, which may hold tri-states (HDL-8)', () => {
    const loaded = loadDocument(v6({ id: 'gate', name: 'Gate', verilog: { module: testModule } }));
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.circuits[1]?.verilog?.module).toEqual(testModule);
    const tri = {
      ...testModule,
      ports: [...testModule.ports, { name: 'io', dir: 'inout', lsb: 0, bits: ['z'] }],
      cells: [
        ...testModule.cells,
        { type: '$tribuf', src: '', ports: { A: ['0'], EN: ['1'], Y: [0] }, params: {} },
      ],
    };
    const doc7 = {
      ...v6({ id: 'gate', name: 'Gate', verilog: { module: tri } }),
      schemaVersion: 7,
    };
    expect(problemsOf(doc7)).toEqual([]);
  });

  // Modules before v9 have no `memories`.
  const { memories: _, ...v8Module } = testModule;

  it('opens a v7 module as current, gaining an empty memories; v8 ones may hold signed and HDL-9 cells', () => {
    const doc7 = { ...v6({ id: 'gate', name: 'Gate', verilog: { module: v8Module } }) };
    const loaded = loadDocument({ ...doc7, schemaVersion: 7 });
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.circuits[1]?.verilog?.module).toEqual(testModule);
    const signed = {
      ...v8Module,
      cells: [
        ...testModule.cells,
        {
          type: '$mul',
          src: '',
          ports: { A: ['1'], B: ['0'], Y: [0] },
          params: { A_SIGNED: 1, B_SIGNED: 1 },
        },
      ],
    };
    const doc8 = {
      ...v6({ id: 'gate', name: 'Gate', verilog: { module: signed } }),
      schemaVersion: 8,
    };
    expect(problemsOf(doc8)).toEqual([]);
    expect(loadDocument(doc8).circuits[1]?.verilog?.module?.memories).toEqual([]);
  });

  it('takes memories and their ports in a v9 module, and checks them (HDL-6)', () => {
    const memory = { name: 'rom', width: 8, size: 4, offset: 0, init: '0000:0102' };
    const read = {
      type: '$memrd',
      src: '',
      ports: { ADDR: [1, 2], DATA: [3, 4, 5, 6, 0, 0, 0, 0] },
      params: { MEMORY: 0 },
    };
    const module = { ...testModule, bitCount: 7, memories: [memory], cells: [read] };
    const doc9 = { ...v6({ id: 'rom', name: 'ROM', verilog: { module } }), schemaVersion: 9 };
    expect(problemsOf(doc9)).toEqual([]);
    const wrong = { ...module, memories: [{ ...memory, init: '0004:01' }] };
    expect(
      problemsOf({
        ...doc9,
        circuits: [doc9.circuits[0], { ...doc9.circuits[1], verilog: { module: wrong } }],
      }),
    ).toEqual([
      'circuits[1].verilog.module.memories[0].init: run "0004:01" is outside the memory\'s addresses 0x0–0x3',
    ]);
  });

  it('opens a v9 module unchanged, and takes and checks the timing of a v10 one (HDL-2)', () => {
    const doc9 = {
      ...v6({ id: 'gate', name: 'Gate', verilog: { module: testModule } }),
      schemaVersion: 9,
    };
    expect(loadDocument(doc9).circuits[1]?.verilog?.module).toEqual(testModule);
    const doc10 = {
      ...v6({ id: 'timed', name: 'Timed', verilog: { module: testSpecifyModule } }),
      schemaVersion: 10,
    };
    expect(loadDocument(doc10).circuits[1]?.verilog?.module).toEqual(testSpecifyModule);
    const wrong = {
      ...testSpecifyModule,
      specify: { ...testSpecifyModule.specify!, checks: [{ kind: 'skew' }] },
    };
    expect(problemsOf(doc9)).toEqual([]);
    expect(
      problemsOf({
        ...doc10,
        circuits: [doc10.circuits[0], { ...doc10.circuits[1], verilog: { module: wrong } }],
      })[0],
    ).toBe(
      'circuits[1].verilog.module.specify.checks[0].kind: expected one of setup, hold, recovery, removal, width',
    );
  });
});
