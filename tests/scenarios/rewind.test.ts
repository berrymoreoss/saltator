/**
 * Rewinding a simulation (R14b) restores a snapshot taken earlier and re-runs it with the same
 * actions. The invariant: whatever the circuit and the actions, the state reached that way at an
 * instant is exactly the one a straight run had there — levels, drives, contention, the event
 * queue, every part's state, the diagnostics — and the run goes on from it exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_FILES, exampleDocument } from '../../src/app/example-files';
import { compileCircuit } from '../../src/circuit';
import {
  Drive,
  freezeState,
  ms,
  type Netlist,
  NetlistBuilder,
  pinsOf,
  resolveProps,
  Simulator,
  type SimulatorSnapshot,
  type Time,
  thawState,
  us,
} from '../../src/core';
import { rng, scenarioRegistry } from './support';

const registry = scenarioRegistry();

/** An action delivered at a time (after the run reached it). */
interface Act {
  readonly time: Time;
  readonly component: string;
  readonly action: unknown;
}

/** What a user can do to the circuit's parts: switches, buttons, a manual clock, RAM pokes. */
function interactions(netlist: Netlist): { component: string; actions: unknown[] }[] {
  const out: { component: string; actions: unknown[] }[] = [];
  for (const c of netlist.components) {
    const definition = registry.get(c.type);
    if (!definition) continue;
    const props = resolveProps(definition, c.props ?? {});
    const actions: unknown[] = [];
    if (c.type === 'io/switch') actions.push({ type: 'toggle' });
    if (c.type === 'io/button') actions.push({ type: 'press' }, { type: 'release' });
    if (c.type === 'io/dip-switch') {
      for (let index = 0; index < Number(props.count); index++) {
        actions.push({ type: 'toggle', index });
      }
    }
    if (c.type === 'io/clock' && props.mode === 'manual') actions.push({ type: 'step' });
    if (c.type === 'test/driver') actions.push(Drive.STRONG_0, Drive.STRONG_1, Drive.Z);
    if (definition.memory?.volatile) {
      for (const address of [0, 1, 5, 0x1f]) {
        actions.push({ type: 'poke', address, data: [0x3c + address] });
      }
    }
    if (actions.length > 0) out.push({ component: c.id, actions });
  }
  return out;
}

/** Everything observable about a simulation now, copied. */
function fingerprint(sim: Simulator, ids: readonly string[]) {
  return {
    now: sim.now,
    halted: sim.halted,
    next: sim.nextEventTime,
    stats: { ...sim.stats },
    levels: Array.from(sim.levels),
    drives: Array.from(sim.drives),
    contended: Array.from(sim.contended),
    diagnostics: sim.diagnostics.entries.map((d) => ({ ...d })),
    dropped: sim.diagnostics.dropped,
    states: ids.map((id) => thawState(freezeState(sim.stateOf(id)), undefined)),
  };
}

/** Runs to `t`, delivering the acts due by then that `from` (an index into `acts`) hasn't. */
function runTo(sim: Simulator, acts: readonly Act[], from: number, t: Time): number {
  let i = from;
  while (i < acts.length && acts[i]!.time <= t) {
    const time = acts[i]!.time;
    sim.runUntil(time);
    // Every act at this instant, without a run between them (as a user's clicks in one frame).
    while (i < acts.length && acts[i]!.time === time) {
      sim.action(acts[i]!.component, acts[i]!.action);
      i++;
    }
  }
  sim.runUntil(t);
  return i;
}

interface Checkpoint {
  readonly snapshot: SimulatorSnapshot;
  /** Acts delivered before it was taken. */
  readonly acts: number;
}

function checkRewinds(netlist: Netlist, seed: number, end: Time): number {
  const random = rng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const at = () => Math.floor(random() * end);
  const parts = interactions(netlist);
  const acts: Act[] = parts.length
    ? Array.from({ length: 10 }, () => {
        const part = pick(parts);
        return { time: at(), component: part.component, action: pick(part.actions) };
      })
    : [];
  // Two at one instant, without a run between them.
  if (acts.length > 1)
    acts.push({ ...acts[1]!, action: acts[0]!.action, component: acts[0]!.component });
  acts.sort((a, b) => a.time - b.time);
  const ids = netlist.components.map((c) => c.id);

  // The straight run: checkpoints (each sharing pages with the one before) and the state at
  // every target, as it ended (every act at it delivered).
  const snapshotsAt = [0, ...Array.from({ length: 5 }, at)].sort((a, b) => a - b);
  const targets = [
    ...Array.from({ length: 8 }, at),
    ...acts.slice(0, 3).map((a) => a.time),
    ...snapshotsAt.slice(1, 3),
    end,
  ].sort((a, b) => a - b);
  const sim = new Simulator(netlist, registry);
  const checkpoints: Checkpoint[] = [{ snapshot: sim.snapshot(), acts: 0 }];
  const expected = new Map<Time, ReturnType<typeof fingerprint>>();
  let done = 0;
  for (const t of [...new Set([...snapshotsAt, ...targets])].sort((a, b) => a - b)) {
    done = runTo(sim, acts, done, t);
    if (snapshotsAt.includes(t) && t > 0) {
      checkpoints.push({ snapshot: sim.snapshot(checkpoints.at(-1)!.snapshot), acts: done });
    }
    if (targets.includes(t)) expected.set(t, fingerprint(sim, ids));
  }

  // Rewind to each target: the last checkpoint at or before it, replayed in a replica, the
  // result put into the simulator (which stands at the end, or wherever the last rewind left it).
  const replica = sim.replica();
  let compared = 0;
  for (const target of targets) {
    const from = checkpoints.findLast((c) => c.snapshot.time <= target)!;
    replica.restore(from.snapshot);
    runTo(replica, acts, from.acts, target);
    sim.restore(replica.snapshot());
    expect(fingerprint(sim, ids), `seed ${seed}: rewound to ${target}`).toEqual(
      expected.get(target),
    );
    compared++;
  }
  // From a rewound instant the run goes on exactly as before, in the simulator itself.
  const middle = targets[Math.floor(targets.length / 2)]!;
  const from = checkpoints.findLast((c) => c.snapshot.time <= middle)!;
  sim.restore(from.snapshot);
  const resumed = runTo(sim, acts, from.acts, middle);
  runTo(sim, acts, resumed, end);
  expect(fingerprint(sim, ids), `seed ${seed}: replayed to the end`).toEqual(expected.get(end));
  return compared;
}

describe('a rewound simulation is the straight run', () => {
  for (const example of EXAMPLE_FILES) {
    it(`in the example ${example.id}, with seeded actions`, () => {
      const compiled = compileCircuit(exampleDocument(example.id).circuits[0]!, registry);
      let compared = 0;
      for (let seed = 1; seed <= 3; seed++) {
        compared += checkRewinds(compiled.netlist, seed * 7919 + example.id.length, ms(2));
      }
      expect(compared).toBeGreaterThan(30);
    });
  }
});

describe('every part survives a rewind', () => {
  it('each registered part, its inputs on clocks and drivers, with seeded actions', () => {
    let compared = 0;
    for (const definition of registry.list()) {
      const random = rng(definition.type.length * 31 + compared);
      const b = new NetlistBuilder();
      const outputs: string[] = [];
      for (let i = 0; i < 2; i++) {
        b.add(`X${i}`, 'io/clock', { frequency: 20e6 + Math.floor(random() * 30e6), duty: 50 });
        b.add(`T${i}`, 'test/driver');
        outputs.push(`X${i}.Y`, `T${i}.Y`);
      }
      b.add('U1', definition.type);
      for (const pin of pinsOf(definition, resolveProps(definition, {}))) {
        if (pin.dir !== 'in' && pin.dir !== 'bidir') continue;
        b.connect(outputs[Math.floor(random() * outputs.length)]!, `U1.${pin.name}`);
      }
      compared += checkRewinds(b.build(), compared + 1, us(2));
    }
    expect(compared).toBeGreaterThan(registry.list().length * 10);
  });
});
