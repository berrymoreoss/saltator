/**
 * Circuit model throughput on a large synthetic schematic: compile (layouts, connectivity, checks,
 * netlist), serialize and parse. The editor recompiles on every edit (R05), so compile time is
 * what users feel. Results are recorded in the plan of the branch that changed them.
 */
import { describe, type TestContext, test } from 'vitest';
import { nandGrid } from '../../src/app/examples';
import { compileCircuit, parseDocument, serializeDocument } from '../../src/circuit';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry();

const grid = (rows: number, columns: number) => nandGrid(registry, rows, columns);

async function measure(bench: TestContext['bench'], name: string, iterate: () => void) {
  const result = await bench(name, iterate).run();
  console.log(`${name}: ${(1000 / result.throughput.mean).toFixed(2)} ms/iteration`);
}

describe('circuit', () => {
  const circuit = grid(60, 60);
  const document = { schemaVersion: 1 as const, circuits: [circuit] };
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
