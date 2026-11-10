/**
 * The Verilog interpreter's speed (HDL-1; a bus, HDL-8; wide words and internal clocks, HDL-9):
 * the baseline HDL-7 (PicoRV32) measures against and HDL-10 (fast evaluation) is held to. Printed
 * as module evaluations/s and cells/s — every evaluation runs every combinational cell once (no
 * events inside a module; a loop's cells until they settle, a clock made by logic another round).
 * `pnpm bench` runs this on native `import`. Results are recorded in the plan of the branch that
 * changed them.
 */
import { describe, type TestContext, test } from 'vitest';
import {
  Drive,
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

/** A module's part on a bench: a driver on every input and inout, a net on every output. */
function simulate(module: HdlModule): Simulator {
  const { definition } = hdlPart('hdl/bench', 'Bench', module);
  if (!definition) throw new Error('the module has errors');
  const b = new NetlistBuilder().add('M', 'hdl/bench', { delay: ns(5) });
  for (const port of module.ports) {
    const pins =
      port.bits.length === 1 ? [port.name] : port.bits.map((_, i) => `${port.name}${port.lsb + i}`);
    for (const pin of pins) {
      if (port.dir !== 'out') b.add(`D_${pin}`, testDriver.type).net(pin, `M.${pin}`, `D_${pin}.Y`);
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

  test('wide words (64-bit counter, 32 × 32 multiplier, 72-bit sum, compare, shift): a clock cycle with new operands', async ({
    bench,
  }) => {
    const module = convert('wide_ops');
    const sim = simulate(module);
    const word = (name: string, width: number, value: bigint) => {
      for (let i = 0; i < width; i++) {
        sim.action(`D_${name}${i}`, strong((value >> BigInt(i)) & 1n ? 1 : 0));
      }
    };
    word('x', 72, 0x89_abcd_ef01_2345_6789n);
    word('y', 72, 0x12_3456_789a_bcde_f012n);
    word('n', 7, 13n);
    sim.action('D_s', strong(1));
    sim.action('D_rst', strong(1));
    sim.action('D_clk', strong(0));
    sim.settle();
    sim.action('D_clk', strong(1));
    sim.settle();
    sim.action('D_clk', strong(0));
    sim.action('D_rst', strong(0));
    sim.settle();
    let value = 0x12345678;
    const cycle = () => {
      value = (Math.imul(value, 1103515245) + 12345) >>> 0;
      word('a', 32, BigInt(value));
      word('b', 32, BigInt(value ^ 0x5a5a5a5a));
      sim.action('D_clk', strong(1));
      sim.settle();
      sim.action('D_clk', strong(0));
      sim.settle();
    };
    cycle();
    await measure(bench, 'wide words', sim, combinational(module), cycle);
  });

  test('clocks made inside the module (a divider, a ripple chain, a reset by logic): a clock cycle', async ({
    bench,
  }) => {
    const module = convert('clocks');
    const sim = simulate(module);
    for (let i = 0; i < 4; i++) sim.action(`D_d${i}`, strong(i % 2 ? 1 : 0));
    sim.action('D_clk', strong(0));
    sim.settle();
    const cycle = () => {
      sim.action('D_clk', strong(1));
      sim.settle();
      sim.action('D_clk', strong(0));
      sim.settle();
    };
    cycle();
    await measure(bench, 'internal clocks', sim, combinational(module), cycle);
  });

  test('I/O port (7 cells) on its data bus: a write and a read', async ({ bench }) => {
    const module = convert('io_port');
    const sim = simulate(module);
    for (let i = 0; i < 8; i++) sim.action(`D_pins${i}`, strong(i % 2 ? 1 : 0));
    sim.action('D_cs_n', strong(0));
    sim.action('D_strobe', strong(0));
    sim.settle();
    let value = 0;
    const cycle = () => {
      // A write: the bench drives the bus, the strobe loads it.
      value = (value + 1) & 255;
      for (let i = 0; i < 8; i++) sim.action(`D_d${i}`, strong((value >> i) & 1 ? 1 : 0));
      sim.action('D_rw', strong(0));
      sim.action('D_strobe', strong(1));
      sim.settle();
      sim.action('D_strobe', strong(0));
      sim.settle();
      // A read: the bench lets go (the bus floats for the module's delay), the port drives it.
      for (let i = 0; i < 8; i++) sim.action(`D_d${i}`, Drive.Z);
      sim.action('D_rw', strong(1));
      sim.action('D_strobe', strong(1));
      sim.settle();
      sim.action('D_strobe', strong(0));
      sim.settle();
    };
    cycle();
    await measure(bench, 'I/O port', sim, combinational(module), cycle);
  });
});
