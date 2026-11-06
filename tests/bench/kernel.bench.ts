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
