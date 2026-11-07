/**
 * Waveforms of real chips (R13): a 74HC161 counting, recorded and dumped as VCD as the waveform
 * view exports it; a trigger on its count stopping the run. 74HC161 CP→Qn 22 ns typical
 * (Nexperia 74HC161, 4.5 V).
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_FILES, exampleDocument } from '../../src/app/example-files';
import { compileCircuit, Resolver } from '../../src/circuit';
import { ns, Recorder, type Simulator, Trigger, writeVcd } from '../../src/core';
import { buildScene, probeSpotAt } from '../../src/editor';
import { createDefaultRegistry } from '../../src/library';
import { set, simulate } from './support';

function counter(): { sim: Simulator; recorder: Recorder; clk: number; q: number[] } {
  const sim = simulate((b) => {
    b.add('U1', '74xx/74hc161').add('CLK', 'test/driver').add('CLR', 'test/driver');
    b.add('V', 'io/vcc');
    b.net('CP', 'CLK.Y', 'U1.CP').net('MR', 'CLR.Y', 'U1.MR');
    b.connect('V.Y', 'U1.PE', 'U1.CEP', 'U1.CET');
    for (let n = 0; n < 4; n++) b.net(`Q${n}`, `U1.Q${n}`);
    return b;
  });
  const recorder = new Recorder();
  const nets = new Map<number, number>();
  const clk = recorder.addChannel();
  nets.set(clk, sim.netIndex('CP'));
  const q = [0, 1, 2, 3].map((n) => {
    const channel = recorder.addChannel();
    nets.set(channel, sim.netIndex(`Q${n}`));
    return channel;
  });
  recorder.attach(sim, nets);
  set(sim, 'CLK', 0);
  set(sim, 'CLR', 0);
  sim.runFor(ns(100));
  set(sim, 'CLR', 1);
  sim.runFor(ns(100));
  return { sim, recorder, clk, q };
}

/** One clock period of 200 ns: rises now, falls 100 ns later. */
const pulse = (sim: Simulator) => {
  set(sim, 'CLK', 1);
  sim.runFor(ns(100));
  set(sim, 'CLK', 0);
  sim.runFor(ns(100));
};

describe('waveforms of a 74HC161', () => {
  it('dump the count 22 ns after each rising clock edge', () => {
    const { sim, recorder, clk, q } = counter();
    for (let i = 0; i < 3; i++) pulse(sim);
    const text = writeVcd(recorder, [
      { name: 'CP', channels: [clk] },
      { name: 'Q[0..3]', channels: q },
    ]);
    const body = text.split('$enddefinitions $end\n')[1]!;
    // Power-on: the counter's outputs X until reset clears them, CP→Q after the reset.
    expect(body.startsWith('#0\n$dumpvars\n0!\nbxxxx "\n$end\n')).toBe(true);
    for (const [rise, count] of [
      [200, '0001'],
      [400, '0010'],
      [600, '0011'],
    ] as const) {
      expect(body).toContain(`#${ns(rise)}\n1!\n`);
      expect(body).toContain(`#${ns(rise + 22)}\nb${count} "\n`);
    }
    expect(body.endsWith(`#${ns(800)}\n`)).toBe(true);
  });

  it('stop at a trigger on the count, the instant the outputs show it', () => {
    const { sim, recorder, q } = counter();
    const trigger = new Trigger(recorder, [{ kind: 'equal', channels: q, value: '3' }], () =>
      sim.requestBreak(),
    );
    trigger.attach(sim);
    set(sim, 'CLK', 1);
    let status = sim.runFor(ns(100));
    for (let i = 0; i < 4 && status !== 'break'; i++) {
      set(sim, 'CLK', 0);
      status = sim.runFor(ns(100));
      if (status === 'break') break;
      set(sim, 'CLK', 1);
      status = sim.runFor(ns(100));
    }
    expect(status).toBe('break');
    expect(trigger.fired).toBe(ns(600 + 22));
    expect(sim.now).toBe(ns(600 + 22));
  });
});

describe('probing the Data Bus example from the canvas', () => {
  it('probes a bus line by its bus, a bus entry by its member', () => {
    const registry = createDefaultRegistry();
    const scene = buildScene(exampleDocument('data-bus').circuits[0]!, registry);
    const line = scene.wires.find((w) => w.bus)!;
    const middle: [number, number] = [
      (line.from[0] + line.to[0]) / 2,
      (line.from[1] + line.to[1]) / 2,
    ];
    const spot = probeSpotAt(scene, registry, middle, 0.5);
    expect(spot).toMatchObject({ ref: 'D[0..7]' });
    expect(typeof spot === 'object' && spot.wires.length).toBe(
      scene.wires.filter((w) => w.bus).length,
    );
    const entry = scene.parts.find((p) => p.id === 'BE4')!;
    const bit = entry.pins.find((p) => !p.bus)!;
    expect(probeSpotAt(scene, registry, bit.at, 0.5)).toMatchObject({ ref: 'D3' });
  });
});

describe('the examples’ probes', () => {
  it('all resolve, and the examples that show waveforms have some', () => {
    const registry = createDefaultRegistry();
    const probed: string[] = [];
    for (const { id } of EXAMPLE_FILES) {
      const circuit = exampleDocument(id).circuits[0]!;
      const resolver = new Resolver(compileCircuit(circuit, registry), registry);
      for (const probe of circuit.probes) {
        expect(resolver.probe(probe), `${id}: ${JSON.stringify(probe)}`).toMatchObject({
          nets: expect.any(Array),
        });
      }
      if (circuit.probes.length > 0) probed.push(id);
    }
    expect(probed.sort()).toEqual(['clock-module', 'data-bus']);
  });
});
