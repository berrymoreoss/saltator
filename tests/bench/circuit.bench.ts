/**
 * Circuit model throughput on a large synthetic schematic: compile (layouts, connectivity, checks,
 * netlist), serialize and parse. The editor recompiles on every edit (R05), so compile time is
 * what users feel. Results are recorded in the plan of the branch that changed them.
 */
import { describe, type TestContext, test } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  compileCircuit,
  parseDocument,
  serializeDocument,
} from '../../src/circuit';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry();

/**
 * A grid of 2-input NANDs. Each output runs straight to the next gate's input A; each column has a
 * vertical bus (one wire per row, end to end) with a T-junction stub to the next gate's input B.
 * The chain wires cross the buses without connecting. ~3 wires per gate.
 */
function grid(rows: number, columns: number): Circuit {
  const b = new CircuitBuilder(registry);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) b.add(`U${r}_${c}`, 'prim/nand', { at: [c * 12, r * 6] });
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const [x, y] = [c * 12, r * 6];
      b.wire([x + 5, y + 1], [x + 12, y + 1]); // Y → next A
      b.wire([x + 9, y + 2], [x + 9, y + 8]); // bus segment
      b.wire([x + 9, y + 2], [x + 12, y + 2]); // stub → next B
    }
  }
  return b.build();
}

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
