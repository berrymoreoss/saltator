import { describe, expect, it } from 'vitest';
import { us } from '../../core';
import type { CircuitDocument } from '../document';
import { functionScriptHost } from './function-host';
import { loadTestScript, runBench, runTestScript } from './script';
import { benchTestDocument } from './test-circuits';
import { benchTestRegistry } from './test-parts';

const registry = benchTestRegistry();
const host = functionScriptHost();

/** The test document with `script` as the test script of circuit `circuit`. */
function withScript(script: string, circuit = 'cell'): CircuitDocument {
  const document = benchTestDocument();
  return {
    ...document,
    circuits: document.circuits.map((c) =>
      c.id === circuit ? { ...c, testScript: script.split('\n') } : c,
    ),
  };
}

const run = (script: string, name: string, circuit = 'cell') =>
  runBench(withScript(script, circuit), circuit, name, registry, host);

describe('loadTestScript', () => {
  it('lists the benches a script registers, with their lines', () => {
    const script = [
      'const helper = (b) => b.row({ A: 1, B: 1 }, { Y: 1 });',
      "bench('first', (b) => helper(b));",
      '',
      "bench('second', (b) => {",
      '  helper(b);',
      '});',
    ].join('\n');
    expect(loadTestScript(script, host)).toEqual({
      benches: [
        { name: 'first', line: 2 },
        { name: 'second', line: 4 },
      ],
    });
    expect(loadTestScript('', host)).toEqual({ benches: [] });
  });

  it('says why a script doesn’t load', () => {
    expect(loadTestScript("bench('a', (b) => {});\nnope();", host)).toEqual({
      benches: [],
      error: { message: 'ReferenceError: nope is not defined', line: 2 },
    });
    expect(loadTestScript("bench('a', () => {});\nbench('a', () => {});", host)).toEqual({
      benches: [],
      error: { message: 'bench "a" is there twice (line 1)', line: 2 },
    });
    expect(loadTestScript('bench(3, () => {});', host).error).toEqual({
      message: 'bench(name, fn): the name is text, such as "counts to 9"',
      line: 1,
    });
    expect(loadTestScript("bench('a');", host).error?.message).toBe(
      'bench "a": the second argument is a function (b) => { … }',
    );
    expect(loadTestScript('throw "up";', host).error?.message).toBe('the script threw up');
    expect(loadTestScript('bench(', host).error?.message).toMatch(/^SyntaxError: /);
  });

  it('gives the time helpers in picoseconds', () => {
    const script = "bench('t', (b) => { b.wait(ps(1) + ns(1) + us(1) + ms(1) + s(1)); });";
    expect(run(script, 't').time).toBe(1 + 1e3 + 1e6 + 1e9 + 1e12);
  });
});

describe('runBench', () => {
  it('runs a passing bench and reports it with its name and line', () => {
    const script = "\nbench('and', (b) => {\n  b.table`A B | Y\n    1 1 | 1\n    0 1 | 0`;\n});";
    expect(run(script, 'and')).toMatchObject({
      name: 'and',
      line: 2,
      status: 'pass',
      failures: [],
      time: us(2),
    });
  });

  it('names the script line of every failure, inside helpers and tables', () => {
    const script = [
      'const check = (b, y) => b.expect({ Y: y });', // 1
      "bench('and', (b) => {", // 2
      '  b.row({ A: 1, B: 1 }, { Y: 0 });', // 3
      '  check(b, 0);', // 4
      '  b.table`', // 5
      '    A B | Y', // 6
      '    0 0 | 1', // 7
      '  `;', // 8
      '});',
    ].join('\n');
    const report = run(script, 'and');
    expect(report.status).toBe('fail');
    expect(report.failures.map((f) => [f.line, f.message])).toEqual([
      [3, 'Y is 1, expected 0'],
      [1, 'Y is 1, expected 0'],
      [7, 'Y is 0, expected 1'],
    ]);
  });

  it('ends with an error where the script went wrong, keeping what it found', () => {
    const script = [
      "bench('typo', (b) => {", // 1
      '  b.row({ A: 1, B: 1 }, { Y: 0 });', // 2
      '  b.sett({ A: 0 });', // 3
      '});',
      "bench('bad ref', (b) => {", // 5
      '  b.wait(us(1));', // 6
      '  b.expect({ U9: 1 });', // 7
      '});',
    ].join('\n');
    const typo = run(script, 'typo');
    expect(typo).toMatchObject({
      status: 'error',
      error: { message: 'TypeError: b.sett is not a function', line: 3 },
      failureCount: 1,
      time: us(1),
    });
    expect(run(script, 'bad ref')).toMatchObject({
      status: 'error',
      error: { message: 'U9: no part or net named U9', line: 7 },
      time: us(1),
    });
  });

  it('refuses async benches', () => {
    const report = run("bench('async', async (b) => { b.wait(us(1)); });", 'async');
    expect(report).toMatchObject({
      status: 'error',
      error: { message: 'benches are synchronous: no async function, nothing to await', line: 1 },
    });
  });

  it('stops a bench on b.fail as a failure, not an error', () => {
    const report = run("bench('f', (b) => {\n  b.fail('enough');\n  b.wait(us(1));\n});", 'f');
    expect(report).toMatchObject({ status: 'fail', failures: [{ message: 'enough', line: 2 }] });
    expect(report.time).toBe(0);
  });

  it('runs every bench in a scope of its own', () => {
    const script = [
      'let runs = 0;',
      "bench('one', (b) => { runs++; b.log(runs); });",
      "bench('two', (b) => { runs++; b.log(runs); });",
    ].join('\n');
    const { results } = runTestScript(withScript(script), 'cell', registry, host);
    expect(results.map((r) => [r.name, r.logs.map((l) => l.text)])).toEqual([
      ['one', ['1']],
      ['two', ['1']],
    ]);
  });

  it('draws the same random numbers each run, others in another bench', () => {
    const script = [
      "bench('r', (b) => b.log(b.random()));",
      "bench('s', (b) => b.log(b.random()));",
    ].join('\n');
    const once = runTestScript(withScript(script), 'cell', registry, host).results;
    const twice = runTestScript(withScript(script), 'cell', registry, host).results;
    expect(twice).toEqual(once);
    expect(once[0]!.logs[0]!.text).not.toBe(once[1]!.logs[0]!.text);
  });

  it('gives b a frozen API with the bench’s time and step', () => {
    const script = [
      "bench('api', (b) => {",
      '  b.setStep(us(2));',
      '  b.wait(us(3));',
      '  b.log(b.now, b.step, Object.isFrozen(b), typeof b.memory, typeof b.loadIntelHex);',
      '  try { b.now = 0; } catch { b.log("read-only"); }',
      '  try { undeclared = 1; } catch { b.log("strict"); }',
      '});',
    ].join('\n');
    expect(run(script, 'api').logs.map((l) => l.text)).toEqual([
      '3000000 2000000 true function function',
      'read-only',
      'strict',
    ]);
  });

  it('reports a missing bench, circuit or a circuit with design errors as an error', () => {
    expect(run('', 'nope')).toMatchObject({
      status: 'error',
      error: { message: 'no bench "nope" in the script' },
    });
    expect(runBench(withScript(''), 'ghost', 'x', registry, host)).toMatchObject({
      status: 'error',
      error: { message: 'no circuit "ghost"' },
    });
    const document = withScript("bench('x', (b) => {});");
    const broken: CircuitDocument = {
      ...document,
      circuits: document.circuits.map((c) =>
        c.id === 'cell'
          ? { ...c, components: c.components.map((p) => ({ ...p, type: 'test/nope' })) }
          : c,
      ),
    };
    expect(runBench(broken, 'cell', 'x', registry, host)).toMatchObject({
      name: 'x',
      line: 1,
      status: 'error',
      error: { message: expect.stringContaining('Cell has design errors'), line: 1 },
    });
  });

  it('runs every bench of a script, or says why it can’t', () => {
    const script = "bench('a', (b) => b.wait(1));\nbench('b', (b) => b.expect({ Y: 1 }));";
    const { results } = runTestScript(withScript(script), 'cell', registry, host);
    expect(results.map((r) => [r.name, r.status])).toEqual([
      ['a', 'pass'],
      ['b', 'fail'],
    ]);
    expect(runTestScript(withScript('bench('), 'cell', registry, host)).toMatchObject({
      results: [],
      error: { message: expect.stringMatching(/^SyntaxError/) },
    });
  });
});
