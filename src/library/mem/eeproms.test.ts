import { describe, expect, it } from 'vitest';
import {
  type AnyComponentDefinition,
  ERASED,
  formatImage,
  KernelDiagnosticKind,
  ns,
  pinsOf,
  timingOf,
} from '../../core';
import { Bench } from '../../core/testing';
import { EEPROM_MODES, eeproms } from './eeproms';
import { MemoryDiagnosticKind, type MemoryState } from './memory';
import { address, changes, dataBus, dataByte, dataText } from './test-helpers';

const [at28c16, at28c64b, at28c256] = eeproms as [
  AnyComponentDefinition,
  AnyComponentDefinition,
  AnyComponentDefinition,
];

/** Pin names by pin number, read off each data sheet's PDIP pin configuration. */
const PINOUTS: Record<string, string[]> = {
  AT28C16: [
    ...['A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0', 'IO0', 'IO1', 'IO2', 'GND'],
    ...['IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'CE', 'A10', 'OE', 'WE', 'A9', 'A8', 'VCC'],
  ],
  AT28C64B: [
    ...['NC1', 'A12', 'A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0', 'IO0', 'IO1', 'IO2'],
    ...['GND', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'CE', 'A10', 'OE', 'A11', 'A9', 'A8'],
    ...['NC26', 'WE', 'VCC'],
  ],
  AT28C256: [
    ...['A14', 'A12', 'A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0', 'IO0', 'IO1', 'IO2'],
    ...['GND', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'CE', 'A10', 'OE', 'A11', 'A9', 'A8'],
    ...['A13', 'WE', 'VCC'],
  ],
};

const WORDS: Record<string, number> = { AT28C16: 2048, AT28C64B: 8192, AT28C256: 32768 };

const bitsOf = (d: AnyComponentDefinition) => Math.log2(WORDS[d.name]!);

/** An EEPROM with `contents`, selected and reading (CE̅, OE̅ LOW, WE̅ HIGH) at `at`, settled. */
function reading(d: AnyComponentDefinition, contents: string, at = 0): Bench {
  const bench = new Bench(d, { contents });
  bench.set({ CE: 0, OE: 0, WE: 1, ...address(at, bitsOf(d)) });
  bench.settle();
  return bench;
}

const IMAGE = '0000:A55A0F 0005:3C';

describe.each(eeproms.map((d) => [d.name, d] as const))('%s', (name, d) => {
  const bits = bitsOf(d);

  it('has its data sheet pinout, the data pins drawn I/O0…I/O7', () => {
    const pins = pinsOf(d, {});
    expect(pins.map((p) => p.name)).toEqual(PINOUTS[name]);
    expect(pins.map((p) => p.number)).toEqual(pins.map((_, i) => i + 1));
    expect(pins.find((p) => p.name === 'IO3')?.label).toBe('I/O3');
    for (const control of ['CE', 'OE', 'WE']) {
      expect(pins.find((p) => p.name === control)?.activeLow).toBe(true);
    }
    expect(d.type).toBe(`mem/${name.toLowerCase()}`);
    expect(d.package).toEqual({ kind: 'dip', pins: PINOUTS[name]!.length });
  });

  it('keeps the data sheet operating modes and its read limits', () => {
    expect(d.functionTable).toBe(EEPROM_MODES);
    const timing = timingOf(d, {})!;
    expect(timing.typical).toEqual({});
    expect(timing.max).toEqual({ tACC: ns(150), tCE: ns(150), tOE: ns(70), tDF: ns(50) });
    expect(timing.min).toEqual({ tOE: ns(name === 'AT28C16' ? 10 : 0), tDF: 0, tOH: 0 });
    expect(timing.source).toMatch(new RegExp(`^Atmel ${name} data sheet, rev\\. 0`));
    expect(d.memory).toMatchObject({ words: WORDS[name], width: 8, volatile: false });
  });

  it('reads its image, erased bytes as 0xFF', () => {
    const bench = reading(d, IMAGE);
    expect(dataByte(bench)).toBe(0xa5);
    for (const [at, value] of [
      [1, 0x5a],
      [2, 0x0f],
      [3, ERASED],
      [5, 0x3c],
      [WORDS[name]! - 1, ERASED],
    ] as const) {
      bench.set(address(at, bits)).settle();
      expect(dataByte(bench), `address ${at}`).toBe(value);
    }
    bench.expectNoDiagnostics();
  });

  it('decodes every address pin', () => {
    const bytes = new Uint8Array(WORDS[name]!).fill(ERASED);
    for (let i = 0; i < bits; i++) bytes[1 << i] = i + 1;
    const bench = reading(d, formatImage(bytes));
    for (let i = 0; i < bits; i++) {
      bench.set(address(1 << i, bits)).settle();
      expect(dataByte(bench), `A${i}`).toBe(i + 1);
    }
  });

  it('shows its cells through the memory view', () => {
    const bench = reading(d, IMAGE);
    const view = d.memory!.view(bench.sim.stateOf('DUT') as MemoryState);
    expect([...view.data.subarray(0, 6)]).toEqual([0xa5, 0x5a, 0x0f, ERASED, ERASED, 0x3c]);
    expect(view.unknown.every((x) => x === 0)).toBe(true);
  });

  it('rejects an image larger than the chip', () => {
    const end = WORDS[name]!.toString(16).toUpperCase();
    expect(() => new Bench(d, { contents: `${end}:00` })).toThrow('reaches past the last address');
  });
});

describe('EEPROM reads (AT28C16)', () => {
  // IO0 is 1 at address 0 (0xA5), 0 at address 1 (0x5A).
  const bench = () => reading(at28c16, IMAGE);

  it('mode table: read, standby and output disable', () => {
    const b = bench();
    expect(dataByte(b)).toBe(0xa5);
    b.set({ CE: 1 }).settle();
    expect(dataText(b)).toBe('ZZZZZZZZ');
    b.set({ CE: 0, OE: 1 }).settle();
    expect(dataText(b)).toBe('ZZZZZZZZ');
    b.set({ OE: 0, WE: 0 }).settle(); // OE̅ LOW inhibits writes: still a read
    expect(dataByte(b)).toBe(0xa5);
    b.expectNoDiagnostics();
  });

  it('address to output: X from tOH = 0, the data tACC = 150 ns after the change', () => {
    expect(changes(bench(), address(1, 11), 'IO0')).toEqual([
      [0, 'X'],
      [150, '0'],
    ]);
  });

  it('every data pin is X in the window, also one whose bit stays', () => {
    const b = bench(); // 0xA5 → 0x0F: IO2 is 1 in both
    b.set(address(2, 11)).run(ns(149));
    expect(dataText(b)).toBe('XXXXXXXX');
    b.run(ns(1));
    expect(dataByte(b)).toBe(0x0f);
  });

  it('CE̅ to output: X at once (no low-Z time given), the data tCE = 150 ns after', () => {
    const b = bench();
    b.set({ CE: 1 }).settle();
    expect(changes(b, { CE: 0 }, 'IO0')).toEqual([
      [0, 'X'],
      [150, '1'],
    ]);
  });

  it('OE̅ to output: X at once, the data tOE = 70 ns after', () => {
    const b = bench();
    b.set({ OE: 1 }).settle();
    expect(changes(b, { OE: 0 }, 'IO0')).toEqual([
      [0, 'X'],
      [70, '1'],
    ]);
  });

  it('CE̅ or OE̅ HIGH: the data stays until released tDF = 50 ns after', () => {
    expect(changes(bench(), { OE: 1 }, 'IO0')).toEqual([[50, 'Z']]);
    expect(changes(bench(), { CE: 1 }, 'IO0')).toEqual([[50, 'Z']]);
  });

  it('released after tDF from the first of CE̅ and OE̅ (note 3)', () => {
    const b = bench();
    b.set({ CE: 1 }).run(ns(20));
    expect(changes(b, { OE: 1 }, 'IO0')).toEqual([[30, 'Z']]);
  });

  it('OE̅ up to tACC − tOE after the address costs nothing (note 2)', () => {
    const b = bench();
    b.set({ OE: 1 }).settle();
    b.set(address(1, 11)).run(ns(80));
    expect(changes(b, { OE: 0 }, 'IO0')).toEqual([
      [0, 'X'],
      [70, '0'],
    ]);
    b.set({ OE: 1 }).settle();
    b.set(address(0, 11)).run(ns(50));
    expect(changes(b, { OE: 0 }, 'IO0')).toEqual([
      [0, 'X'],
      [100, '1'],
    ]);
  });

  it('a new address within the window waits for its own access time', () => {
    const b = bench();
    b.set(address(1, 11)).run(ns(100));
    expect(changes(b, address(2, 11), 'IO0')).toEqual([[150, '1']]);
    expect(dataByte(b)).toBe(0x0f);
  });

  it('powers on X until the first access completes', () => {
    const b = new Bench(at28c16, { contents: IMAGE });
    expect(changes(b, { CE: 0, OE: 0, WE: 1, ...address(0, 11) }, 'IO0')).toEqual([
      [0, 'X'],
      [150, '1'],
    ]);
  });

  it('unknown address bits merge the cells they could select', () => {
    const b = reading(at28c16, '0000:A5A4 0400:2524');
    b.set({ A0: 'X' }).settle();
    expect(dataText(b)).toBe('1010010X');
    b.set({ A10: 'X' }).settle(); // 0xA5, 0xA4, 0x25, 0x24
    expect(dataText(b)).toBe('X010010X');
    b.set({ A0: 0, A10: 0 }).settle();
    expect(dataByte(b)).toBe(0xa5);
    const opposite = reading(at28c16, '0000:00FF');
    opposite.set({ A0: 'X' }).settle();
    expect(dataText(opposite)).toBe('XXXXXXXX');
  });

  it('more than 8 unknown address bits: all X', () => {
    const b = reading(at28c16, '');
    b.set({ A0: 'X', A1: 'X', A2: 'X', A3: 'X', A4: 'X', A5: 'X', A6: 'X', A7: 'X' }).settle();
    expect(dataByte(b)).toBe(ERASED); // 8 bits merged, all erased
    b.set({ A8: 'X' }).settle();
    expect(dataText(b)).toBe('XXXXXXXX');
  });

  it('a floating address pin reads as X and is reported', () => {
    const b = reading(at28c16, '0000:A5A4');
    b.set({ A0: 'Z' }).settle();
    expect(dataText(b)).toBe('1010010X');
    expect(b.diagnostics.map((x) => [x.kind, x.pin])).toEqual([
      [KernelDiagnosticKind.FLOATING_INPUT, 'A0'],
    ]);
  });

  it('an unknown enable drives X (the outputs might be on)', () => {
    const b = bench();
    b.set({ OE: 'X' }).settle();
    expect(dataText(b)).toBe('XXXXXXXX');
    b.set({ OE: 1 }).settle();
    expect(dataText(b)).toBe('ZZZZZZZZ');
  });

  it('does not read its address while deselected', () => {
    const b = bench();
    b.set({ CE: 1 }).settle();
    b.set({ A3: 'Z' }).settle();
    b.expectNoDiagnostics();
  });
});

describe('EEPROM writes (not simulated)', () => {
  const written = (b: Bench) =>
    b.diagnostics.filter((x) => x.kind === MemoryDiagnosticKind.WRITE_IGNORED);

  it('a WE̅-controlled write is reported and changes nothing', () => {
    const b = reading(at28c16, IMAGE, 5);
    b.set({ OE: 1 }).settle();
    b.set({ ...dataBus(0x11) }).settle();
    b.set({ WE: 0 }).run(ns(200));
    b.set({ WE: 1 }).settle();
    expect(written(b).map((x) => [x.pin, x.message])).toEqual([
      ['WE', 'EEPROM writes are not simulated: the write to 0x005 was ignored'],
    ]);
    b.set({ ...dataBus('Z'), OE: 0 }).settle();
    expect(dataByte(b)).toBe(0x3c);
  });

  it('a CE̅-controlled write is reported on CE̅', () => {
    const b = reading(at28c16, IMAGE);
    b.set({ CE: 1, OE: 1, WE: 0 }).settle();
    b.set({ CE: 0 }).settle();
    expect(written(b).map((x) => x.pin)).toEqual(['CE']);
  });

  it('write inhibit: OE̅ LOW, CE̅ HIGH or WE̅ HIGH is no write', () => {
    const b = reading(at28c16, IMAGE);
    b.set({ WE: 0 }).settle(); // OE̅ LOW
    b.set({ WE: 1, CE: 1, OE: 1 }).settle();
    b.set({ WE: 0 }).settle(); // CE̅ HIGH
    b.set({ WE: 1 }).settle();
    for (let a = 0; a < 4; a++) b.set(address(a, 11)).settle(); // WE̅ HIGH throughout
    expect(written(b)).toEqual([]);
  });
});

describe('the bigger EEPROMs read alike', () => {
  it.each([at28c64b, at28c256])('%s: tACC 150 ns, tOE 70 ns, tDF 50 ns', (d) => {
    const bits = bitsOf(d);
    const top = WORDS[d.name]! - 1;
    const b = reading(d, `${top.toString(16)}:00`, 0);
    expect(changes(b, address(top, bits), 'IO0')).toEqual([
      [0, 'X'],
      [150, '0'],
    ]);
    expect(changes(b, { OE: 1 }, 'IO0')).toEqual([[50, 'Z']]);
    expect(changes(b, { OE: 0 }, 'IO0')).toEqual([
      [0, 'X'],
      [70, '0'],
    ]);
  });
});
