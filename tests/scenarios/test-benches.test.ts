/**
 * Test benches (R15a) on real parts: a 74HC74 flip-flop tested as a subcircuit through its
 * ports, its set-up time caught when the step is too short; determinism. (The Node script host
 * is tried in scripts/script-host.test.ts: tests here are typed without Node.)
 */
import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  compileDesign,
  functionScriptHost,
  runBench,
  runTestScript,
  SCHEMA_VERSION,
} from '../../src/circuit';
import { ns, us } from '../../src/core';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry();
const host = functionScriptHost();

/**
 * `flip-flop`: the first D flip-flop of a 74HC74 behind ports D, CLK (in) and Q (out); its set
 * and reset tied HIGH, the second flip-flop's inputs LOW. Joined by labels on the pin tips.
 */
function flipFlop(script: string): Circuit {
  const b = new CircuitBuilder(registry, { id: 'flip-flop', name: 'Flip-Flop' });
  let n = 0;
  const label = (pin: string, name: string, type = 'net/label', props = {}) =>
    b.add(`${type === 'net/port' ? 'P' : 'NL'}${++n}`, type, {
      at: b.pin(pin),
      props: { name, ...props },
    });
  b.add('U1', '74xx/74hc74', { at: [10, 0] });
  b.add('PWR1', 'io/vcc', { at: [0, -10] });
  b.add('PWR2', 'io/gnd', { at: [0, 20] });
  label('PWR1.Y', 'VCC');
  label('PWR2.Y', 'GND');
  for (const pin of ['1SD', '1RD']) label(`U1.${pin}`, 'VCC');
  for (const pin of ['2SD', '2RD', '2D', '2CP']) label(`U1.${pin}`, 'GND');
  label('U1.1D', 'D', 'net/port', { direction: 'in' });
  label('U1.1CP', 'CLK', 'net/port', { direction: 'in' });
  label('U1.1Q', 'Q', 'net/port', { direction: 'out' });
  return b.tests(script).build();
}

const main = (): Circuit => new CircuitBuilder(registry, { id: 'main', name: 'Main' }).build();
const doc = (script: string): CircuitDocument => ({
  schemaVersion: SCHEMA_VERSION,
  circuits: [main(), flipFlop(script)],
});
const run = (script: string, name: string) =>
  runBench(doc(script), 'flip-flop', name, registry, host);

const LATCHES = `
bench('latches D on the rising edge', (b) => {
  b.table\`
    D CLK | Q
    1 C   | 1
    0 -   | 1     # no edge: holds
    0 C   | 0
    1 C   | 1
  \`;
});

bench('too fast for its set-up time', (b) => {
  b.set({ D: 0, CLK: 0 });
  b.wait(us(1));
  b.setStep(ns(40)); // D a quarter step (10 ns) before CLK: the 74HC74 needs 15 ns
  b.row({ D: 1, CLK: 'C' }, { Q: 1 });
});
`;

describe('test benches on a 74HC74', () => {
  it('the circuit compiles without issues', () => {
    expect(compileDesign(doc(''), registry, { top: 'flip-flop' }).issues).toEqual([]);
  });

  it('latches D through the ports, every row a microsecond', () => {
    expect(run(LATCHES, 'latches D on the rising edge')).toMatchObject({
      status: 'pass',
      failures: [],
      line: 2,
      time: us(4),
    });
  });

  it('fails a step too short for the set-up time, at the edge, on the row’s line', () => {
    const report = run(LATCHES, 'too fast for its set-up time');
    expect(report.status).toBe('fail');
    const setup = report.failures.find((f) => f.message.startsWith('setup-violation U1'));
    expect(setup).toMatchObject({ line: 16, time: us(1) + ns(10) });
    // The violation makes Q unknown: the check fails too.
    expect(report.failures.at(-1)).toMatchObject({
      line: 16,
      message: 'Q is X, expected 1',
      time: us(1) + ns(40),
    });
  });

  it('is deterministic: two runs give the same reports', () => {
    const once = runTestScript(doc(LATCHES), 'flip-flop', registry, host);
    const twice = runTestScript(doc(LATCHES), 'flip-flop', registry, host);
    expect(twice).toEqual(once);
    expect(once.results.map((r) => r.status)).toEqual(['pass', 'fail']);
  });
});
