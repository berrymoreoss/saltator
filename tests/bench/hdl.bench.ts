/**
 * The Verilog interpreter's speed (HDL-1): the baseline HDL-7 (PicoRV32) measures against and
 * HDL-10 (fast evaluation) is held to. Printed as module evaluations/s and cells/s — every
 * evaluation runs every combinational cell once (no events inside a module). `pnpm bench` runs
 * this on native `import`. Results are recorded in the plan of the branch that changed them.
 */
import { describe, type TestContext, test } from 'vitest';
import {
  type HdlBit,
  type HdlCell,
  type HdlModule,
  NetlistBuilder,
  ns,
  Registry,
  Simulator,
  strong,
} from '../../src/core';
import { testDriver } from '../../src/core/testing';
import { fromYosys, hdlPart } from '../../src/library';
import { YOSYS_FIXTURES } from '../../src/library/hdl/fixtures';

/** A module's part on a bench: a driver on every input, a net on every output. */
function simulate(module: HdlModule): Simulator {
  const { definition } = hdlPart('hdl/bench', 'Bench', module);
  if (!definition) throw new Error('the module has errors');
  const b = new NetlistBuilder().add('M', 'hdl/bench', { delay: ns(5) });
  for (const port of module.ports) {
    const pins =
      port.bits.length === 1 ? [port.name] : port.bits.map((_, i) => `${port.name}${port.lsb + i}`);
    for (const pin of pins) {
      if (port.dir === 'in') b.add(`D_${pin}`, testDriver.type).net(pin, `M.${pin}`, `D_${pin}.Y`);
      else b.net(pin, `M.${pin}`);
    }
  }
  return new Simulator(b.build(), new Registry([definition, testDriver]));
}

/**
 * `lanes` 8-bit lanes of four cells each — q' = ~((q + k) ^ q of the next lane), a flip-flop —
 * one clock: 3 × lanes combinational cells, lanes × 8 flip-flop bits, lane 0's q an output.
 */
function synthetic(lanes: number): HdlModule {
  let next = 9; // 0: clk, 1–8: k
  const word = (): number[] => Array.from({ length: 8 }, () => next++);
  const q = Array.from({ length: lanes }, word);
  const cells: HdlCell[] = [];
  for (let i = 0; i < lanes; i++) {
    const sum = word();
    const mixed = word();
    const inverted = word();
    const k: HdlBit[] = [1, 2, 3, 4, 5, 6, 7, 8];
    cells.push(
      { type: '$add', src: '', ports: { A: q[i]!, B: k, Y: sum }, params: {} },
      { type: '$xor', src: '', ports: { A: sum, B: q[(i + 1) % lanes]!, Y: mixed }, params: {} },
      { type: '$not', src: '', ports: { A: mixed, Y: inverted }, params: {} },
      {
        type: '$dff',
        src: '',
        ports: { CLK: [0], D: inverted, Q: q[i]! },
        params: { CLK_POLARITY: 1 },
      },
    );
  }
  return {
    format: 1,
    top: 'synthetic',
    creator: '',
    bitCount: next,
    ports: [
      { name: 'clk', dir: 'in', lsb: 0, bits: [0] },
      { name: 'k', dir: 'in', lsb: 0, bits: [1, 2, 3, 4, 5, 6, 7, 8] },
      { name: 'q', dir: 'out', lsb: 0, bits: q[0]! },
    ],
    signals: [],
    cells,
  };
}

/** Benchmarks `iterate` and prints module evaluations/s and combinational cells/s. */
async function measure(
  bench: TestContext['bench'],
  name: string,
  sim: Simulator,
  cells: number,
  iterate: () => void,
): Promise<void> {
  const before = sim.stats.evaluations;
  iterate();
  const evaluations = sim.stats.evaluations - before;
  const result = await bench(name, iterate).run();
  const perSecond = result.throughput.mean * evaluations;
  console.log(
    `${name}: ${evaluations} evaluations/iteration, ${(perSecond / 1e3).toFixed(1)}k evaluations/s, ${((perSecond * cells) / 1e6).toFixed(1)}M cells/s`,
  );
}

const convert = (name: string): HdlModule => fromYosys(YOSYS_FIXTURES[name]).module!;
const combinational = (module: HdlModule) =>
  module.cells.filter((c) => !c.type.includes('dff')).length;

describe('Verilog modules', () => {
  test('address decoder (6 cells): an address change', async ({ bench }) => {
    const module = convert('decoder');
    const sim = simulate(module);
    sim.action('D_phi2', strong(1));
    let address = 0;
    const step = () => {
      address = (address + 1) & 15;
      for (let i = 0; i < 4; i++) sim.action(`D_addr${12 + i}`, strong((address >> i) & 1 ? 1 : 0));
      sim.settle();
    };
    step();
    await measure(bench, 'address decoder', sim, combinational(module), step);
  });

  test('decade counter (5 cells): one clock cycle', async ({ bench }) => {
    const module = convert('counter');
    const sim = simulate(module);
    sim.action('D_rst', strong(1));
    sim.action('D_en', strong(1));
    sim.action('D_clk', strong(0));
    sim.settle();
    sim.action('D_rst', strong(0));
    const cycle = () => {
      sim.action('D_clk', strong(1));
      sim.settle();
      sim.action('D_clk', strong(0));
      sim.settle();
    };
    cycle();
    await measure(bench, 'decade counter', sim, combinational(module), cycle);
  });

  test('synthetic module (1 024 cells, 2 048 flip-flop bits): one clock cycle', async ({
    bench,
  }) => {
    const module = synthetic(256);
    const sim = simulate(module);
    for (let i = 0; i < 8; i++) sim.action(`D_k${i}`, strong(i % 3 === 0 ? 1 : 0));
    sim.action('D_clk', strong(0));
    sim.settle();
    const cycle = () => {
      sim.action('D_clk', strong(1));
      sim.settle();
      sim.action('D_clk', strong(0));
      sim.settle();
    };
    cycle();
    await measure(bench, 'synthetic 1 024 cells', sim, combinational(module), cycle);
  });
});
