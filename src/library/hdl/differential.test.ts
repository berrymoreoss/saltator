import { describe, expect, it } from 'vitest';
import { type HdlModule, hdlPortPins, levelChar, us } from '../../core';
import { Bench } from '../../core/testing';
import { DIFFERENTIAL } from './differential';
import { hdlPart } from './module-part';

/** A design checked against Yosys (scripts/hdl-differential.ts writes them). */
interface DifferentialCase {
  readonly module: HdlModule;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly steps: readonly (readonly string[])[];
  readonly expected: readonly (readonly string[])[];
}

/**
 * The interpreter against Yosys's own `sim` on the same netlists (HDL-9): seeded random
 * expressions over every word cell, sequential designs and the examples, driven by the same
 * vectors. Every output bit Yosys knows (0 or 1) must come out the same — an `X` there is a
 * pessimism too many; where Yosys has `x` (a zero divisor, a register before its reset) the
 * interpreter may know more.
 */
describe('the interpreter against Yosys sim (differential)', () => {
  it.each(Object.keys(DIFFERENTIAL))('%s', (name) => {
    const design = JSON.parse(DIFFERENTIAL[name]!) as DifferentialCase;
    const { definition, messages } = hdlPart(
      `hdl/${name.replaceAll('_', '-')}`,
      name,
      design.module,
    );
    expect(definition, messages.map((m) => m.message).join('; ')).toBeDefined();
    const bench = new Bench(definition!);
    const pinsOf = (port: string) => hdlPortPins(design.module.ports.find((p) => p.name === port)!);
    const inputPins = design.inputs.map(pinsOf);
    const outputPins = design.outputs.map(pinsOf);
    const mismatches: string[] = [];
    let compared = 0;
    for (const [step, values] of design.steps.entries()) {
      const set: Record<string, 0 | 1> = {};
      for (const [i, value] of values.entries()) {
        // Values are most significant bit first; pins least significant first.
        for (const [b, pin] of inputPins[i]!.entries()) {
          set[pin] = value[value.length - 1 - b] === '1' ? 1 : 0;
        }
      }
      bench.set(set);
      bench.run(us(1));
      for (const [o, want] of design.expected[step]!.entries()) {
        const got = outputPins[o]!.map((pin) => levelChar(bench.get(pin)))
          .reverse()
          .join('');
        let same = true;
        for (let b = 0; b < want.length; b++) {
          if (want[b] === 'x') continue;
          compared++;
          if (got[b] !== want[b]) same = false;
        }
        if (!same) mismatches.push(`step ${step} ${design.outputs[o]}: Yosys ${want}, here ${got}`);
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(compared).toBeGreaterThan(0);
    // The designs are free of races and loops: nothing to report.
    bench.expectNoDiagnostics();
  });
});
