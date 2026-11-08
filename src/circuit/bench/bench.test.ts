import { describe, expect, it } from 'vitest';
import { ns, us } from '../../core';
import { CircuitBuilder } from '../builder';
import { compileDesign } from '../design';
import { type CircuitDocument, SCHEMA_VERSION } from '../document';
import { CircuitBench, DEFAULT_STEP } from './bench';
import { benchTestDocument, cell } from './test-circuits';
import { benchTestRegistry } from './test-parts';
import { BenchError } from './values';

const registry = benchTestRegistry();
const document = benchTestDocument();
const bench = (circuit: string, options = {}) =>
  new CircuitBench(document, circuit, registry, options);
const messages = (b: CircuitBench) => b.report().failures.map((f) => f.message);

describe('the test circuits', () => {
  it('compile without errors (lone labels name nets for the benches)', () => {
    for (const circuit of document.circuits) {
      const { issues } = compileDesign(document, registry, { top: circuit.id });
      expect(issues.filter((i) => i.code !== 'single-net-label')).toEqual([]);
    }
  });
});

describe('CircuitBench on a subcircuit', () => {
  it('drives its input ports and checks its outputs, every row a step', () => {
    const b = bench('cell');
    for (const [a, c, y] of [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [1, 1, 1],
    ] as const) {
      b.row({ A: a, B: c }, { Y: y });
    }
    expect(b.now).toBe(4 * DEFAULT_STEP);
    expect(b.report()).toMatchObject({ status: 'pass', failures: [], failureCount: 0 });
  });

  it('reports a check that fails with what was there, and goes on', () => {
    const b = bench('cell', { line: () => 7 });
    b.row({ A: 1, B: 1 }, { Y: 0 }, 'both high');
    b.row({ A: 0 }, { Y: 0 });
    b.expect({ Y: 1, A: 'X' });
    const report = b.report();
    expect(report.status).toBe('fail');
    expect(report.failures).toEqual([
      {
        line: 7,
        time: us(1),
        message: 'Y is 1, expected 0 (both high)',
        ref: 'Y',
        expected: '0',
        actual: '1',
      },
      { line: 7, time: us(2), message: 'Y is 0, expected 1', ref: 'Y', expected: '1', actual: '0' },
    ]);
  });

  it('starts with its ports released, so they float until set', () => {
    const b = bench('cell');
    b.wait(ns(10));
    expect(b.get('A')).toBe('Z');
    expect(b.get('Y')).toBe('X');
    b.set({ A: 1, B: 'Z' });
    b.wait(ns(10));
    expect([b.get('A'), b.get('B'), b.get('Y')]).toEqual([1, 'Z', 'X']);
    expect(b.report().warnings.map((w) => w.kind)).toContain('floating-input');
  });

  it('sees nothing of a change before time passes', () => {
    const b = bench('cell');
    b.row({ A: 1, B: 1 }, { Y: 1 });
    b.set({ B: 0 });
    b.expect({ Y: 1 }); // the gate hasn't seen it yet
    b.wait(ns(2));
    b.expect({ Y: 0 });
    expect(b.report().status).toBe('pass');
  });

  it('drives a bus port as a value and reads a memory through it', () => {
    const b = bench('memory');
    b.action('U1', { type: 'poke', address: 3, data: [0x2a, 0x55] });
    b.row({ 'A[0..3]': 3 }, { 'D[0..7]': 0x2a, 'U1[3]': 0x2a, 'U1[3..4]': [0x2a, 0x55] });
    b.row({ 'A[0..3]': 4 }, { 'D[0..7]': '0x55' });
    b.row({ A0: 1 }, { 'D[0..7]': 'X' }); // one bit of the bus port: address 5, unknown
    expect(b.get('D[0..7]')).toBe('0xXX');
    expect(b.get('U1[4..5]')).toEqual([0x55, '0xXX']);
    b.row({}, { 'D[0..7]': 'unknown', 'U1[5]': 0 });
    expect(messages(b)).toEqual(['U1[5] is 0xXX, expected 0x00']);
  });

  it('names each failing cell of a range', () => {
    const b = bench('memory');
    b.action('U1', { type: 'poke', address: 0, data: [1, 2, 3] });
    b.expect({ 'U1[0..2]': [1, 9, 3] });
    expect(messages(b)).toEqual(['U1[1] is 0x02, expected 0x09']);
    expect(() => b.expect({ 'U1[0..2]': [1, 2] })).toThrow(
      'U1[0..2]: expected 3 values (an array), got [1,2]',
    );
  });
});

describe('CircuitBench.memory', () => {
  it('pokes bytes into a RAM, at any time, as numbers or hex text', () => {
    const b = bench('memory');
    b.memory('U1', 0, [0x2a, 0x55]);
    b.memory('U1', '0x0E', '01 $FF');
    b.memory('U1', 2, 0x7f);
    b.expect({ 'U1[0..3]': [0x2a, 0x55, 0x7f, 'unknown'], 'U1[E..F]': [1, 0xff] });
    b.row({ 'A[0..3]': 15 }, { 'D[0..7]': 0xff });
    b.memory('U1', 'F', [0x80]); // while running: the outputs follow
    b.wait(ns(10));
    b.expect({ 'D[0..7]': 0x80 });
    expect(b.report().status).toBe('pass');
  });

  it('loads an Intel HEX image', () => {
    const b = bench('memory');
    // Two bytes at 0x0004 and one at 0x000F (checksums computed by a script).
    b.loadIntelHex('U1', ':020004002A557B\n:01000F00AB45\n:00000001FF\n');
    b.expect({ 'U1[4..5]': [0x2a, 0x55], 'U1[F]': 0xab });
    expect(b.report().status).toBe('pass');
    expect(() => b.loadIntelHex('U1', ':0100000000FE\n')).toThrow(/^U1: .*checksum/);
    expect(() => b.loadIntelHex('U1', 3)).toThrow("loadIntelHex: the file's text, got 3");
  });

  it('replaces a ROM’s image before power-on, that instance only', () => {
    const b = bench('roms');
    b.memory('U1', 1, [0xa5]);
    b.memory('U1', 3, '5A');
    b.row({ A0: 1, A1: 0 }, { 'D[0..7]': 0xa5, 'U1[0..3]': [0x11, 0xa5, 0x33, 0x5a] });
    b.row({ A0: 0 }, { 'D[0..7]': 0x11 });
    expect(b.report().status).toBe('pass');
    expect(document.circuits[3]!.components[0]!.props).toEqual({ contents: '0000:11223344' });
    expect(() => b.memory('U1', 0, [0])).toThrow(
      'U1 is a ROM: load its image before anything else in the bench (it is read at power-on)',
    );
  });

  it('refuses what isn’t a memory, addresses past it and bytes that aren’t', () => {
    const b = bench('memory');
    expect(() => b.memory('PA', 0, [1])).toThrow('PA: no part or net named PA');
    expect(() => b.memory('A0', 0, [1])).toThrow('A0 is not a memory');
    expect(() => b.memory('U1', 16, [1])).toThrow('U1: an address 0…0xF, got 16');
    expect(() => b.memory('U1', '10', [1])).toThrow('U1: The last address is F.');
    expect(() => b.memory('U1', 15, [1, 2])).toThrow(
      'U1: 2 bytes at 0xF reach past the last address 0xF',
    );
    expect(() => b.memory('U1', 0, [256])).toThrow(
      "U1: bytes are numbers 0…255 or hex text ('2A 55'), got 256",
    );
    expect(() => b.memory('U1', 0, 'zz')).toThrow('got "zz"');
    expect(() => bench('main').memory('U1', 0, [1])).toThrow('U1 is not a memory');
  });
});

describe('CircuitBench.table', () => {
  it('runs a table’s rows as steps, failures on the row’s line', () => {
    const b = bench('cell', { line: () => 10 });
    const one = 1;
    b.table`
      A B      | Y
      0 0      | 0
      1 ${one} | 1
      1 0      | 1     # wrong on purpose
      - 1      | -
    `;
    expect(b.now).toBe(4 * DEFAULT_STEP);
    expect(b.report().failures).toEqual([
      {
        line: 14,
        time: us(3),
        message: 'Y is 0, expected 1',
        ref: 'Y',
        expected: '1',
        actual: '0',
      },
    ]);
  });

  it('pulses C cells and takes a plain string', () => {
    const b = bench('main');
    b.set({ SW1: 1 });
    b.table('X1 | Q\nC | 1\n- | 1');
    expect(b.report().status).toBe('pass');
  });

  it('throws a table’s mistakes with their line in the script', () => {
    const b = bench('cell', { line: () => 20 });
    const error = (run: () => void) => {
      try {
        run();
      } catch (e) {
        return { message: (e as BenchError).message, line: (e as BenchError).line };
      }
      return undefined;
    };
    expect(
      error(
        () => b.table`
          A B | Y
          0 0 0`,
      ),
    ).toEqual({ message: 'table: a row needs one | between inputs and outputs', line: 22 });
    expect(
      error(
        () => b.table`
          A B | Y
          0 7 | 0`,
      ),
    ).toEqual({ message: 'B: expected 0 or 1, got 7', line: 22 });
    expect(error(() => b.table(3))).toMatchObject({
      message: 'table: write it as b.table`A B | Y …` (a template) or with text',
    });
    // Without a line from the host, a row's error has none either.
    expect(error(() => bench('cell').table('A | Y\n9 | 0'))).toEqual({
      message: 'A: expected 0 or 1, got 9',
      line: undefined,
    });
  });
});

describe('CircuitBench on the top circuit', () => {
  it('flips switches, presses buttons and sets DIP switches', () => {
    const b = bench('main');
    b.row({ SW1: 1, SW3: 0b0001 }, { DATA: 1, S0: 1, BOTH: 0 });
    b.press('SW2');
    b.wait(ns(5));
    b.expect({ PUSH: 1, BOTH: 1 });
    b.release('SW2');
    b.row({ SW3: 0b1110, SW2: 1 }, { PUSH: 1, 'SW3.Y3': 1, S0: 0, BOTH: 0 });
    expect(b.report().status).toBe('pass');
  });

  it('clocks a flip-flop with a manual clock: the data set up a quarter step before', () => {
    const b = bench('main');
    b.set({ SW1: 1 });
    b.clock('X1');
    b.expect({ Q: 1 });
    b.row({ SW1: 0, X1: 'C' }, { Q: 0 });
    b.row({ SW1: 1, X1: '-' }, { Q: 0, DATA: 1 });
    expect(b.report().status).toBe('pass');
  });

  it('pulses a button in a row: pressed from ¼ to ¾ of the step', () => {
    const b = bench('main');
    b.setStep(us(4));
    b.set({ SW3: 1 });
    b.row({ SW2: 'C' }, { BOTH: 0 });
    b.wait(us(1));
    b.expect({ BOTH: 0 });
    b.clock('SW2');
    expect(b.report().status).toBe('pass');
    expect(b.now).toBe(us(9));
  });

  it('fails a bench on a simulation error, at its instant, and keeps the warnings apart', () => {
    const b = bench('main', { line: () => 3 });
    b.wait(us(1));
    b.set({ SW1: 1 });
    b.clock('X1', 1); // the clock rises a quarter step after the data — fine
    b.setStep(ns(20)); // now 5 ns: too close
    b.set({ SW1: 0 });
    b.clock('X1');
    const report = b.report();
    expect(report.status).toBe('fail');
    expect(report.failures).toEqual([
      {
        line: 3,
        time: us(2) + ns(5),
        message: 'setup-violation U1: D changed less than 10 ns before CLK',
      },
    ]);
    expect(b.get('Q')).toBe('X');
  });

  it('refuses inputs that aren’t, pulses that can’t be, and values that don’t fit', () => {
    const b = bench('main');
    expect(() => b.set({ U1: 1 })).toThrow(
      'U1 is not an input: drive an input port, a switch, a button or a manual clock',
    );
    expect(() => b.set({ Q: 1 })).toThrow('Q is not an input');
    expect(() => b.set({ U9: 1 })).toThrow('U9: no part or net named U9');
    expect(() => b.set({ X1: 1 })).toThrow('X1 is a clock: pulse it with b.clock or C in a row');
    expect(() => b.set({ SW1: 'C' })).toThrow('SW1: a pulse (C) takes a step');
    expect(() => b.clock('SW1')).toThrow('SW1 is a switch: set it, it has no pulse');
    expect(() => b.row({ SW3: 'C' })).toThrow('SW3 is a switch: set it, it has no pulse');
    expect(() => b.clock('X2')).toThrow('X2 runs freely: only a manual clock steps');
    expect(() => b.set({ SW3: 16 })).toThrow('SW3: expected 0…15, got 16');
    expect(() => b.set({ SW1: 'X' })).toThrow('SW1: a switch is 0 or 1');
    expect(() => b.press('SW1')).toThrow('SW1 is not a button');
    expect(() => b.action('SW1', { type: 'jump' })).toThrow('SW1: SW1: bad action');
    expect(() => b.expect({ U9: 1 })).toThrow('U9: no part or net named U9');
    expect(() => b.expect({ U1: 1 })).toThrow('U1 is a part: probe one of its pins');
  });

  it('refuses arguments of the wrong kind', () => {
    const b = bench('main');
    expect(() => b.set('SW1')).toThrow(`set: an object such as { CLK: 0, 'D[0..7]': 0x2A }`);
    expect(() => b.set([1])).toThrow('set: an object');
    expect(() => b.press(3)).toThrow(`press: a reference such as 'CLK' or 'U1.Q', got 3`);
    expect(() => b.wait(-1)).toThrow(`wait: a time such as us(10) or '10us', got -1`);
    expect(() => b.wait('soon')).toThrow(`wait: a time such as us(10) or '10us', got "soon"`);
    expect(() => b.setStep(3)).toThrow('setStep: a step of at least 4 ps, got 3');
    expect(() => b.clock('X1', 1.5)).toThrow('clock: a count of pulses (0, 1, 2, …), got 1.5');
    expect(() => b.expect({}, 3)).toThrow('expect: the note is text');
    b.wait('2us');
    expect(b.now).toBe(us(2));
  });

  it('runs a free-running clock while waiting', () => {
    const b = bench('main');
    b.wait(ns(750));
    b.expect({ FREE: 1 });
    b.wait(ns(500));
    b.expect({ FREE: 0 });
    expect(b.report().status).toBe('pass');
  });

  it('logs, draws seeded numbers and stops on fail', () => {
    const b = bench('main', { line: () => 12, seed: 7 });
    b.log('at', 3, { a: 1 });
    expect(b.report().logs).toEqual([{ line: 12, time: 0, text: 'at 3 {"a":1}' }]);
    const draws = [b.random(), b.random()];
    const again = bench('main', { seed: 7 });
    expect([again.random(), again.random()]).toEqual(draws);
    expect(draws[0]).not.toBe(draws[1]);
    expect(() => b.fail('gave up')).toThrow('the bench stopped');
    expect(b.report()).toMatchObject({ status: 'fail', failures: [{ message: 'gave up' }] });
  });

  it('keeps the first failures and counts the rest', () => {
    const b = bench('main', { maxFailures: 2 });
    for (let i = 0; i < 5; i++) b.expect({ DATA: 1 });
    expect(b.report()).toMatchObject({ failureCount: 5, failures: [{}, {}] });
  });

  it('reports a stopped bench as an error with the reason', () => {
    const report = bench('main').report({ message: 'no part U9', line: 4 });
    expect(report).toMatchObject({ status: 'error', error: { message: 'no part U9', line: 4 } });
  });
});

describe('CircuitBench on a circuit with design errors', () => {
  it('refuses to start, listing them by circuit', () => {
    const built = new CircuitBuilder(registry, { id: 'main', name: 'Main' })
      .add('U1', 'test/and', { at: [0, 0] })
      .build();
    const broken = { ...built, components: [{ ...built.components[0]!, type: 'test/nope' }] };
    const doc = (...circuits: CircuitDocument['circuits']): CircuitDocument => ({
      schemaVersion: SCHEMA_VERSION,
      circuits,
    });
    expect(() => new CircuitBench(doc(broken), 'main', registry)).toThrow(BenchError);
    expect(() => new CircuitBench(doc(broken), 'main', registry)).toThrow(
      /Main has design errors:\n {2}Main: .*test\/nope/,
    );
    // An error in a circuit the bench doesn't use doesn't matter.
    expect(() => new CircuitBench(doc(broken, cell()), 'cell', registry)).not.toThrow();
    expect(() => new CircuitBench(doc(cell()), 'nope', registry)).toThrow('no circuit "nope"');
  });
});
