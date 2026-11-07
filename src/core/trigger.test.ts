import { describe, expect, it } from 'vitest';
import { defineComponent } from './component';
import { and, Drive, Level, not, strong } from './logic';
import { NetlistBuilder } from './netlist';
import { Recorder } from './recorder';
import { Registry } from './registry';
import { Simulator } from './simulator';
import { ns } from './time';
import {
  conditionProblems,
  parseHexPattern,
  Trigger,
  type TriggerCondition,
  type TriggerTerm,
} from './trigger';

/** Toggles every 10 ns from 0 at t = 0. */
const clock = defineComponent<Record<string, never>, { level: Level }>({
  type: 'test/clock',
  name: 'CLK',
  title: 'Clock',
  pins: [{ name: 'Y', dir: 'out' }],
  create: () => ({
    createState: () => ({ level: Level.L0 }),
    init(ctx) {
      ctx.drive(0, Drive.STRONG_0, 0);
      ctx.wakeAfter(ns(10));
    },
    wake(ctx) {
      ctx.state.level = not(ctx.state.level);
      ctx.drive(0, strong(ctx.state.level), 0);
      ctx.wakeAfter(ns(10));
    },
  }),
});

/** Driven from outside, at once: `sim.action(id, drive)`. */
const source = defineComponent({
  type: 'test/source',
  name: 'S',
  title: 'Source',
  pins: [{ name: 'Y', dir: 'tristate' }],
  create: () => ({
    action(ctx, payload) {
      ctx.drive(0, payload as Drive, 0);
    },
  }),
});

const inverter = defineComponent({
  type: 'test/inv',
  name: 'INV',
  title: 'Inverter',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'Y', dir: 'out' },
  ],
  create: () => ({
    evaluate(ctx) {
      ctx.drive(1, strong(not(ctx.read(0))), 0);
    },
  }),
});

const andGate = defineComponent({
  type: 'test/and',
  name: 'AND',
  title: 'And',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'B', dir: 'in' },
    { name: 'Y', dir: 'out' },
  ],
  create: () => ({
    evaluate(ctx) {
      ctx.drive(2, strong(and(ctx.read(0), ctx.read(1))), 0);
    },
  }),
});

const registry = new Registry([clock, source, inverter, andGate]);

/**
 * CLK; a 4-bit bus B0…B3 from sources; GLITCH = B0 AND NOT B0 with zero delays (1 for one delta
 * cycle whenever B0 rises). Channels: CLK, B0…B3, GLITCH, all recorded from power-on.
 */
function setup() {
  const b = new NetlistBuilder().add('C', 'test/clock').net('CLK', 'C.Y');
  for (let i = 0; i < 4; i++) b.add(`S${i}`, 'test/source').net(`B${i}`, `S${i}.Y`);
  b.add('I', 'test/inv').add('G', 'test/and').connect('S0.Y', 'I.A', 'G.A').connect('I.Y', 'G.B');
  b.net('GLITCH', 'G.Y');
  const netlist = b.build();
  const sim = new Simulator(netlist, registry);
  const recorder = new Recorder();
  const nets = new Map<number, number>();
  const channel = (net: string) => {
    const id = recorder.addChannel();
    nets.set(id, sim.netIndex(net));
    return id;
  };
  const clk = channel('CLK');
  const bus = [0, 1, 2, 3].map((i) => channel(`B${i}`));
  const glitch = channel('GLITCH');
  recorder.attach(sim, nets);
  const setBus = (value: number) => {
    bus.forEach((_, i) => {
      sim.action(`S${i}`, (value >> i) & 1 ? Drive.STRONG_1 : Drive.STRONG_0);
    });
  };
  /** Arms a trigger that breaks the run where it fires. */
  const arm = (condition: TriggerCondition, on = sim) => {
    const fired: number[] = [];
    const trigger = new Trigger(recorder, condition, (time) => {
      fired.push(time);
      on.requestBreak();
    });
    trigger.attach(on);
    return { trigger, fired };
  };
  return { netlist, sim, recorder, clk, bus, glitch, setBus, arm };
}

describe('parseHexPattern', () => {
  it('reads hex digits bit 0 first, X digits as don’t care', () => {
    expect([...(parseHexPattern('3F', 8) as Int8Array)]).toEqual([1, 1, 1, 1, 1, 1, 0, 0]);
    expect([...(parseHexPattern('x5', 8) as Int8Array)]).toEqual([1, 0, 1, 0, -1, -1, -1, -1]);
    expect([...(parseHexPattern('0x1', 6) as Int8Array)]).toEqual([1, 0, 0, 0, 0, 0]);
    expect([...(parseHexPattern('00A', 4) as Int8Array)]).toEqual([0, 1, 0, 1]);
    // Digits not written are 0, as in a number: `X` on six bits leaves bits 4 and 5 at 0.
    expect([...(parseHexPattern('X', 6) as Int8Array)]).toEqual([-1, -1, -1, -1, 0, 0]);
  });

  it('refuses what is not hex, and bits the signals don’t have', () => {
    expect(parseHexPattern('1 2', 8)).toBe('"1 2" is not a hex value (digits, X for any)');
    expect(parseHexPattern('', 8)).toBe('"" is not a hex value (digits, X for any)');
    expect(parseHexPattern('1FF', 8)).toBe("1FF doesn't fit in 8 bits");
    expect(parseHexPattern('2', 1)).toBe("2 doesn't fit in 1 bit");
  });
});

describe('conditionProblems', () => {
  it('needs a term, one edge at most and readable values', () => {
    const edge: TriggerTerm = { kind: 'rise', channel: 0 };
    expect(conditionProblems([])).toEqual(['the trigger has no condition']);
    expect(conditionProblems([edge, { kind: 'fall', channel: 1 }])).toEqual([
      'only one term may be an edge',
    ]);
    expect(conditionProblems([{ kind: 'equal', channels: [], value: '0' }])).toEqual([
      'a value term needs at least one signal',
    ]);
    expect(conditionProblems([{ kind: 'equal', channels: [1, 2], value: '7' }])).toEqual([
      "7 doesn't fit in 2 bits",
    ]);
    expect(conditionProblems([edge, { kind: 'level', channel: 1, level: Level.L1 }])).toEqual([]);
    expect(() => new Trigger(new Recorder(), [], () => {})).toThrow('the trigger has no condition');
  });
});

describe('Trigger', () => {
  it('fires once at a strict rising edge, where its callback can break the run', () => {
    const { sim, clk, arm } = setup();
    const { trigger, fired } = arm([{ kind: 'rise', channel: clk }]);
    expect(trigger.armed).toBe(true);
    expect(sim.runUntil(ns(100))).toBe('break');
    expect(sim.now).toBe(ns(10));
    expect(trigger.fired).toBe(ns(10));
    expect(trigger.armed).toBe(false);
    expect(sim.runUntil(ns(100))).toBe('reached');
    expect(fired).toEqual([ns(10)]);
  });

  it('fires at falling edges and either edge; X → 0 at power-on is none', () => {
    const fall = setup();
    fall.arm([{ kind: 'fall', channel: fall.clk }]);
    fall.sim.runUntil(ns(100));
    expect(fall.sim.now).toBe(ns(20));

    const edge = setup();
    const { fired } = edge.arm([{ kind: 'edge', channel: edge.clk }]);
    edge.sim.runUntil(ns(100));
    expect(fired).toEqual([ns(10)]);
  });

  it('takes no edge from a floating or unknown level', () => {
    const { sim, bus, arm } = setup();
    const { fired } = arm([{ kind: 'rise', channel: bus[0]! }]);
    sim.runUntil(ns(5));
    sim.action('S0', Drive.STRONG_1); // Z → 1
    sim.runUntil(ns(15));
    sim.action('S0', Drive.STRONG_0);
    sim.runUntil(ns(25));
    sim.action('S0', Drive.STRONG_1); // 0 → 1
    sim.runUntil(ns(100));
    expect(fired).toEqual([ns(25)]);
  });

  it('ignores the bits of X digits, whatever they are', () => {
    const { sim, clk, bus, arm } = setup(); // the bus floats
    const { fired } = arm([
      { kind: 'rise', channel: clk },
      { kind: 'equal', channels: bus, value: 'X' },
    ]);
    sim.runUntil(ns(100));
    expect(fired).toEqual([ns(10)]);
  });

  it('fires at the edge only while the rest of the pattern holds', () => {
    const { sim, clk, bus, setBus, arm } = setup();
    setBus(3);
    const { fired } = arm([
      { kind: 'rise', channel: clk },
      { kind: 'equal', channels: bus, value: '5' },
    ]);
    sim.runUntil(ns(25)); // edge at 10 ns while the bus reads 3
    setBus(5);
    sim.runUntil(ns(100));
    expect(fired).toEqual([ns(30)]);
  });

  it('without an edge, fires when the pattern becomes true', () => {
    const { sim, clk, bus, setBus, arm } = setup();
    const { fired } = arm([
      { kind: 'equal', channels: bus, value: 'X5' },
      { kind: 'level', channel: clk, level: Level.L1 },
    ]);
    sim.runUntil(ns(5));
    setBus(5); // the clock is low
    sim.runUntil(ns(100));
    expect(fired).toEqual([ns(10)]);
  });

  it('waits for a pattern already true when armed to become false first', () => {
    const { sim, bus, setBus, arm } = setup();
    setBus(5);
    sim.runUntil(ns(5));
    const { fired } = arm([{ kind: 'equal', channels: bus, value: '5' }]);
    sim.runUntil(ns(15));
    setBus(6);
    sim.runUntil(ns(25));
    expect(fired).toEqual([]);
    setBus(5);
    sim.runUntil(ns(100));
    expect(fired).toEqual([ns(25)]);
  });

  it('reads unknown and floating bits as no match: != is true while they are', () => {
    const { sim, bus, setBus, arm } = setup();
    // At power-on the bus floats: "≠ 0" holds from the start, so it waits.
    const { fired } = arm([{ kind: 'notEqual', channels: bus, value: '0' }]);
    sim.runUntil(ns(5));
    setBus(0);
    sim.runUntil(ns(15));
    setBus(1);
    sim.runUntil(ns(100));
    expect(fired).toEqual([ns(15)]);

    const z = setup();
    const floating = z.arm([{ kind: 'level', channel: z.bus[2]!, level: Level.Z }]);
    z.sim.runUntil(ns(100));
    expect(floating.fired).toEqual([]); // floating from the start: never became true
  });

  it('never fires on a glitch inside one instant', () => {
    const terms = (channel: number): TriggerTerm[] => [
      { kind: 'rise', channel },
      { kind: 'level', channel, level: Level.L1 },
    ];
    for (const which of [0, 1]) {
      const { sim, glitch, setBus, arm } = setup();
      const { fired } = arm([terms(glitch)[which]!]);
      sim.runUntil(ns(5));
      setBus(0);
      sim.runUntil(ns(15));
      setBus(1); // B0 rises: GLITCH is 1 for one delta cycle
      sim.runUntil(ns(100));
      expect(fired).toEqual([]);
    }
  });

  it('goes on watching in a carried-over simulator; disarm stops it', () => {
    const { netlist, sim, recorder, clk, arm } = setup();
    const { trigger, fired } = arm([{ kind: 'rise', channel: clk }]);
    sim.runUntil(ns(5));
    const next = new Simulator(netlist, registry, { carry: sim.carryOver() });
    recorder.attach(next, new Map([[clk, next.netIndex('CLK')]]));
    trigger.attach(next);
    next.runUntil(ns(100));
    expect(fired).toEqual([ns(10)]);

    const other = setup();
    const disarmed = other.arm([{ kind: 'rise', channel: other.clk }]);
    disarmed.trigger.disarm();
    other.sim.runUntil(ns(100));
    expect(disarmed.fired).toEqual([]);
    disarmed.trigger.attach(other.sim); // armed again
    other.sim.runUntil(ns(200));
    expect(disarmed.fired).toEqual([ns(110)]);
    disarmed.trigger.attach(other.sim); // fired: single shot
    expect(disarmed.trigger.armed).toBe(false);
  });
});
