import { describe, expect, it } from 'vitest';
import { runSingleStepCase, type SingleStepCase, type SingleStepState } from './single-step';
import { W65C02S_OPCODES } from './w65c02s-opcodes';
import { WDC65C02_SAMPLE } from './w65c02s-sst-sample';

function parseState(registers: string, ram: string): SingleStepState {
  const [pc = 0, s = 0, a = 0, x = 0, y = 0, p = 0] = registers
    .split(' ')
    .map((field) => Number.parseInt(field, 16));
  return {
    pc,
    s,
    a,
    x,
    y,
    p,
    ram: ram.split(' ').map((pair) => {
      const [address = '', value = ''] = pair.split(':');
      return [Number.parseInt(address, 16), Number.parseInt(value, 16)] as const;
    }),
  };
}

/** A sample line back into a case (`scripts/sample-65c02.ts` writes them). */
function parseCase(line: string, index: number): SingleStepCase {
  const [initial = '', initialRam = '', final = '', finalRam = '', cycles = ''] = line.split(' | ');
  return {
    name: `sample ${index}`,
    initial: parseState(initial, initialRam),
    final: parseState(final, finalRam),
    cycles: cycles.split(' ').map((cycle) => {
      const kind = cycle[4] === 'w' ? 'write' : 'read';
      return [Number.parseInt(cycle.slice(0, 4), 16), Number.parseInt(cycle.slice(5), 16), kind];
    }),
  };
}

const cases = WDC65C02_SAMPLE.map(parseCase);
const byOpcode = new Map<number, SingleStepCase[]>();
for (const test of cases) {
  const opcode = test.initial.ram.find(([address]) => address === test.initial.pc)?.[1] ?? -1;
  byOpcode.set(opcode, [...(byOpcode.get(opcode) ?? []), test]);
}

describe('W65C02S core on SingleStepTests (sample)', () => {
  it('has a sample of every opcode but WAI and STP', () => {
    expect(byOpcode.size).toBe(254);
    expect(byOpcode.has(0xcb)).toBe(false);
    expect(byOpcode.has(0xdb)).toBe(false);
  });

  it.each([...byOpcode.keys()].sort((a, b) => a - b))(
    'opcode %d: every cycle and the final state',
    (opcode) => {
      const failures = (byOpcode.get(opcode) ?? []).flatMap((test) =>
        runSingleStepCase(test).map((problem) => `${test.name}: ${problem}`),
      );
      expect(failures).toEqual([]);
    },
  );

  it("gives the opcode table's cycles as the fewest a case takes (5C: Table 7-1's 8)", () => {
    for (const [opcode, tests] of byOpcode) {
      if (opcode === 0x5c) continue;
      const fewest = Math.min(...tests.map((test) => test.cycles.length));
      expect([opcode, W65C02S_OPCODES[opcode]?.cycles]).toEqual([opcode, fewest]);
    }
  });
});
