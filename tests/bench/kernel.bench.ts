/**
 * Kernel throughput, printed as events/s (iterations/s × the fixed events per iteration).
 * `pnpm bench` runs this on native `import` (see scripts/resolve-hooks.ts): Vite's module runner wraps
 * every imported binding in a getter and makes hot loops ~3× slower than the real bundle.
 * Results are recorded in the plan of the branch that changed them.
 */
import { describe, type TestContext, test } from 'vitest';
import { NetlistBuilder, ns, Recorder, Simulator, strong, Trigger, us } from '../../src/core';
import { testDriver } from '../../src/core/testing';
import { Timeline } from '../../src/editor/timeline';
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

/**
 * A 74HC4040 sweeping the addresses of `chips` 6116s on one address bus, every RAM selected and
 * reading, filled with random bytes: each count ripples through the counter and makes every
 * RAM's outputs go `X` and then to the new byte (the read path's wake-ups).
 */
function ramSweep(chips: number): Simulator {
  const b = new NetlistBuilder().add('CLK', 'test/driver').add('MR', 'test/driver');
  b.add('C', '74xx/74hc4040').add('G', 'io/gnd').add('V', 'io/vcc');
  b.connect('CLK.Y', 'C.CP').connect('MR.Y', 'C.MR');
  for (let i = 0; i < chips; i++) {
    b.add(`M${i}`, 'mem/6116', { powerOn: 'random' });
    b.connect('G.Y', `M${i}.CS`, `M${i}.OE`).connect('V.Y', `M${i}.WE`);
    for (let a = 0; a < 11; a++) b.connect(`C.Q${a}`, `M${i}.A${a}`);
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

  test('6116 ×16 read by a 74HC4040: one count', async ({ bench }) => {
    // A counter without a reset counts X forever: reset it first.
    const sim = ramSweep(16);
    sim.action('CLK', strong(1));
    sim.action('MR', strong(1));
    sim.runFor(ns(100));
    sim.action('MR', strong(0));
    sim.runFor(ns(100));
    const cycle = () => {
      sim.action('CLK', strong(0)); // the 4040 counts on the falling edge
      sim.runFor(ns(250)); // Q10 ripples out by ≈ 127 ns, the RAMs read 25 ns later
      sim.action('CLK', strong(1));
      sim.runFor(ns(50));
    };
    for (let i = 0; i < 10; i++) cycle();
    const problems = sim.diagnostics.entries.map((d) => d.kind);
    if (problems.length > 0) throw new Error(`unexpected diagnostics: ${problems.join(', ')}`);
    await measure(bench, '6116 ×16 read by a 74HC4040', sim, cycle);
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

  // R13: the waveform recorder's cost. Every net of the ring changes; the listener filters them.
  for (const probed of [16, 1001]) {
    test(`ring oscillator ×1001 recording ${probed} nets: 100 µs`, async ({ bench }) => {
      const sim = ring(1001);
      sim.action('EN', strong(0));
      sim.settle();
      const recorder = new Recorder();
      const nets = new Map<number, number>();
      for (let i = 0; i < probed; i++) {
        const stage = Math.floor((i * 1001) / probed);
        nets.set(recorder.addChannel(), sim.pinNet(stage === 0 ? 'N0' : `I${stage}`, 'Y'));
      }
      recorder.attach(sim, nets);
      sim.action('EN', strong(1));
      sim.runFor(us(10));
      await measure(bench, `ring oscillator ×1001 recording ${probed} nets`, sim, () => {
        sim.runFor(us(100));
      });
    });
  }

  // R14: a breakpoint's cost (its own recorder of one net, a repeating trigger looking at the end
  // of every instant) and measuring every net's activity (a counting listener).
  test('ring oscillator ×1001 with a breakpoint: 100 µs', async ({ bench }) => {
    const sim = ring(1001);
    sim.action('EN', strong(0));
    sim.settle();
    const recorder = new Recorder({ budget: 65_536 });
    const channel = recorder.addChannel();
    recorder.attach(sim, new Map([[channel, sim.pinNet('I500', 'Y')]]));
    // It fires at every rise of its net; the callback (a host's pause) does nothing here.
    new Trigger(recorder, [{ kind: 'rise', channel }], () => undefined, { repeat: true }).attach(
      sim,
    );
    sim.action('EN', strong(1));
    sim.runFor(us(10));
    await measure(bench, 'ring oscillator ×1001 with a breakpoint', sim, () => {
      sim.runFor(us(100));
    });
  });

  test('ring oscillator ×1001 measuring activity: 100 µs', async ({ bench }) => {
    const sim = ring(1001);
    const counts = new Float64Array(sim.netCount);
    sim.onNetChange((_, net) => {
      counts[net] = counts[net]! + 1;
    });
    sim.action('EN', strong(0));
    sim.settle();
    sim.action('EN', strong(1));
    sim.runFor(us(10));
    await measure(bench, 'ring oscillator ×1001 measuring activity', sim, () => {
      sim.runFor(us(100));
    });
  });

  // R14b: the host's history — the run in the host's chunks of 20 000 events, the timeline told
  // after each (a checkpoint every 200 000 events, thinned within 64 MiB).
  const inChunks = (sim: Simulator, dt: number, after?: () => void) => () => {
    const end = sim.now + dt;
    while (sim.now < end) {
      sim.runUntil(end, { maxEvents: 20_000 });
      after?.();
    }
  };

  for (const history of [false, true]) {
    const name = `ring oscillator ×1001 in host chunks${history ? ' with a history' : ''}`;
    test(`${name}: 100 µs`, async ({ bench }) => {
      const sim = ring(1001);
      sim.action('EN', strong(0));
      sim.settle();
      const timeline = history ? new Timeline(sim) : undefined;
      sim.action('EN', strong(1));
      timeline?.acted('EN', strong(1));
      sim.runFor(us(10));
      await measure(
        bench,
        name,
        sim,
        inChunks(sim, us(100), () => timeline?.ran()),
      );
    });
  }

  for (const history of [false, true]) {
    const name = `6116 ×16 read by a 74HC4040, 100 counts${history ? ' with a history' : ''}`;
    test(name, async ({ bench }) => {
      const sim = ramSweep(16);
      sim.action('CLK', strong(1));
      sim.action('MR', strong(1));
      sim.runFor(ns(100));
      sim.action('MR', strong(0));
      sim.runFor(ns(100));
      const timeline = history ? new Timeline(sim) : undefined;
      let level: 0 | 1 = 0;
      await measure(bench, name, sim, () => {
        for (let i = 0; i < 200; i++) {
          level = level === 0 ? 1 : 0;
          sim.action('CLK', strong(level));
          sim.runFor(ns(200));
          timeline?.ran();
        }
      });
    });
  }
});
