/**
 * The examples' test benches (R15a) pass — every bench of every circuit's test script, so a
 * change that breaks an example's behavior fails `pnpm check` (and CI). And they would catch a
 * broken circuit: a wire taken out of the Decade Counter fails its benches with what was where.
 * (`pnpm test:circuits` runs the same benches in the Node host.)
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_FILES, exampleDocument } from '../../src/app/example-files';
import {
  type CircuitDocument,
  functionScriptHost,
  loadTestScript,
  runBench,
  runTestScript,
} from '../../src/circuit';
import { ms, us } from '../../src/core';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry();
const host = functionScriptHost();

/** Every bench of the examples: example, circuit and bench name. */
const benches = EXAMPLE_FILES.flatMap(({ id }) =>
  exampleDocument(id).circuits.flatMap((circuit) =>
    loadTestScript(circuit.testScript.join('\n'), host).benches.map((bench) => ({
      example: id,
      circuit: circuit.id,
      bench: bench.name,
    })),
  ),
);

describe('example benches', () => {
  it('are there: Half Adder, RAM by Hand, the Two-Digit Counter’s three circuits', () => {
    const where = new Set(benches.map((b) => `${b.example}/${b.circuit}`));
    expect([...where].sort()).toEqual([
      'half-adder/main',
      'ram-by-hand/main',
      'two-digit-counter/counter-digit',
      'two-digit-counter/decade-counter',
      'two-digit-counter/main',
    ]);
    for (const { id } of EXAMPLE_FILES) {
      for (const circuit of exampleDocument(id).circuits) {
        expect(loadTestScript(circuit.testScript.join('\n'), host).error).toBeUndefined();
      }
    }
  });

  it.each(benches)(
    '$example › $circuit › $bench passes, the same twice',
    ({ example, circuit, bench }) => {
      const report = runBench(exampleDocument(example), circuit, bench, registry, host);
      expect(report.failures).toEqual([]);
      expect(report.error).toBeUndefined();
      expect(report.status).toBe('pass');
      expect(report.warnings).toEqual([]);
      expect(runBench(exampleDocument(example), circuit, bench, registry, host)).toEqual(report);
    },
  );

  it('load the RAM before power-on (M2: a bench with a memory setup)', () => {
    const report = runBench(
      exampleDocument('ram-by-hand'),
      'main',
      'reads what was loaded before power-on',
      registry,
      host,
    );
    expect(report).toMatchObject({ status: 'pass', time: us(4) });
  });
});

describe('a broken example', () => {
  /** The Two-Digit Counter with the Decade Counter's clear gate (U3, a 74HC08) taken out. */
  function withoutClearGate(): CircuitDocument {
    const document = exampleDocument('two-digit-counter');
    return {
      ...document,
      circuits: document.circuits.map((c) =>
        c.id === 'decade-counter'
          ? { ...c, components: c.components.filter((part) => part.id !== 'U3') }
          : c,
      ),
    };
  }

  it('fails its benches with the line, instant, signal, expected and actual value', () => {
    const { results } = runTestScript(withoutClearGate(), 'decade-counter', registry, host);
    expect(results.map((r) => r.status)).toEqual(['fail', 'fail', 'fail']);
    // Without the gate MR floats: the counter never clears, so it counts from unknown.
    expect(results[0]!.failures[0]).toEqual({
      line: 3,
      time: us(1),
      message: 'Q[0..3] is 0xX, expected 0x0',
      ref: 'Q[0..3]',
      expected: '0x0',
      actual: '0xX',
    });
  });

  it('fails the top circuit’s bench through the hierarchy', () => {
    const report = runBench(
      withoutClearGate(),
      'main',
      'counts the clock from 00 after RESET, round past 99',
      registry,
      host,
    );
    expect(report.status).toBe('fail');
    expect(report.failures[0]).toMatchObject({ line: 8, ref: 'A2/Q[0..3]' });
    expect(report.failures[0]!.time).toBeGreaterThan(ms(250));
  });
});
