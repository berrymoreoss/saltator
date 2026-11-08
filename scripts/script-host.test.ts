import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  loadTestScript,
  runBench,
  SCHEMA_VERSION,
} from '../src/circuit/index.ts';
import { createDefaultRegistry } from '../src/library/index.ts';
import { nodeScriptHost } from './script-host.ts';

const registry = createDefaultRegistry();
const host = nodeScriptHost({ timeout: 2_000 });

/** A document whose top circuit (a switch) has `script` as its test script. */
function doc(script: string): CircuitDocument {
  const main: Circuit = new CircuitBuilder(registry, { id: 'main', name: 'Main' })
    .add('SW1', 'io/switch', { at: [0, 0] })
    .tests(script)
    .build();
  return { schemaVersion: SCHEMA_VERSION, circuits: [main] };
}
const run = (script: string, name: string) => runBench(doc(script), 'main', name, registry, host);

describe('the Node script host', () => {
  it('gives a script nothing of the host: no process, no randomness, no clock', () => {
    const script = `
bench('sandbox', (b) => {
  b.log(typeof process, typeof require, typeof Math.random, typeof Date, typeof console);
  b.log(typeof globalThis.bench, typeof us);
});`;
    expect(run(script, 'sandbox').logs.map((l) => l.text)).toEqual([
      'undefined undefined undefined undefined undefined',
      'function function',
    ]);
  });

  it('names the lines of syntax errors and of exceptions', () => {
    expect(loadTestScript('\n\nbench(', host).error).toMatchObject({
      message: expect.stringMatching(/^SyntaxError: /),
      line: 3,
    });
    expect(run("bench('x', (b) => {\n  null.y;\n});", 'x').error).toEqual({
      message: "TypeError: Cannot read properties of null (reading 'y')",
      line: 2,
    });
  });

  it('runs a bench on a real part', () => {
    expect(
      run("bench('flip', (b) => {\n  b.row({ SW1: 1 }, { 'SW1.Y': 1 });\n});", 'flip'),
    ).toMatchObject({
      status: 'pass',
      line: 1,
    });
  });

  it('stops a script that runs too long, as an error', () => {
    const quick = nodeScriptHost({ timeout: 100 });
    const report = runBench(
      doc("bench('forever', (b) => {\n  while (true) {}\n});"),
      'main',
      'forever',
      registry,
      quick,
    );
    expect(report).toMatchObject({
      status: 'error',
      error: { message: expect.stringContaining('timed out') },
    });
    const top = loadTestScript('for (;;) {}', quick);
    expect(top.error?.message).toContain('timed out');
  });
});
