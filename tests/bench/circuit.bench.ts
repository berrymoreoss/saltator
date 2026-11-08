/**
 * Circuit model throughput on a large synthetic schematic: compile (layouts, connectivity, checks,
 * netlist), serialize and parse. The editor recompiles on every edit (R05), so compile time is
 * what users feel. Results are recorded in the plan of the branch that changed them.
 */
import { describe, type TestContext, test } from 'vitest';
import { nandGrid } from '../../src/app/examples';
import {
  type Circuit,
  type CircuitDocument,
  CompileCache,
  compileCircuit,
  compileDesign,
  parseDocument,
  SCHEMA_VERSION,
  serializeDocument,
} from '../../src/circuit';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry();

const grid = (rows: number, columns: number) => nandGrid(registry, rows, columns);

async function measure(bench: TestContext['bench'], name: string, iterate: () => void) {
  const result = await bench(name, iterate).run();
  console.log(`${name}: ${(1000 / result.throughput.mean).toFixed(2)} ms/iteration`);
}

describe('circuit', () => {
  const circuit = grid(60, 60);
  const document: CircuitDocument = { schemaVersion: SCHEMA_VERSION, circuits: [circuit] };
  const text = serializeDocument(document);
  const label = `${circuit.components.length} parts, ${circuit.wires.length} wires`;

  test(`compile: ${label}`, async ({ bench }) => {
    await measure(bench, `compile (${label})`, () => {
      compileCircuit(circuit, registry);
    });
  });

  test(`serialize and parse: ${label}`, async ({ bench }) => {
    await measure(bench, `serialize (${label})`, () => {
      serializeDocument(document);
    });
    await measure(bench, `parse (${label})`, () => {
      parseDocument(text);
    });
  });
});

describe('design', () => {
  // A 50-part cell, four of them in a row, four rows in the top: 16 instances, two levels.
  const cell: Circuit = { ...grid(5, 10), id: 'cell', name: 'Cell' };
  const place = (count: number, type: string): Circuit['components'] =>
    Array.from({ length: count }, (_, i) => ({
      id: `A${i + 1}`,
      type,
      x: i * 80,
      y: 0,
      rotation: 0,
      flip: false,
      props: {},
    }));
  const row: Circuit = {
    id: 'row',
    name: 'Row',
    components: place(4, 'sub/cell'),
    wires: [],
    probes: [],
    testScript: [],
  };
  const top: Circuit = {
    id: 'main',
    name: 'Main',
    components: place(4, 'sub/row'),
    wires: [],
    probes: [],
    testScript: [],
  };
  const document: CircuitDocument = { schemaVersion: SCHEMA_VERSION, circuits: [top, row, cell] };
  const parts = compileDesign(document, registry).netlist.components.length;
  const label = `16 × ${cell.components.length} parts, ${parts} flattened`;

  test(`compile and flatten: ${label}`, async ({ bench }) => {
    await measure(bench, `compile and flatten (${label})`, () => {
      compileDesign(document, registry);
    });
    const cache = new CompileCache();
    compileDesign(document, registry, { cache });
    await measure(bench, `flatten, circuits cached (${label})`, () => {
      compileDesign(document, registry, { cache });
    });
  });
});
