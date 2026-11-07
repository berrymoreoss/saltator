/**
 * Kernel throughput, printed as events/s (iterations/s × the fixed events per iteration).
 * `pnpm bench` runs this on native `import` (see scripts/bench-resolve-hooks.ts): Vite's module runner wraps
 * every imported binding in a getter and makes hot loops ~3× slower than the real bundle.
 * Results are recorded in the plan of the branch that changed them.
 */
import { describe, type TestContext, test } from 'vitest';
import { NetlistBuilder, ns, Simulator, strong, us } from '../../src/core';
import { testDriver } from '../../src/core/testing';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry().register(testDriver);

function chain(length: number): Simulator {
  const b = new NetlistBuilder().add('IN', 'test/driver');
  let previous = 'IN.Y';
  for (let i = 0; i < length; i++) {
    b.add(`I${i}`, 'prim/not', { delay: ns(1) }).connect(previous, `I${i}.A`);
    previous = `I${i}.Y`;
  }
  return new Simulator(b.build(), registry);
}

/** `chips` 74HC04s, their six inverters chained through all of them (6 × chips stages). */
function hc04Chain(chips: number): Simulator {
  const b = new NetlistBuilder().add('IN', 'test/driver');
  let previous = 'IN.Y';
  for (let i = 0; i < chips; i++) {
    b.add(`U${i}`, '74xx/74hc04');
    for (let g = 1; g <= 6; g++) {
      b.connect(previous, `U${i}.${g}A`);
      previous = `U${i}.${g}Y`;
    }
  }
  return new Simulator(b.build(), registry);
}

/**
 * `chips` 74HC574s in a pipeline: each chip's Q0–Q7 feed the next chip's D0–D7, one clock for all.
 * Every edge loads every register, with the timing checks running on each.
 */
function hc574Pipeline(chips: number): Simulator {
  const b = new NetlistBuilder().add('CLK', 'test/driver').add('IN', 'test/driver');
  b.add('G', 'io/gnd');
  for (let i = 0; i < chips; i++) {
    b.add(`U${i}`, '74xx/74hc574').connect('CLK.Y', `U${i}.CP`).connect('G.Y', `U${i}.OE`);
    for (let n = 0; n < 8; n++) b.connect(i === 0 ? 'IN.Y' : `U${i - 1}.Q${n}`, `U${i}.D${n}`);
  }
  return new Simulator(b.build(), registry);
}

/**
 * `chips` 74HC595s in a chain: each chip's Q7S feeds the next chip's DS, SHCP and STCP tied to one
 * clock (the storage registers one pulse behind), outputs enabled. Every edge shifts every stage
 * and stores every storage register, with the timing checks running on each.
 */
function hc595Chain(chips: number): Simulator {
  const b = new NetlistBuilder().add('CLK', 'test/driver').add('IN', 'test/driver');
  b.add('G', 'io/gnd').add('V', 'io/vcc');
  for (let i = 0; i < chips; i++) {
    b.add(`U${i}`, '74xx/74hc595')
      .connect('CLK.Y', `U${i}.SHCP`, `U${i}.STCP`)
      .connect('G.Y', `U${i}.OE`)
      .connect('V.Y', `U${i}.MR`)
      .connect(i === 0 ? 'IN.Y' : `U${i - 1}.Q7S`, `U${i}.DS`);
  }
  return new Simulator(b.build(), registry);
}

function ring(stages: number): Simulator {
  const b = new NetlistBuilder().add('EN', 'test/driver').add('N0', 'prim/nand', { delay: ns(1) });
  b.connect('EN.Y', 'N0.A');
  let previous = 'N0.Y';
  for (let i = 1; i < stages; i++) {
    b.add(`I${i}`, 'prim/not', { delay: ns(1) }).connect(previous, `I${i}.A`);
    previous = `I${i}.Y`;
  }
  b.connect(previous, 'N0.B');
  return new Simulator(b.build(), registry);
}

/** Benchmarks `iterate` and prints events/s (iterations/s × events per iteration). */
async function measure(
  bench: TestContext['bench'],
  name: string,
  sim: Simulator,
  iterate: () => void,
): Promise<void> {
  const before = sim.stats.events;
  iterate();
  const events = sim.stats.events - before;
  const result = await bench(name, iterate).run();
  const perSecond = result.throughput.mean * events;
  console.log(`${name}: ${events} events/iteration, ${(perSecond / 1e6).toFixed(2)}M events/s`);
}

describe('kernel', () => {
  test('inverter chain ×1000: toggle input and settle', async ({ bench }) => {
    const sim = chain(1000);
    let level: 0 | 1 = 0;
    const toggle = () => {
      level = level === 0 ? 1 : 0;
      sim.action('IN', strong(level));
      sim.settle();
    };
    toggle(); // warm up past power-on
    await measure(bench, 'inverter chain ×1000', sim, toggle);
  });

  test('74HC04 chain ×1002 (167 chips): toggle input and settle', async ({ bench }) => {
    // Every inverter of a chip is re-evaluated on each change (R06): compare with the chain above.
    const sim = hc04Chain(167);
    let level: 0 | 1 = 0;
    const toggle = () => {
      level = level === 0 ? 1 : 0;
      sim.action('IN', strong(level));
      sim.settle();
    };
    toggle();
    await measure(bench, '74HC04 chain ×1002', sim, toggle);
  });

  test('74HC574 pipeline ×100 (800 flip-flops): one clock cycle', async ({ bench }) => {
    // The input toggles every cycle, so once the pipeline is full every bit changes on every edge.
    // 50 ns per clock phase: data settles 17 ns after an edge, well within the checks' minima.
    const sim = hc574Pipeline(100);
    let level: 0 | 1 = 0;
    sim.action('CLK', strong(0));
    sim.action('IN', strong(0));
    sim.runFor(ns(50));
    const cycle = () => {
      sim.action('CLK', strong(1));
      sim.runFor(ns(50));
      level = level === 0 ? 1 : 0;
      sim.action('CLK', strong(0));
      sim.action('IN', strong(level));
      sim.runFor(ns(50));
    };
    for (let i = 0; i < 120; i++) cycle(); // fill the pipeline
    const problems = sim.diagnostics.entries.map((d) => d.kind);
    if (problems.length > 0) throw new Error(`unexpected diagnostics: ${problems.join(', ')}`);
    await measure(bench, '74HC574 pipeline ×100', sim, cycle);
  });

  test('74HC595 chain ×100 (800 + 800 flip-flops): one clock cycle', async ({ bench }) => {
    // The input toggles every cycle: once the chain is full every stage changes on every edge.
    // 50 ns per clock phase: Q7S settles 19 ns after an edge, well within the checks' minima.
    const sim = hc595Chain(100);
    let level: 0 | 1 = 0;
    sim.action('CLK', strong(0));
    sim.action('IN', strong(0));
    sim.runFor(ns(50));
    const cycle = () => {
      sim.action('CLK', strong(1));
      sim.runFor(ns(50));
      level = level === 0 ? 1 : 0;
      sim.action('CLK', strong(0));
      sim.action('IN', strong(level));
      sim.runFor(ns(50));
    };
    for (let i = 0; i < 820; i++) cycle(); // fill the chain
    const problems = sim.diagnostics.entries.map((d) => d.kind);
    if (problems.length > 0) throw new Error(`unexpected diagnostics: ${problems.join(', ')}`);
    await measure(bench, '74HC595 chain ×100', sim, cycle);
  });

  test('ring oscillator ×1001: 100 µs of simulated time', async ({ bench }) => {
    const sim = ring(1001);
    sim.action('EN', strong(0));
    sim.settle();
    sim.action('EN', strong(1));
    sim.runFor(us(10)); // past start-up
    await measure(bench, 'ring oscillator ×1001', sim, () => {
      sim.runFor(us(100));
    });
  });
});
