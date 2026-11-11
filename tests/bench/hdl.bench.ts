/**
 * The Verilog interpreter's speed (HDL-1; a bus, HDL-8; wide words and internal clocks, HDL-9;
 * a soft core, HDL-7): the baseline HDL-10 (fast evaluation) is held to — PicoRV32 at 1 M cycles a
 * second (HDL-7, Q4). Printed
 * as module evaluations/s and cells/s — every evaluation runs every combinational cell once (no
 * events inside a module; a loop's cells until they settle, a clock made by logic another round).
 * `pnpm bench` runs this on native `import`. Results are recorded in the plan of the branch that
 * changed them.
 */
import { describe, type TestContext, test } from 'vitest';
import picorv32 from '../../examples/verilog-picorv32.saltator.json' with { type: 'json' };
import { compileDesign, parseDocument } from '../../src/circuit';
import {
  type ChannelSource,
  Drive,
  type HdlBit,
  type HdlCell,
  type HdlModule,
  ms,
  NetlistBuilder,
  ns,
  Recorder,
  Registry,
  Simulator,
  strong,
} from '../../src/core';
import { testDriver } from '../../src/core/testing';
import { createDefaultRegistry, fromYosys, hdlPart } from '../../src/library';
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
 * one clock: 3 × lanes combinational cells, lanes × 8 flip-flop bits, lane 0's q an output; every
 * lane changes at every edge.
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
    // Each lane's register by name (HDL-4: what probes inside a module record), with a power-up
    // value (HDL-9): without one the lanes stay `X`, which changes nothing at an edge (HDL-10).
    signals: q.map((bits, i) => ({
      name: `q${i}`,
      lsb: 0,
      bits,
      init: bits.map((_, b) => (((i * 37) >> b) & 1 ? '1' : '0')),
    })),
    memories: [],
    cells,
  };
}

/**
 * Benchmarks `iterate` and prints module evaluations/s and combinational cells/s, or the clock
 * cycles/s of an iteration of `cycles` (a soft core: what HDL-10's target counts).
 */
async function measure(
  bench: TestContext['bench'],
  name: string,
  sim: Simulator,
  cells: number,
  iterate: () => void,
  cycles?: number,
): Promise<void> {
  const before = sim.stats.evaluations;
  iterate();
  const evaluations = sim.stats.evaluations - before;
  const result = await bench(name, iterate).run();
  const perSecond = result.throughput.mean * evaluations;
  const speed =
    cycles === undefined
      ? `${((perSecond * cells) / 1e6).toFixed(1)}M cells/s`
      : `${((result.throughput.mean * cycles) / 1e3).toFixed(1)}k cycles/s`;
  console.log(
    `${name}: ${evaluations} evaluations/iteration, ${(perSecond / 1e3).toFixed(1)}k evaluations/s, ${speed}`,
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

  test('synthetic module, 16 bits inside it recorded (HDL-4): one clock cycle', async ({
    bench,
  }) => {
    const module = synthetic(256);
    const sim = simulate(module);
    // Two lanes' registers, as two 8-bit probes on M/q0 and M/q1 would record them.
    const recorder = new Recorder();
    const sources = new Map<number, ChannelSource>();
    for (let signal = 0; signal < 2; signal++) {
      for (let bit = 0; bit < 8; bit++)
        sources.set(recorder.addChannel(), { part: 'M', signal, bit });
    }
    recorder.attach(sim, sources);
    for (let i = 0; i < 8; i++) sim.action(`D_k${i}`, strong(i % 3 === 0 ? 1 : 0));
    sim.action('D_clk', strong(0));
    sim.settle();
    const cycle = () => {
      sim.action('D_clk', strong(1));
      sim.settle();
      sim.action('D_clk', strong(0));
      sim.settle();
      if (recorder.size > 1_000_000) {
        recorder.clear();
        recorder.attach(sim, sources);
      }
    };
    cycle();
    await measure(
      bench,
      'synthetic 1 024 cells, 16 inner bits recorded',
      sim,
      combinational(module),
      cycle,
    );
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

  test('register file (mem_regfile, 8 × 8, HDL-6): a write and two reads per clock cycle', async ({
    bench,
  }) => {
    const module = convert('mem_regfile');
    const sim = simulate(module);
    sim.action('D_we', strong(1));
    sim.action('D_clk', strong(0));
    sim.settle();
    let n = 0;
    const bits = (name: string, width: number, value: number) => {
      for (let i = 0; i < width; i++) sim.action(`D_${name}${i}`, strong((value >> i) & 1 ? 1 : 0));
    };
    const cycle = () => {
      n = (n + 1) & 7;
      bits('rd', 3, n);
      bits('rs1', 3, (n + 3) & 7);
      bits('rs2', 3, (n + 5) & 7);
      bits('wd', 8, (n * 37) & 0xff);
      sim.settle();
      sim.action('D_clk', strong(1));
      sim.settle();
      sim.action('D_clk', strong(0));
      sim.settle();
    };
    cycle();
    await measure(bench, 'register file', sim, combinational(module), cycle);
  });

  test("a 4K × 32 RAM (a soft core's memory, HDL-6): a write and a read per clock cycle", async ({
    bench,
  }) => {
    const pins = (from: number, width: number) => Array.from({ length: width }, (_, i) => from + i);
    const [clk, we, a, d, q] = [0, 1, pins(2, 12), pins(14, 32), pins(46, 32)];
    const module: HdlModule = {
      format: 1,
      top: 'ram4k',
      creator: '',
      bitCount: 78,
      ports: [
        { name: 'clk', dir: 'in', lsb: 0, bits: [clk] },
        { name: 'we', dir: 'in', lsb: 0, bits: [we] },
        { name: 'a', dir: 'in', lsb: 0, bits: a },
        { name: 'd', dir: 'in', lsb: 0, bits: d },
        { name: 'q', dir: 'out', lsb: 0, bits: q },
      ],
      signals: [],
      memories: [{ name: 'ram', width: 32, size: 4096, offset: 0 }],
      cells: [
        { type: '$memrd', src: '', ports: { ADDR: a, DATA: q }, params: { MEMORY: 0 } },
        {
          type: '$memwr',
          src: '',
          ports: { CLK: [clk], EN: Array(32).fill(we), ADDR: a, DATA: d },
          params: { MEMORY: 0, CLK_POLARITY: 1, PRIORITY: [] },
        },
      ],
    };
    const sim = simulate(module);
    sim.action('D_we', strong(1));
    sim.action('D_clk', strong(0));
    sim.settle();
    let n = 0;
    const cycle = () => {
      n = (n * 1103 + 12345) & 0xfff;
      for (let i = 0; i < 12; i++) sim.action(`D_a${i}`, strong((n >> i) & 1 ? 1 : 0));
      for (let i = 0; i < 32; i += 4) sim.action(`D_d${i}`, strong((n >> (i % 12)) & 1 ? 1 : 0));
      sim.settle();
      sim.action('D_clk', strong(1));
      sim.settle();
      sim.action('D_clk', strong(0));
      sim.settle();
    };
    cycle();
    await measure(bench, 'RAM 4K × 32', sim, 2, cycle);
  });
  // HDL-7: the example's module (RV32I with the barrel shifter) and its board.
  // Parsed as a file is (defaults filled in), not used as the JSON is.
  const document = parseDocument(JSON.stringify(picorv32));
  const soc = document.circuits.find((c) => c.id === 'soc')?.verilog?.module;
  if (!soc) throw new Error('the PicoRV32 example has no compiled module');

  test('PicoRV32 (the example: RV32I, barrel shifter, 4 KB RAM): a clock cycle running its program', async ({
    bench,
  }) => {
    const sim = simulate(soc);
    // n = 255: the program's loop runs, its result written every ≈ 6 400 cycles.
    for (let i = 0; i < 8; i++) sim.action(`D_in${i}`, strong(1));
    sim.action('D_resetn', strong(1));
    sim.action('D_clk', strong(0));
    sim.settle();
    const cycle = () => {
      sim.action('D_clk', strong(1));
      sim.settle();
      sim.action('D_clk', strong(0));
      sim.settle();
    };
    for (let i = 0; i < 100; i++) cycle(); // past the power-on reset
    await measure(bench, 'PicoRV32', sim, combinational(soc), cycle, 1);
  });

  test('PicoRV32 on its board (the example as the app runs it, 10 kHz clock): 10 ms, 100 cycles', async ({
    bench,
  }) => {
    const design = compileDesign(document, createDefaultRegistry());
    const sim = new Simulator(design.netlist, design.registry);
    for (let index = 0; index < 8; index++) sim.action('SW2', { type: 'set', index, on: true });
    sim.runFor(ms(20));
    const run = () => {
      sim.runFor(ms(10));
    };
    await measure(bench, 'PicoRV32 board', sim, combinational(soc), run, 100);
  });
});
