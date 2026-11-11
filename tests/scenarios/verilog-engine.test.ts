/**
 * The engine on words (HDL-10) against the interpreter it replaced, on every module the tests and
 * the examples hold: the same seeded stimulus on both parts — inputs and inouts at 0, 1, `X` or
 * released, several at one instant (races) or one at a time, clocks among them — and at every
 * step the same pins, the same diagnostics, the same signals inside and the same memories.
 */
import { describe, expect, it } from 'vitest';
import { exampleDocument } from '../../src/app/example-files';
import {
  type AnyComponentDefinition,
  type HdlModule,
  hdlPinDirs,
  hdlPortPins,
  ns,
  SeededRandom,
} from '../../src/core';
import { Bench } from '../../src/core/testing';
import { hdlPart } from '../../src/library';
import { hdlReferencePart } from '../../src/library/hdl/reference-part';
import { sampleModules } from '../../src/library/hdl/sample-modules';

const EXAMPLES = [
  'verilog-address-decoder',
  'verilog-counter-traffic-light',
  'verilog-uart',
  'verilog-picorv32',
];

function exampleModules(): [string, HdlModule][] {
  return EXAMPLES.flatMap((id) =>
    exampleDocument(id).circuits.flatMap((c): [string, HdlModule][] =>
      c.verilog?.module ? [[`example:${id}/${c.id}`, c.verilog.module]] : [],
    ),
  );
}

const modules = [...sampleModules(), ...exampleModules()];

interface State {
  readonly mval?: readonly Uint32Array[];
  readonly munk?: readonly Uint32Array[];
}

/** What a part shows at a moment: its pins, what it reported, its signals and memories. */
function observe(bench: Bench, definition: AnyComponentDefinition) {
  const state = bench.sim.stateOf('DUT') as State;
  const signals = definition.signals;
  const inner = signals
    ? signals.list.map((s, i) =>
        Array.from({ length: s.width }, (_, b) => signals.level(state as never, i, b)).join(''),
      )
    : [];
  return {
    pins: bench.levels(),
    diagnostics: bench.diagnostics.map((d) => `${d.kind} ${d.message}`),
    inner,
    memories: (state.mval ?? []).map((words, m) => [[...words], [...state.munk![m]!]]),
  };
}

describe('the engine on words against the interpreter (differential)', () => {
  it('has modules to compare', () => {
    expect(modules.length).toBeGreaterThan(60);
  });

  it.each(modules)('%s', (name, module) => {
    const fast = hdlPart('hdl/m', 'M', module);
    const reference = hdlReferencePart('hdl/m', 'M', module);
    expect(fast.messages).toEqual(reference.messages);
    if (!fast.definition || !reference.definition) return;
    const a = new Bench(fast.definition);
    const b = new Bench(reference.definition);
    const dirs = hdlPinDirs(module);
    const pins = module.ports.flatMap((port) => hdlPortPins(port));
    const inputs = pins.filter((_, i) => dirs[i] === 'in' || dirs[i] === 'bidir');
    const random = new SeededRandom(name.length * 31 + 7);
    const r = (n: number) => random.nextUint32() % n;
    const steps = name.includes('picorv32') ? 400 : 160;
    a.settle();
    b.settle();
    expect(observe(a, fast.definition)).toEqual(observe(b, reference.definition));
    for (let step = 0; step < steps; step++) {
      // One pin, or several at one instant; mostly 0 and 1, now and then X or released.
      const count = r(3) === 0 ? 1 + r(Math.max(1, inputs.length)) : 1;
      const values: Record<string, 0 | 1 | 'X' | 'Z'> = {};
      for (let i = 0; i < count && inputs.length > 0; i++) {
        const pin = inputs[r(inputs.length)]!;
        const roll = r(40);
        values[pin] = roll === 0 ? 'X' : roll === 1 ? 'Z' : roll < 21 ? 0 : 1;
      }
      a.set(values);
      b.set(values);
      const dt = r(4) === 0 ? ns(1) : ns(40);
      a.run(dt);
      b.run(dt);
      const got = observe(a, fast.definition);
      const want = observe(b, reference.definition);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        expect({ step, values, ...got }).toEqual({ step, values, ...want });
      }
    }
  });
});
