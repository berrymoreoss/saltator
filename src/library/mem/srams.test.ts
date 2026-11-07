import { describe, expect, it } from 'vitest';
import {
  type AnyComponentDefinition,
  KernelDiagnosticKind,
  NetlistBuilder,
  ns,
  pinsOf,
  Registry,
  Simulator,
  type Time,
  TimingViolation,
  timingOf,
} from '../../core';
import { Bench } from '../../core/testing';
import { SRAM_6116, SRAM_MODES, sramDefinition, srams } from './srams';
import { address, changes, dataBus, dataByte, dataText } from './test-helpers';
import type { RamState } from './write';

const [sram6116] = srams as [AnyComponentDefinition];

const PINOUT_6116 = [
  ...['A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0', 'IO0', 'IO1', 'IO2', 'GND'],
  ...['IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'CS', 'A10', 'OE', 'WE', 'A9', 'A8', 'VCC'],
];

/** A selected 6116 (-25 unless `speed`), outputs off, WE̅ HIGH, at address 0, settled. */
function idle(props: Record<string, unknown> = {}): Bench {
  const bench = new Bench(sram6116, { powerOn: 'zeros', ...props });
  bench.set({ CS: 0, OE: 1, WE: 1, ...address(0, 11) });
  bench.settle();
  return bench;
}

/**
 * A WE̅-controlled write of `value` at `at`: the address, then the data, WE̅ LOW for `pulse`,
 * the data held `hold` after WE̅ rises; each step `gap` apart.
 */
function write(
  b: Bench,
  at: number,
  value: number,
  { pulse = ns(30), gap = ns(20), hold = ns(10) }: { pulse?: Time; gap?: Time; hold?: Time } = {},
): Bench {
  b.set(address(at, 11)).run(gap);
  b.set(dataBus(value)).run(gap);
  b.set({ WE: 0 }).run(pulse);
  b.set({ WE: 1 }).run(hold);
  b.set(dataBus('Z')).run(gap);
  return b;
}

/** Reads the byte at `at` (OE̅ LOW), settled, and turns the outputs off again. */
function readAt(b: Bench, at: number): string {
  b.set({ ...address(at, 11), OE: 0 }).settle();
  const text = dataText(b);
  b.set({ OE: 1 }).settle();
  return text;
}

const hex = (value: number) => value.toString(2).padStart(8, '0');

const violations = (b: Bench) =>
  b.diagnostics
    .filter((d) => d.kind !== KernelDiagnosticKind.FLOATING_INPUT)
    .map((d) => [d.kind, d.pin, d.message]);

describe('6116', () => {
  it('has its data sheet pinout and truth table', () => {
    const pins = pinsOf(sram6116, {});
    expect(pins.map((p) => p.name)).toEqual(PINOUT_6116);
    expect(pins.map((p) => p.number)).toEqual(pins.map((_, i) => i + 1));
    expect(pins.find((p) => p.name === 'IO7')?.label).toBe('I/O7');
    for (const control of ['CS', 'OE', 'WE']) {
      expect(pins.find((p) => p.name === control)?.activeLow).toBe(true);
    }
    expect(sram6116.type).toBe('mem/6116');
    expect(sram6116.functionTable).toBe(SRAM_MODES);
    expect(sram6116.memory).toMatchObject({ words: 2048, width: 8, volatile: true });
  });

  it('comes in the commercial speed grades, 25 ns by default, each with its own limits', () => {
    const speed = sram6116.props!.find((p) => p.key === 'speed')!;
    expect(speed.default).toBe('25');
    expect(speed.options!.map((o) => o.value)).toEqual(['15', '20', '25']);
    const limits = (grade: string) => {
      const { max, min } = timingOf(sram6116, { speed: grade, powerOn: 'x' })!;
      return [max!.tAA, max!.tOE, max!.tWHZ, min!.tOLZ, min!.tWP, min!.tDW].map((t) => t! / 1000);
    };
    expect(limits('15')).toEqual([15, 10, 7, 0, 12, 12]);
    expect(limits('20')).toEqual([19, 10, 8, 0, 12, 12]);
    expect(limits('25')).toEqual([25, 13, 16, 5, 15, 13]);
  });

  it('writes and reads back, WE̅-controlled', () => {
    const b = idle();
    write(b, 5, 0xa5);
    write(b, 6, 0x3c);
    expect(readAt(b, 5)).toBe(hex(0xa5));
    expect(readAt(b, 6)).toBe(hex(0x3c));
    expect(readAt(b, 7)).toBe(hex(0));
    expect(violations(b)).toEqual([]);
  });

  it('writes CS̅-controlled: WE̅ LOW first, the write ends when CS̅ rises', () => {
    const b = idle();
    b.set({ CS: 1, ...address(9, 11) }).settle();
    b.set({ WE: 0, ...dataBus(0x42) }).run(ns(20));
    b.set({ CS: 0 }).run(ns(20));
    b.set({ CS: 1 }).run(ns(10));
    b.set({ WE: 1, ...dataBus('Z'), CS: 0 }).settle();
    expect(readAt(b, 9)).toBe(hex(0x42));
    expect(violations(b)).toEqual([]);
  });

  it('truth table: standby and output disable float, a write keeps the outputs off', () => {
    const b = idle();
    write(b, 0, 0x81);
    b.set({ OE: 0 }).settle();
    expect(dataByte(b)).toBe(0x81);
    b.set({ CS: 1 }).settle();
    expect(dataText(b)).toBe('ZZZZZZZZ');
    b.set({ CS: 0, OE: 1 }).settle();
    expect(dataText(b)).toBe('ZZZZZZZZ');
    b.set({ CS: 1, WE: 0 }).settle();
    b.set({ CS: 0, OE: 0 }).settle(); // CS̅ falling after WE̅: the outputs stay off (note 5)
    expect(dataText(b)).toBe('ZZZZZZZZ');
  });
});

describe('6116 reads (-25)', () => {
  /** Reading: 0x81 at 0, 0x7E at 1, OE̅ LOW, settled. */
  const reading = () => {
    const b = idle();
    write(b, 0, 0x81);
    write(b, 1, 0x7e);
    b.set({ ...address(0, 11), OE: 0 }).settle();
    return b;
  };

  it('address to output: the old data for tOH = 5 ns, then X, the data tAA = 25 ns after', () => {
    expect(changes(reading(), address(1, 11), 'IO0')).toEqual([
      [5, 'X'],
      [25, '0'],
    ]);
  });

  it('CS̅ to output: floating until tCLZ = 5 ns, X, the data tACS = 25 ns after', () => {
    const b = reading();
    b.set({ CS: 1 }).settle();
    expect(changes(b, { CS: 0 }, 'IO0')).toEqual([
      [5, 'X'],
      [25, '1'],
    ]);
  });

  it('OE̅ to output: floating until tOLZ = 5 ns, X, the data tOE = 13 ns after', () => {
    const b = reading();
    b.set({ OE: 1 }).settle();
    expect(changes(b, { OE: 0 }, 'IO0')).toEqual([
      [5, 'X'],
      [13, '1'],
    ]);
  });

  it('released tCHZ = 12 ns after CS̅, tOHZ = 10 ns after OE̅, tWHZ = 16 ns after WE̅', () => {
    expect(changes(reading(), { CS: 1 }, 'IO0')).toEqual([[12, 'Z']]);
    expect(changes(reading(), { OE: 1 }, 'IO0')).toEqual([[10, 'Z']]);
    expect(changes(reading(), { WE: 0 }, 'IO0')).toEqual([[16, 'Z']]);
  });

  it('after a write with OE̅ LOW, the outputs turn on at tOW = 0 and read the cell tAA later', () => {
    const b = reading();
    b.set({ WE: 0 }).run(ns(20));
    b.set(dataBus(0x00)).run(ns(20));
    // The bench still drives 0x00: X while the outputs turn on, then they agree.
    expect(changes(b, { WE: 1 }, 'IO0')).toEqual([
      [0, 'X'],
      [25, '0'],
    ]);
    b.set(dataBus('Z')).settle();
    expect(dataByte(b)).toBe(0x00);
  });

  it('the 15 ns grade is faster', () => {
    const b = new Bench(sram6116, { speed: '15', powerOn: 'zeros' });
    b.set({ CS: 0, OE: 1, WE: 1, ...address(0, 11) }).settle();
    write(b, 1, 0xff);
    b.set({ OE: 0, ...address(0, 11) }).settle();
    expect(changes(b, address(1, 11), 'IO0')).toEqual([
      [5, 'X'],
      [15, '1'],
    ]);
  });
});

describe('6116 write requirements (-25)', () => {
  it('tWP = 15 ns: a 15 ns pulse writes, a 14 ns one leaves the cell X', () => {
    const b = idle();
    write(b, 3, 0x55, { pulse: ns(15) });
    expect(readAt(b, 3)).toBe(hex(0x55));
    expect(violations(b)).toEqual([]);
    write(b, 4, 0x55, { pulse: ns(14) });
    expect(readAt(b, 4)).toBe('XXXXXXXX');
    expect(violations(b)).toEqual([
      [TimingViolation.PULSE_WIDTH, 'WE', 'the write lasted only 14 ns (tWP ≥ 15 ns)'],
    ]);
  });

  it('tDW = 13 ns: data 13 ns before the end is stored, a bit 12 ns before is X', () => {
    const b = idle();
    b.set(address(2, 11)).run(ns(20));
    b.set({ WE: 0 }).run(ns(20));
    b.set(dataBus(0x0f)).run(ns(13));
    b.set({ WE: 1 }).run(ns(10));
    expect(readAt(b, 2)).toBe(hex(0x0f));
    expect(violations(b)).toEqual([]);

    b.set({ WE: 0 }).run(ns(20));
    b.set(dataBus(0x0f)).run(ns(10));
    b.set({ IO7: 1 }).run(ns(12));
    b.set({ WE: 1 }).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(readAt(b, 2)).toBe('X0001111');
    expect(violations(b)).toEqual([
      [TimingViolation.SETUP, 'IO7', 'I/O7 changed 12 ns before the write ended (tDW ≥ 13 ns)'],
    ]);
  });

  it('with OE̅ LOW the data counts from the outputs turning off (note 7: tWP ≥ tWHZ + tDW)', () => {
    const b = idle();
    b.set({ OE: 0, ...address(1, 11) }).settle();
    // The outputs keep driving the cell (0x00) until tWHZ = 16 ns after WE̅ falls: the bits of
    // 0x99 that differ fight until then (note 4), the others are settled from the start.
    b.set({ WE: 0, ...dataBus(0x99) }).run(ns(16 + 12));
    b.set({ WE: 1 }).run(ns(10));
    b.set(dataBus('Z')).settle();
    expect(dataText(b)).toBe('X00XX00X');
    const setup = violations(b).filter((v) => v[0] === TimingViolation.SETUP);
    expect(setup.map((v) => v[1])).toEqual(['IO0', 'IO3', 'IO4', 'IO7']);
    expect(violations(b).filter((v) => v[0] === KernelDiagnosticKind.CONTENTION)).toHaveLength(4);
    b.set({ WE: 0, ...dataBus(0x99) }).run(ns(16 + 13));
    b.set({ WE: 1 }).run(ns(10));
    b.set(dataBus('Z')).settle();
    expect(dataByte(b)).toBe(0x99);
  });

  it('tCW = 17 ns: CS̅ LOW 17 ns writes, 16 ns leaves the cell X', () => {
    const b = idle();
    const csWrite = (at: number, low: Time) => {
      b.set({ CS: 1, ...address(at, 11) }).run(ns(20));
      b.set({ WE: 0, ...dataBus(0x66) }).run(ns(20));
      b.set({ CS: 0 }).run(low);
      b.set({ CS: 1 }).run(ns(10));
      b.set({ WE: 1, ...dataBus('Z') }).run(ns(10));
      b.set({ CS: 0 }).settle();
    };
    csWrite(1, ns(17));
    expect(readAt(b, 1)).toBe(hex(0x66));
    expect(violations(b)).toEqual([]);
    csWrite(2, ns(16));
    expect(readAt(b, 2)).toBe('XXXXXXXX');
    expect(violations(b)).toEqual([
      [
        TimingViolation.PULSE_WIDTH,
        'CS',
        'CS was LOW for only 16 ns when the write ended (tCW ≥ 17 ns)',
      ],
    ]);
  });

  it('tAW = 17 ns: an address 17 ns before the end is fine, 16 ns spoils the old and new cell', () => {
    const b = idle();
    write(b, 4, 0x11);
    write(b, 5, 0x22);
    b.set(dataBus(0x77)).run(ns(20));
    // The address and WE̅ change together (tAS = 0 is met); the write lasts tAW.
    b.set({ ...address(6, 11), WE: 0 }).run(ns(17));
    b.set({ WE: 1 }).run(ns(10));
    expect(violations(b)).toEqual([]);
    b.set({ ...address(4, 11), WE: 0 }).run(ns(16));
    b.set({ WE: 1 }).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(readAt(b, 6)).toBe('XXXXXXXX');
    expect(readAt(b, 4)).toBe('XXXXXXXX');
    expect(readAt(b, 5)).toBe(hex(0x22));
    expect(violations(b)).toEqual([
      [TimingViolation.SETUP, 'A1', 'A1 changed 16 ns before the write ended (tAW ≥ 17 ns)'],
    ]);
  });

  it('the address changing during a write spoils the old and the new cell (note 1)', () => {
    const b = idle();
    write(b, 8, 0x08);
    write(b, 9, 0x09);
    write(b, 10, 0x0a);
    b.set({ ...address(8, 11), ...dataBus(0xee) }).run(ns(20));
    b.set({ WE: 0 }).run(ns(20));
    b.set(address(9, 11)).run(ns(20));
    b.set({ WE: 1 }).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(readAt(b, 8)).toBe('XXXXXXXX');
    expect(readAt(b, 9)).toBe('XXXXXXXX');
    expect(readAt(b, 10)).toBe(hex(0x0a));
    expect(violations(b)[0]).toEqual([TimingViolation.SETUP, 'A0', 'A0 changed during the write']);
  });

  it('tWR = tDH = 0: the address and data may change as the write ends; the cell keeps the data', () => {
    const b = idle();
    b.set({ ...address(12, 11), ...dataBus(0x5a) }).run(ns(20));
    b.set({ WE: 0 }).run(ns(20));
    b.set({ WE: 1, ...address(13, 11), ...dataBus(0xff) }).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(readAt(b, 12)).toBe(hex(0x5a));
    expect(readAt(b, 13)).toBe(hex(0));
    expect(violations(b)).toEqual([]);
  });
});

describe('6116 unknowns', () => {
  it('an unknown WE̅ merges the data into the cell where they differ', () => {
    const b = idle();
    write(b, 1, 0x0f);
    b.set(dataBus(0x3c)).run(ns(20));
    b.set({ WE: 'X' }).run(ns(20));
    b.set({ WE: 1 }).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(readAt(b, 1)).toBe('00XX11XX');
  });

  it('the address changing while WE̅ is unknown merges the data into the old and new cell', () => {
    const b = idle();
    write(b, 1, 0x0f);
    write(b, 2, 0x0f);
    b.set({ ...address(1, 11), ...dataBus(0x3c) }).run(ns(20));
    b.set({ WE: 'X' }).run(ns(20));
    b.set(address(2, 11)).run(ns(20));
    b.set({ WE: 1 }).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(readAt(b, 1)).toBe('00XX11XX');
    expect(readAt(b, 2)).toBe('00XX11XX');
  });

  it('unknown address bits in a write merge the data into every cell they could select', () => {
    const b = idle();
    write(b, 0, 0x01);
    b.set({ ...address(2, 11), A0: 'X', ...dataBus(0x03) }).run(ns(20));
    b.set({ WE: 0 }).run(ns(20));
    b.set({ WE: 1 }).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(readAt(b, 2)).toBe('000000XX');
    expect(readAt(b, 3)).toBe('000000XX');
    expect(readAt(b, 0)).toBe(hex(0x01));
  });

  it('unknown data bits are stored X', () => {
    const b = idle();
    b.set({ ...address(1, 11), ...dataBus(0xf0), IO1: 'X' }).run(ns(20));
    b.set({ WE: 0 }).run(ns(20));
    b.set({ WE: 1 }).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(readAt(b, 1)).toBe('111100X0');
  });

  it('floating data is reported when the write ends, not while the bus turns round', () => {
    const b = idle();
    b.set(address(1, 11)).run(ns(20));
    b.set({ WE: 0 }).run(ns(20)); // the bus floats meanwhile: nothing to report yet
    expect(b.diagnostics).toEqual([]);
    b.set({ WE: 1 }).run(ns(10));
    expect(b.diagnostics.map((d) => [d.kind, d.pin])).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [KernelDiagnosticKind.FLOATING_INPUT, `IO${i}`]),
    );
  });
});

describe('6116 power-on and debug writes', () => {
  const powerOn = (mode: string) => {
    const b = new Bench(sram6116, { powerOn: mode });
    b.set({ CS: 0, OE: 0, WE: 1, ...address(0, 11) }).settle();
    return b;
  };

  it('powers on unknown by default', () => {
    expect(dataText(powerOn('x'))).toBe('XXXXXXXX');
    expect(new Bench(sram6116).sim.stateOf('DUT')).toMatchObject({ writing: 0 });
  });

  it('powers on zeroed', () => {
    expect(dataByte(powerOn('zeros'))).toBe(0);
  });

  it('powers on random: the same in every run, different for another designator', () => {
    const contents = (id: string) => {
      const netlist = new NetlistBuilder().add(id, 'mem/6116', { powerOn: 'random' }).build();
      const sim = new Simulator(netlist, new Registry([sram6116]));
      sim.settle();
      return [...(sim.stateOf(id) as RamState).data.subarray(0, 64)];
    };
    expect(contents('U1')).toEqual(contents('U1'));
    expect(contents('U1')).not.toEqual(contents('U2'));
    expect(new Set(contents('U1')).size).toBeGreaterThan(32);
  });

  it('an unknown write enable during the power-on transient is no write', () => {
    const b = new Bench(sram6116, { powerOn: 'zeros' });
    b.set({ CS: 0, OE: 1, WE: 'X', ...address(0, 11), A0: 'X', ...dataBus(0xff) }).run(ns(10));
    b.set({ WE: 1, ...dataBus('Z') }).settle();
    expect(readAt(b, 0)).toBe(hex(0));
    expect(readAt(b, 1)).toBe(hex(0));
  });

  it('poke writes at once; outputs reading the cell follow after tAA', () => {
    const b = powerOn('zeros');
    b.action({ type: 'poke', address: 0, data: [0x12, 0x34] });
    expect(changes(b, {}, 'IO1')).toEqual([
      [5, 'X'],
      [25, '1'],
    ]);
    expect(dataByte(b)).toBe(0x12);
    expect(readAt(b, 1)).toBe(hex(0x34));
    const view = sram6116.memory!.view(b.sim.stateOf('DUT') as RamState);
    expect([...view.data.subarray(0, 3)]).toEqual([0x12, 0x34, 0]);
  });

  it('rejects pokes outside the memory and unknown actions', () => {
    const b = powerOn('x');
    expect(() => b.action({ type: 'poke', address: 2047, data: [1, 2] })).toThrow(
      'DUT: poke of 2 bytes at 2047 is outside 0…2047',
    );
    expect(() => b.action({ type: 'toggle' })).toThrow('DUT: unknown action');
  });
});

describe('write requirements the 6116 has as 0 (a test part)', () => {
  // The 6116's -25 limits with 5 ns of address set-up, write recovery and data hold, as slower
  // SRAMs have.
  const base = SRAM_6116.grades['25']!.timing;
  const part = sramDefinition({
    ...SRAM_6116,
    name: 'test-sram',
    grades: {
      '25': {
        label: 'test',
        timing: { ...base, min: { ...base.min, tAS: ns(5), tWR: ns(5), tDH: ns(5) } },
      },
    },
  });
  const bench = () => {
    const b = new Bench(part, { powerOn: 'zeros' });
    b.set({ CS: 0, OE: 1, WE: 1, ...address(0, 11) }).settle();
    write(b, 1, 0x11);
    write(b, 2, 0x22);
    return b;
  };

  it('tAS = 5 ns: an address 5 ns before the start is fine, 4 ns spoils the old and new cell', () => {
    const b = bench();
    b.set({ ...address(1, 11), ...dataBus(0x33) }).run(ns(5));
    b.set({ WE: 0 }).run(ns(20));
    b.set({ WE: 1 }).run(ns(10));
    expect(violations(b)).toEqual([]);
    b.set(address(2, 11)).run(ns(4));
    b.set({ WE: 0 }).run(ns(20));
    b.set({ WE: 1 }).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(violations(b)).toEqual([
      [TimingViolation.SETUP, 'A0', 'A0 changed 4 ns before the write started (tAS ≥ 5 ns)'],
    ]);
    expect(readAt(b, 1)).toBe('XXXXXXXX');
    expect(readAt(b, 2)).toBe('XXXXXXXX');
  });

  it('tAS = 5 ns: the address changing with WE̅ is a violation', () => {
    const b = bench();
    b.set(dataBus(0x55)).run(ns(10)); // the bench is left at address 2
    b.set({ ...address(1, 11), WE: 0 }).run(ns(20));
    b.set({ WE: 1 }).run(ns(10));
    expect(violations(b)).toEqual([
      [
        TimingViolation.SETUP,
        'A0',
        'A0 changed at the same time as the write started (tAS ≥ 5 ns)',
      ],
    ]);
  });

  it('tWR = 5 ns: the address held 5 ns after the end is fine, 4 ns spoils both cells', () => {
    const b = bench();
    b.set({ ...address(1, 11), ...dataBus(0x44) }).run(ns(20));
    b.set({ WE: 0 }).run(ns(20));
    b.set({ WE: 1 }).run(ns(5));
    b.set(address(3, 11)).run(ns(10));
    expect(violations(b)).toEqual([]);
    b.set(address(1, 11)).run(ns(20));
    b.set({ WE: 0 }).run(ns(20));
    b.set({ WE: 1 }).run(ns(4));
    b.set(address(2, 11)).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(violations(b)).toEqual([
      [TimingViolation.HOLD, 'A0', 'A0 changed 4 ns after the write ended (tWR ≥ 5 ns)'],
    ]);
    expect(readAt(b, 1)).toBe('XXXXXXXX');
    expect(readAt(b, 2)).toBe('XXXXXXXX');
  });

  it('tDH = 5 ns: data held 5 ns is fine; a bit changing 4 ns after the end is X if it differs', () => {
    const b = bench();
    b.set({ ...address(1, 11), ...dataBus(0x0f) }).run(ns(20));
    b.set({ WE: 0 }).run(ns(20));
    b.set({ WE: 1 }).run(ns(5));
    b.set(dataBus(0xff)).run(ns(10));
    expect(violations(b)).toEqual([]);
    b.set(dataBus(0x0f)).run(ns(20));
    b.set({ WE: 0 }).run(ns(20));
    b.set({ WE: 1 }).run(ns(4));
    b.set({ IO7: 1, IO0: 0 }).run(ns(10));
    b.set(dataBus('Z')).run(ns(10));
    expect(violations(b).map((v) => [v[0], v[1]])).toEqual([
      [TimingViolation.HOLD, 'IO0'],
      [TimingViolation.HOLD, 'IO7'],
    ]);
    expect(readAt(b, 1)).toBe('X000111X');
  });
});
