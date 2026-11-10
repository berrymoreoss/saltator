/**
 * Inside a module (HDL-4) across the layers: a document's Verilog module, run by the library's
 * interpreter, its named signals read by test benches — in the module's own benches and through
 * an instance placed in a circuit — headless, as `pnpm test:circuits` and the app's sandbox run them.
 */
import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  documentRegistry,
  emptyVerilogCircuit,
  functionScriptHost,
  runTestScript,
  SCHEMA_VERSION,
  scriptLines,
} from '../../src/circuit';
import type { HdlModule } from '../../src/core';
import { createDefaultRegistry, fromYosys } from '../../src/library';
import { YOSYS_FIXTURES } from '../../src/library/hdl/fixtures';

const library = createDefaultRegistry();
const host = functionScriptHost();

function moduleOf(name: string): HdlModule {
  const { module } = fromYosys(YOSYS_FIXTURES[name]);
  if (!module) throw new Error(`fixture ${name} doesn't convert`);
  return module;
}

const verilog = (id: string, module: HdlModule, script = ''): Circuit => ({
  ...emptyVerilogCircuit(id, id),
  verilog: { module },
  testScript: scriptLines(script),
});

/** Runs the benches of `circuit` in `document`: each bench's name, status and failures. */
function run(document: CircuitDocument, circuit: string) {
  const { error, results } = runTestScript(document, circuit, library, host);
  if (error) throw new Error(error.message);
  return results.map((r) => [
    r.name,
    r.status,
    [...r.failures.map((f) => f.message), ...(r.error ? [r.error.message] : [])],
  ]);
}

describe("a module's own benches read its signals", () => {
  it("check the traffic light's state register, not only its lights", () => {
    const script = `
bench('steps its state', (b) => {
  b.row({ clk: 0, rst_n: 0, tick: 0 }, { state: 'X' });
  b.row({ clk: 'C' }, { state: 0, 'lights[2..0]': 4 });
  b.set({ rst_n: 1, tick: 1 });
  b.table\`
    clk | state state[0] state[1:0]
    C   | 1     1        1
    C   | 2     0        2
    C   | 0     0        0
  \`;
  if (b.get('state') !== 0) b.fail('state reads ' + b.get('state'));
});

bench('reads a signal, never drives it', (b) => {
  b.set({ state: 1 });
});`;
    const document: CircuitDocument = {
      schemaVersion: SCHEMA_VERSION,
      circuits: [verilog('traffic', moduleOf('traffic'), script)],
    };
    expect(run(document, 'traffic')).toEqual([
      ['steps its state', 'pass', []],
      [
        'reads a signal, never drives it',
        'error',
        ['state is inside a module: read it, or drive a pin of the module'],
      ],
    ]);
  });
});

describe("a circuit's benches read the signals of the modules it places", () => {
  /** The `clocks` fixture as A1, its clock a bench's port CLK. */
  function placed(script: string): CircuitDocument {
    const clocks = verilog('clocks', moduleOf('clocks'));
    const draft: CircuitDocument = { schemaVersion: SCHEMA_VERSION, circuits: [clocks] };
    const main = new CircuitBuilder(documentRegistry(draft, library))
      .add('P1', 'net/port', { at: [0, 0], props: { name: 'CLK', direction: 'in' } })
      .add('A1', 'sub/clocks', { at: [20, 0] })
      .connect('P1.N', 'A1.clk')
      .tests(script)
      .build();
    return { schemaVersion: SCHEMA_VERSION, circuits: [main, clocks] };
  }

  it('by the instance path, whole, sliced and bit by bit', () => {
    const script = `
bench('counts inside', (b) => {
  b.set({ CLK: 0 });
  b.expect({ 'A1/div': 0, 'A1/rip': 0 });
  for (let n = 1; n <= 5; n++) {
    b.row({ CLK: 'C' }, { 'A1/rip': n, 'A1/rip[1:0]': n % 4, 'A1/rip[3..2]': n >> 2, 'A1/div': n % 2 });
  }
  b.expect({ 'A1/rip': 6 });
});`;
    expect(run(placed(script), 'main')).toEqual([
      ['counts inside', 'fail', ['A1/rip is 0x5, expected 0x6']],
    ]);
  });

  it('say what is inside when a name is wrong', () => {
    const script = `bench('wrong', (b) => { b.get('A1/ripple_counter'); });`;
    expect(run(placed(script), 'main')).toEqual([
      [
        'wrong',
        'error',
        [
          'A1/ripple_counter: no part, net or signal named ripple_counter in A1 (signals: div, rip, ten)',
        ],
      ],
    ]);
  });
});
