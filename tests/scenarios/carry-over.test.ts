/**
 * Editing a running circuit recompiles it and carries the simulation over
 * (`Simulator.carryOver`). The invariant: recompiling an unchanged netlist at any instant
 * changes nothing — same net changes at the same times, same part states.
 */
import { describe, expect, it } from 'vitest';
import {
  Drive,
  isTimingViolation,
  levelChar,
  ms,
  type Netlist,
  NetlistBuilder,
  ns,
  pinsOf,
  resolveProps,
  Simulator,
  type Time,
  us,
} from '../../src/core';
import { hd44780Controller, st7789Controller, w65c02s } from '../../src/library';
import { COUNT_TO_FIVE, computer } from './computer-6502';
import { rng, scenarioRegistry } from './support';

const registry = scenarioRegistry();

/** An action delivered at a time. */
interface Poke {
  readonly time: Time;
  readonly component: string;
  readonly action: unknown;
}

/**
 * Runs `netlist` until `end`, delivering `pokes`; at each instant in `recompiles` the simulator
 * is replaced by one built from the same netlist with the carry-over. Returns every net change
 * (`time net=level`) and the final simulator.
 */
function run(netlist: Netlist, end: Time, pokes: readonly Poke[], recompiles: readonly Time[]) {
  let sim = new Simulator(netlist, registry);
  const changes: string[] = [];
  const listen = (s: Simulator) =>
    s.onNetChange((t, net, level) => changes.push(`${t} ${s.netId(net)}=${levelChar(level)}`));
  listen(sim);
  const stops = [...new Set([...pokes.map((p) => p.time), ...recompiles, end])].sort(
    (a, b) => a - b,
  );
  for (const t of stops) {
    sim.runUntil(t);
    for (const poke of pokes) if (poke.time === t) sim.action(poke.component, poke.action);
    if (recompiles.includes(t)) {
      sim = new Simulator(netlist, registry, { carry: sim.carryOver() });
      listen(sim);
    }
  }
  sim.runUntil(end);
  return { changes, sim };
}

function expectInvisible(netlist: Netlist, end: Time, pokes: readonly Poke[], at: Time[]) {
  const plain = run(netlist, end, pokes, []);
  const edited = run(netlist, end, pokes, at);
  expect(edited.changes).toEqual(plain.changes);
  expect(edited.sim.now).toBe(plain.sim.now);
  // The same timing violations too: a check firing on the recompile's forced evaluation would
  // show here. (Floating inputs are reported again after a recompile, by design.)
  const violations = (sim: Simulator) =>
    sim.diagnostics.entries.filter((d) => isTimingViolation(d.kind));
  expect(violations(edited.sim)).toEqual(violations(plain.sim));
  for (const { id } of netlist.components) {
    expect(edited.sim.stateOf(id), id).toEqual(plain.sim.stateOf(id));
  }
  return plain;
}

/** The R04 Hello LED circuits plus a DIP switch bank, a button and a gate latch. */
function bench(): Netlist {
  return new NetlistBuilder()
    .add('SW1', 'io/switch')
    .add('U1', 'prim/nand')
    .add('PWR1', 'io/vcc')
    .add('D1', 'io/led')
    .add('PWR2', 'io/gnd')
    .connect('SW1.Y', 'U1.A')
    .connect('PWR1.Y', 'U1.B')
    .connect('U1.Y', 'D1.A')
    .connect('D1.K', 'PWR2.Y')
    .add('X1', 'io/clock', { frequency: 25e6, duty: 30 })
    .add('D2', 'io/led')
    .connect('X1.Y', 'D2.A', 'U3.A')
    .connect('D2.K', 'PWR2.Y')
    .add('SW2', 'io/button')
    .add('R1', 'prim/pull', { direction: 'up' })
    .add('SW3', 'io/dip-switch', { count: 2, contact: 'spst-gnd' })
    .add('R2', 'prim/pull', { direction: 'up' })
    .add('U2', 'prim/nand', { delay: ns(2) }) // latch: SW3.S1 sets, SW3.S2 resets (active low)
    .add('U3', 'prim/nand', { inputs: 3, delay: ns(3) })
    .connect('SW3.S1', 'R1.Y', 'U2.A')
    .connect('SW3.S2', 'R2.Y', 'U3.B')
    .connect('U2.Y', 'U3.C')
    .connect('U3.Y', 'U2.B')
    .add('DS1', 'io/seven-segment')
    .connect('U2.Y', 'DS1.a')
    .connect('SW2.Y', 'DS1.b')
    .connect('DS1.COM', 'PWR2.Y')
    .build();
}

const benchPokes: Poke[] = [
  { time: ns(100), component: 'SW1', action: { type: 'toggle' } },
  { time: ns(130), component: 'SW3', action: { type: 'toggle', index: 0 } },
  { time: ns(170), component: 'SW3', action: { type: 'toggle', index: 0 } },
  { time: ns(210), component: 'SW2', action: { type: 'press' } },
  { time: ns(260), component: 'SW3', action: { type: 'set', index: 1, on: true } },
  { time: ns(261), component: 'SW2', action: { type: 'release' } },
  { time: ns(300), component: 'SW1', action: { type: 'set', on: false } },
];

describe('recompiling an unchanged netlist is invisible', () => {
  it('in a circuit of IO parts, gates, a latch and a clock, at many instants', () => {
    const at = [1, ns(7), ns(100), ns(130), ns(131.5), ns(171), ns(200), ns(261), ns(333)];
    const { changes } = expectInvisible(bench(), ns(400), benchPokes, at);
    expect(changes.length).toBeGreaterThan(30);
    expect(changes).toContain(`${ns(132)} U2.Y=1`); // the latch was set
  });

  it('before the first run and right after an action at the same instant', () => {
    const pokes: Poke[] = [{ time: ns(50), component: 'SW1', action: { type: 'toggle' } }];
    expectInvisible(bench(), ns(120), pokes, [0, ns(50)]);
  });

  it('in random gate networks with clocks and drivers (seeded)', () => {
    const gates = ['nand', 'nor', 'and', 'or', 'xor', 'xnor', 'not', 'buffer'] as const;
    for (let seed = 1; seed <= 40; seed++) {
      const random = rng(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      const b = new NetlistBuilder();
      const outputs: string[] = [];
      for (let i = 0; i < 2; i++) {
        b.add(`X${i}`, 'io/clock', { frequency: 10e6 + Math.floor(random() * 90e6), duty: 50 });
        b.add(`T${i}`, 'test/driver');
        outputs.push(`X${i}.Y`, `T${i}.Y`);
      }
      const inputs: string[] = [];
      for (let i = 0; i < 12; i++) {
        const kind = pick(gates);
        const delay = ns(1 + Math.floor(random() * 5));
        const n = kind === 'not' || kind === 'buffer' ? 1 : 2 + Math.floor(random() * 2);
        b.add(`U${i}`, `prim/${kind}`, n === 1 ? { delay } : { inputs: n, delay });
        for (let k = 0; k < n; k++) inputs.push(`U${i}.${'ABC'[k]}`);
        outputs.push(`U${i}.Y`);
      }
      // Every input on a random output (feedback loops included); some left floating.
      for (const input of inputs) if (random() < 0.9) b.connect(pick(outputs), input);
      const netlist = b.build();
      const pokes: Poke[] = Array.from({ length: 8 }, () => ({
        time: Math.floor(random() * us(2)),
        component: pick(['T0', 'T1']),
        action: pick([Drive.STRONG_0, Drive.STRONG_1, Drive.Z]),
      }));
      const at = Array.from({ length: 10 }, () => Math.floor(random() * us(2)));
      expectInvisible(netlist, us(2), pokes, at);
    }
  });

  it('in random networks of 74xx chips: gates, buffers, transceivers on shared nets (seeded)', () => {
    const chips = ['00', '02', '04', '10', '20', '86', '125', '126', '240', '244', '245'];
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const random = rng(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      const b = new NetlistBuilder();
      const outputs: string[] = [];
      const inputs: string[] = [];
      for (let i = 0; i < 2; i++) {
        b.add(`X${i}`, 'io/clock', { frequency: 10e6 + Math.floor(random() * 40e6), duty: 50 });
        b.add(`T${i}`, 'test/driver');
        outputs.push(`X${i}.Y`, `T${i}.Y`);
      }
      for (let i = 0; i < 5; i++) {
        const type = `74xx/74hc${pick(chips)}`;
        b.add(`U${i}`, type);
        for (const pin of pinsOf(registry.get(type)!, {})) {
          if (pin.dir === 'in' || pin.dir === 'bidir') inputs.push(`U${i}.${pin.name}`);
          if (pin.dir === 'out' || pin.dir === 'tristate' || pin.dir === 'bidir') {
            outputs.push(`U${i}.${pin.name}`);
          }
        }
      }
      // Every input on a random output (feedback, shared buses and fights included); some left
      // floating. A 245 port picked as an output joins two buses.
      for (const input of inputs) if (random() < 0.85) b.connect(pick(outputs), input);
      const netlist = b.build();
      const pokes: Poke[] = Array.from({ length: 8 }, () => ({
        time: Math.floor(random() * us(2)),
        component: pick(['T0', 'T1']),
        action: pick([Drive.STRONG_0, Drive.STRONG_1, Drive.Z]),
      }));
      const at = Array.from({ length: 10 }, () => Math.floor(random() * us(2)));
      total += expectInvisible(netlist, us(2), pokes, at).changes.length;
    }
    expect(total).toBeGreaterThan(3000); // the networks really switch
  });

  it('in random networks of MSI chips and 555 timers, stateful ones included (seeded)', () => {
    const chips = ['85', '138', '139', '147', '148', '151', '153', '157', '158', '283', '4511'];
    const modes = ['astable', 'monostable', 'bistable'] as const;
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const random = rng(1000 + seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      const b = new NetlistBuilder();
      const outputs: string[] = [];
      const inputs: string[] = [];
      for (let i = 0; i < 2; i++) {
        b.add(`X${i}`, 'io/clock', { frequency: 10e6 + Math.floor(random() * 40e6), duty: 50 });
        b.add(`T${i}`, 'test/driver');
        outputs.push(`X${i}.Y`, `T${i}.Y`);
      }
      const parts: [string, string, Record<string, string | number>][] = [];
      for (let i = 0; i < 5; i++) parts.push([`U${i}`, `74xx/74hc${pick(chips)}`, {}]);
      for (let i = 0; i < 2; i++) {
        // Fast timers (100 Ω – 1 kΩ, 1 nF: well under a microsecond) so they act within 2 µs.
        const props = {
          mode: pick(modes),
          ra: 100 + Math.floor(random() * 900),
          rb: 100 + Math.floor(random() * 900),
          c: 1e-9,
        };
        parts.push([`N${i}`, 'timer/ne555', props]);
      }
      for (const [id, type, props] of parts) {
        b.add(id, type, props);
        const definition = registry.get(type)!;
        for (const pin of pinsOf(definition, resolveProps(definition, props))) {
          if (pin.dir === 'in' || pin.dir === 'bidir') inputs.push(`${id}.${pin.name}`);
          if (pin.dir === 'out' || pin.dir === 'tristate' || pin.dir === 'bidir') {
            outputs.push(`${id}.${pin.name}`);
          }
        }
      }
      for (const input of inputs) if (random() < 0.85) b.connect(pick(outputs), input);
      const netlist = b.build();
      const pokes: Poke[] = Array.from({ length: 8 }, () => ({
        time: Math.floor(random() * us(2)),
        component: pick(['T0', 'T1']),
        action: pick([Drive.STRONG_0, Drive.STRONG_1, Drive.Z]),
      }));
      const at = Array.from({ length: 10 }, () => Math.floor(random() * us(2)));
      total += expectInvisible(netlist, us(2), pokes, at).changes.length;
    }
    expect(total).toBeGreaterThan(3000);
  });
});

describe('recompiling flip-flops and registers mid-run', () => {
  it('is invisible in random networks of them, timing violations included (seeded)', () => {
    const chips = ['74', '107', '109', '112', '173', '175', '273', '374', '377', '574', '4511'];
    let changes = 0;
    let violations = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const random = rng(2000 + seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      const b = new NetlistBuilder();
      const outputs: string[] = [];
      const inputs: string[] = [];
      for (let i = 0; i < 2; i++) {
        b.add(`X${i}`, 'io/clock', { frequency: 5e6 + Math.floor(random() * 40e6), duty: 50 });
        b.add(`T${i}`, 'test/driver');
        outputs.push(`X${i}.Y`, `T${i}.Y`);
      }
      for (let i = 0; i < 5; i++) {
        const type = `74xx/74hc${pick(chips)}`;
        b.add(`U${i}`, type);
        for (const pin of pinsOf(registry.get(type)!, {})) {
          if (pin.dir === 'in') inputs.push(`U${i}.${pin.name}`);
          if (pin.dir === 'out' || pin.dir === 'tristate') outputs.push(`U${i}.${pin.name}`);
        }
      }
      // Clocks, data and resets from anywhere: racing inputs make plenty of violations.
      for (const input of inputs) if (random() < 0.9) b.connect(pick(outputs), input);
      const netlist = b.build();
      const pokes: Poke[] = Array.from({ length: 8 }, () => ({
        time: Math.floor(random() * us(2)),
        component: pick(['T0', 'T1']),
        action: pick([Drive.STRONG_0, Drive.STRONG_1, Drive.Z]),
      }));
      const at = Array.from({ length: 10 }, () => Math.floor(random() * us(2)));
      const { changes: list, sim } = expectInvisible(netlist, us(2), pokes, at);
      changes += list.length;
      for (const d of sim.diagnostics.entries) if (isTimingViolation(d.kind)) violations += d.count;
    }
    expect(changes).toBeGreaterThan(5000); // the networks really switch
    expect(violations).toBeGreaterThan(200); // and the checks really fire
  });
});

describe('recompiling counters and shift registers mid-run', () => {
  it('is invisible in random networks of them, timing violations included (seeded)', () => {
    const chips = ['161', '163', '164', '165', '191', '193', '595', '4040'];
    let changes = 0;
    let violations = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const random = rng(3000 + seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      const b = new NetlistBuilder();
      const outputs: string[] = [];
      const inputs: string[] = [];
      for (let i = 0; i < 2; i++) {
        b.add(`X${i}`, 'io/clock', { frequency: 5e6 + Math.floor(random() * 40e6), duty: 50 });
        b.add(`T${i}`, 'test/driver');
        outputs.push(`X${i}.Y`, `T${i}.Y`);
      }
      for (let i = 0; i < 5; i++) {
        const type = `74xx/74hc${pick(chips)}`;
        b.add(`U${i}`, type);
        for (const pin of pinsOf(registry.get(type)!, {})) {
          if (pin.dir === 'in') inputs.push(`U${i}.${pin.name}`);
          if (pin.dir === 'out' || pin.dir === 'tristate') outputs.push(`U${i}.${pin.name}`);
        }
      }
      // Clocks, enables, loads and resets from anywhere: plenty of counting and violations.
      for (const input of inputs) if (random() < 0.9) b.connect(pick(outputs), input);
      const netlist = b.build();
      const pokes: Poke[] = Array.from({ length: 8 }, () => ({
        time: Math.floor(random() * us(2)),
        component: pick(['T0', 'T1']),
        action: pick([Drive.STRONG_0, Drive.STRONG_1, Drive.Z]),
      }));
      const at = Array.from({ length: 10 }, () => Math.floor(random() * us(2)));
      const { changes: list, sim } = expectInvisible(netlist, us(2), pokes, at);
      changes += list.length;
      for (const d of sim.diagnostics.entries) if (isTimingViolation(d.kind)) violations += d.count;
    }
    expect(changes).toBeGreaterThan(5000);
    expect(violations).toBeGreaterThan(200);
  });
});

describe('recompiling memories mid-run', () => {
  it('is invisible in random networks of EEPROMs and SRAMs, writes and pokes included (seeded)', () => {
    const memories = ['mem/at28c16', 'mem/6116', 'mem/62256'];
    let changes = 0;
    let violations = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const random = rng(4000 + seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      const b = new NetlistBuilder();
      const outputs: string[] = [];
      const inputs: string[] = [];
      const data: string[] = [];
      const rams: string[] = [];
      for (let i = 0; i < 2; i++) {
        b.add(`X${i}`, 'io/clock', { frequency: 2e6 + Math.floor(random() * 30e6), duty: 50 });
        b.add(`T${i}`, 'test/driver');
        outputs.push(`X${i}.Y`, `T${i}.Y`);
      }
      // A counter to sweep addresses.
      b.add('C', '74xx/74hc4040');
      inputs.push('C.CP', 'C.MR');
      for (let q = 0; q < 12; q++) outputs.push(`C.Q${q}`);
      for (let i = 0; i < 3; i++) {
        const type = pick(memories);
        const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256));
        const powerOn = pick(['x', 'zeros', 'random']);
        const props =
          type === 'mem/6116'
            ? { speed: pick(['15', '20', '25']), powerOn }
            : type === 'mem/62256'
              ? { powerOn }
              : { contents: `0000:${bytes.map((x) => x.toString(16).padStart(2, '0')).join('')}` };
        b.add(`M${i}`, type, props);
        if (type !== 'mem/at28c16') rams.push(`M${i}`);
        for (const pin of pinsOf(registry.get(type)!, resolveProps(registry.get(type)!, props))) {
          if (pin.dir === 'in') inputs.push(`M${i}.${pin.name}`);
          if (pin.dir === 'bidir') data.push(`M${i}.${pin.name}`);
        }
      }
      // Controls from the clocks and drivers (writes, often too short or too late), addresses
      // from anywhere; data pins on shared nets with drivers or each other.
      const sources = ['X0.Y', 'X1.Y', 'T0.Y', 'T1.Y'];
      for (const input of inputs) {
        const control = /\.(CS|CE|OE|WE)$/.test(input);
        if (control) b.connect(pick(sources), input);
        else if (random() < 0.9) b.connect(pick(outputs), input);
      }
      for (const pin of data) if (random() < 0.8) b.connect(pick([...outputs, ...data]), pin);
      const netlist = b.build();
      const pokes: Poke[] = Array.from({ length: 10 }, () => {
        const time = Math.floor(random() * us(3));
        if (rams.length > 0 && random() < 0.3) {
          const address = Math.floor(random() * 2040);
          return {
            time,
            component: pick(rams),
            action: { type: 'poke', address, data: [1, 2, 3] },
          };
        }
        return {
          time,
          component: pick(['T0', 'T1']),
          action: pick([Drive.STRONG_0, Drive.STRONG_1, Drive.Z]),
        };
      });
      const at = Array.from({ length: 12 }, () => Math.floor(random() * us(3)));
      const { changes: list, sim } = expectInvisible(netlist, us(3), pokes, at);
      changes += list.length;
      for (const d of sim.diagnostics.entries) if (isTimingViolation(d.kind)) violations += d.count;
    }
    expect(changes).toBeGreaterThan(5000);
    expect(violations).toBeGreaterThan(50);
  });
});

describe('recompiling LCD modules mid-run', () => {
  it('is invisible in random networks of them, accepted and rejected transfers included (seeded)', () => {
    let changes = 0;
    let written = 0;
    let rejected = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const random = rng(5000 + seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      const b = new NetlistBuilder();
      const outputs: string[] = [];
      for (let i = 0; i < 2; i++) {
        b.add(`X${i}`, 'io/clock', { frequency: 2e4 + Math.floor(random() * 2e5), duty: 50 });
        b.add(`T${i}`, 'test/driver');
        outputs.push(`X${i}.Y`, `T${i}.Y`);
      }
      // A counter for changing RS, R/W̅ and data.
      b.add('C', '74xx/74hc4040');
      b.connect('X0.Y', 'C.CP').connect('T0.Y', 'C.MR');
      for (let q = 0; q < 12; q++) outputs.push(`C.Q${q}`);
      const lcds = ['L0', 'L1'];
      for (const id of lcds) {
        b.add(id, 'periph/hd44780', {
          size: pick(['16x2', '20x4', '8x1', '40x2']),
          powerOn: pick(['reset', 'unknown']),
          oscillator: pick([190_000, 270_000, 350_000]),
        });
        b.connect(pick(['X0.Y', 'X1.Y']), `${id}.E`);
        b.connect(pick(outputs), `${id}.RS`);
        b.connect(pick([...outputs, 'T1.Y']), `${id}.RW`);
        for (let i = 0; i < 8; i++) if (random() < 0.8) b.connect(pick(outputs), `${id}.DB${i}`);
      }
      const netlist = b.build();
      const end = ms(10) + us(400);
      // The counter is reset first (a floating bus makes every transfer unknown), then the
      // drivers do what they like.
      const pokes: Poke[] = [
        { time: 0, component: 'T0', action: Drive.STRONG_1 },
        { time: us(1), component: 'T0', action: Drive.STRONG_0 },
        ...Array.from({ length: 12 }, () => ({
          time: us(2) + Math.floor(random() * end),
          component: pick(['T0', 'T1']),
          action: pick([Drive.STRONG_0, Drive.STRONG_1, Drive.Z]),
        })),
      ];
      const at = [
        ...Array.from({ length: 4 }, () => Math.floor(random() * end)),
        ...Array.from({ length: 6 }, () => ms(10) + Math.floor(random() * us(400))),
      ];
      const { changes: list, sim } = expectInvisible(netlist, end, pokes, at);
      changes += list.length;
      for (const id of lcds) {
        const ctl = hd44780Controller(sim.stateOf(id))!;
        written += ctl.ddram.filter((cell, i) => cell !== 0x20 || ctl.ddramX[i]).length;
      }
      rejected += sim.diagnostics.entries.filter((d) => d.kind === 'busy-violation').length;
    }
    expect(changes).toBeGreaterThan(5000);
    expect(written).toBeGreaterThan(20);
    expect(rejected).toBeGreaterThan(0);
  });
});

describe('recompiling TFT modules mid-run', () => {
  it('is invisible in random networks of them, bytes, resets and glitches included (seeded)', () => {
    let changes = 0;
    let versions = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const random = rng(7000 + seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
      const b = new NetlistBuilder();
      const outputs: string[] = [];
      for (let i = 0; i < 2; i++) {
        b.add(`X${i}`, 'io/clock', { frequency: 1e5 + Math.floor(random() * 2e6), duty: 50 });
        b.add(`T${i}`, 'test/driver');
        outputs.push(`X${i}.Y`, `T${i}.Y`);
      }
      // A counter for changing SDA, D/CX, CS and RES.
      b.add('C', '74xx/74hc4040');
      b.connect('X0.Y', 'C.CP').connect('T0.Y', 'C.MR');
      for (let q = 0; q < 12; q++) outputs.push(`C.Q${q}`);
      const tfts = ['D0', 'D1'];
      for (const id of tfts) {
        b.add(id, 'periph/st7789', { panel: pick(['240x320', '240x240', '135x240']) });
        b.connect(pick(['X0.Y', 'X1.Y']), `${id}.SCL`);
        for (const pin of ['SDA', 'DC', 'CS', 'RES']) b.connect(pick(outputs), `${id}.${pin}`);
      }
      const netlist = b.build();
      const end = us(400);
      const pokes: Poke[] = [
        { time: 0, component: 'T0', action: Drive.STRONG_1 },
        { time: us(1), component: 'T0', action: Drive.STRONG_0 },
        ...Array.from({ length: 12 }, () => ({
          time: us(2) + Math.floor(random() * end),
          component: pick(['T0', 'T1']),
          action: pick([Drive.STRONG_0, Drive.STRONG_1, Drive.Z]),
        })),
      ];
      const at = Array.from({ length: 10 }, () => Math.floor(random() * end));
      const { changes: list, sim } = expectInvisible(netlist, end, pokes, at);
      changes += list.length;
      for (const id of tfts) versions += st7789Controller(sim.stateOf(id))!.version;
    }
    expect(changes).toBeGreaterThan(5000);
    expect(versions).toBeGreaterThan(100);
  });
});

describe('recompiling a running CPU', () => {
  it('is invisible in a W65C02S computer at random instants, resets included (seeded)', () => {
    const netlist = computer({ rom: COUNT_TO_FIVE });
    const end = us(260); // the program runs again after the second reset and ends with A = 5
    // RESB released off the clock's edges, pressed again mid-program, released again.
    const pokes: Poke[] = [
      { time: 0, component: 'R', action: Drive.STRONG_0 },
      { time: us(5) + ns(310), component: 'R', action: Drive.STRONG_1 },
      { time: us(60) + ns(310), component: 'R', action: Drive.STRONG_0 },
      { time: us(64) + ns(310), component: 'R', action: Drive.STRONG_1 },
    ];
    const random = rng(6502);
    // Random instants, and instants on the clock's edges and the CPU's wake-ups.
    const at = [
      ...Array.from({ length: 12 }, () => Math.floor(random() * end)),
      us(30),
      us(30) + ns(10),
      us(30) + ns(30),
      us(30) + ns(500),
      us(30) + ns(525),
      // Late in the cycles of the start-up code after the second reset, read once, its ROM data
      // long valid: a recompile must not stamp those bytes read again.
      ...Array.from({ length: 10 }, (_, i) => us(70 + i) + ns(300)),
    ];
    const { sim } = expectInvisible(netlist, end, pokes, at);
    const view = w65c02s.cpu!.view(sim.stateOf('U1'));
    expect([view.mode, view.values[0]]).toEqual(['running', 5]);
  });
});

describe('editing while running', () => {
  const latch = (extra?: (b: NetlistBuilder) => NetlistBuilder) => {
    const b = new NetlistBuilder()
      .add('S', 'test/driver')
      .add('R', 'test/driver')
      .add('U1', 'prim/nand')
      .add('U2', 'prim/nand')
      .connect('S.Y', 'U1.A')
      .connect('R.Y', 'U2.B')
      .connect('U1.Y', 'U2.A')
      .connect('U2.Y', 'U1.B');
    return (extra ? extra(b) : b).build();
  };

  it('a gate latch keeps its value when parts are added and connected', () => {
    let sim = new Simulator(latch(), registry);
    sim.action('S', Drive.STRONG_0);
    sim.action('R', Drive.STRONG_1);
    sim.runFor(ns(10));
    sim.action('S', Drive.STRONG_1); // hold
    sim.runFor(ns(10));
    expect(levelChar(sim.pinLevel('U1', 'Y'))).toBe('1');

    const edited = latch((b) =>
      b.add('D1', 'io/led').add('G', 'io/gnd').connect('U1.Y', 'D1.A').connect('D1.K', 'G.Y'),
    );
    sim = new Simulator(edited, registry, { carry: sim.carryOver() });
    sim.runFor(ns(10));
    expect(levelChar(sim.pinLevel('U1', 'Y'))).toBe('1');
    expect(levelChar(sim.pinLevel('U2', 'Y'))).toBe('0');
    expect(sim.stateOf('D1')).toMatchObject({ light: Uint8Array.of(1) });
  });

  it('a clock keeps its phase across an edit, and a renamed switch its position', () => {
    const circuit = (sw: string) =>
      new NetlistBuilder()
        .add('X1', 'io/clock', { frequency: 1e6 })
        .add(sw, 'io/switch')
        .add('U1', 'prim/and', { delay: 0 })
        .connect('X1.Y', 'U1.A')
        .connect(`${sw}.Y`, 'U1.B')
        .build();
    let sim = new Simulator(circuit('SW1'), registry);
    const edges: Time[] = [];
    const listen = (s: Simulator) =>
      s.onNetChange((t, net) => {
        if (s.netId(net) === 'X1.Y') edges.push(t);
      });
    listen(sim);
    sim.action('SW1', { type: 'toggle' });
    sim.runUntil(ns(1300));
    sim = new Simulator(circuit('SW9'), registry, {
      carry: sim.carryOver({ renames: new Map([['SW1', 'SW9']]) }),
    });
    listen(sim);
    sim.runUntil(ns(3700));
    expect(edges).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ns(500 * i))); // X → 0, then edges
    expect(sim.stateOf('SW9')).toEqual({ on: true });
    expect(levelChar(sim.pinLevel('U1', 'Y'))).toBe('1');
  });
});
