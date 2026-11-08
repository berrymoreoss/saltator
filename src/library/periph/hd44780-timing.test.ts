/**
 * The HD44780's bus requirements (5 V Bus Timing Characteristics), the busy flag and the
 * power-on wait: each just inside its limit (silent) and just outside (an error and the `X` the
 * data sheet leaves us with), and the unknowns that follow.
 */
import { describe, expect, it } from 'vitest';
import { ms, ns, TimingViolation, us } from '../../core';
import { Bench } from '../../core/testing';
import { hd44780 } from './hd44780';
import { ALL_UNKNOWN, Hd44780Diagnostic, Iface, Unknown } from './hd44780-controller';
import { busValues, LcdBench, SAFE } from './test-helpers';

const kinds = (lcd: LcdBench) => lcd.bench.diagnostics.map((d) => `${d.kind} ${d.pin ?? ''}`);

/** A module initialized in 8-bit mode with the cursor at 0 and no diagnostics so far. */
function ready(): LcdBench {
  const lcd = new LcdBench().initEightBit();
  lcd.bench.expectNoDiagnostics();
  return lcd;
}

describe('tAS: RS and R/W̅ set up 40 ns before E rises', () => {
  it.each([
    [ns(40), 'A', []],
    [ns(39), '?', [`${TimingViolation.SETUP} RS`]],
  ])('RS changing %d ps before E rises', (setup, shown, diagnostics) => {
    const lcd = ready();
    lcd.write(1, 0x41, { ...SAFE, setup });
    lcd.run(us(60));
    // Too late: an instruction (Set CGRAM 0x01) or the data — the cell may hold 'A'.
    expect(lcd.text[0]![0]).toBe(shown);
    expect(kinds(lcd)).toEqual(diagnostics);
  });

  it('leaves unknown only what the two kinds disagree on', () => {
    const lcd = ready();
    lcd.write(1, 0x41, { ...SAFE, setup: ns(10) });
    // Set CGRAM address 0x01, or 'A' at 0 and the cursor on to 1: AC is 1 either way.
    const c = lcd.controller;
    expect(c.unknown & (Unknown.AC | Unknown.CG)).toBe(Unknown.CG);
    expect(c.ac).toBe(1);
  });
});

describe('tAH: RS and R/W̅ held 10 ns after E falls', () => {
  function holdRs(hold: number) {
    const lcd = ready();
    const b = lcd.bench;
    b.set({ RS: 1, RW: 0, ...busValues(0x41) });
    b.run(ns(100));
    b.set({ E: 1 });
    b.run(ns(300));
    b.set({ E: 0 });
    b.run(hold);
    b.set({ RS: 0 });
    b.run(us(60));
    return lcd;
  }

  it('is silent at 10 ns', () => {
    const lcd = holdRs(ns(10));
    expect(lcd.text[0]![0]).toBe('A');
    lcd.bench.expectNoDiagnostics();
  });

  it('reports 9 ns and makes the transfer uncertain', () => {
    const lcd = holdRs(ns(9));
    expect(kinds(lcd)).toEqual([`${TimingViolation.HOLD} RS`]);
    expect(lcd.text[0]![0]).toBe('?');
  });

  it('reports RS changing while E is HIGH', () => {
    const lcd = ready();
    const b = lcd.bench;
    b.set({ RS: 1, RW: 0, ...busValues(0x41) });
    b.run(ns(100));
    b.set({ E: 1 });
    b.run(ns(100));
    b.set({ RS: 0 });
    b.run(ns(200));
    b.set({ E: 0 });
    b.run(us(60));
    expect(lcd.diagnostics()).toEqual([
      'hold-violation: RS changed while E was HIGH (stable from tAS before E rises to tAH after it falls)',
    ]);
    expect(lcd.text[0]![0]).toBe('?');
  });
});

describe('tDSW and tH: data set up 80 ns before and held 10 ns after E falls', () => {
  /** Writes 'A' (0x41) with DB3 changing `when` relative to E falling (negative: before). */
  function dataChange(when: number) {
    const lcd = ready();
    const b = lcd.bench;
    b.set({ RS: 1, RW: 0, ...busValues(when < 0 ? 0x49 : 0x41) });
    b.run(ns(100));
    b.set({ E: 1 });
    if (when < 0) {
      b.run(ns(300) + when);
      b.set({ DB3: 0 }); // 0x49 → 0x41
      b.run(-when);
      b.set({ E: 0 });
      b.run(ns(50));
    } else {
      b.run(ns(300));
      b.set({ E: 0 });
      b.run(when);
      b.set({ DB3: 1 }); // 0x41 → 0x49
      b.run(ns(50));
    }
    lcd.run(us(60));
    return lcd;
  }

  it.each([
    [-ns(80), 'A', []],
    [-ns(79), '?', [`${TimingViolation.SETUP} DB3`]],
    [ns(10), 'A', []],
    [ns(9), '?', [`${TimingViolation.HOLD} DB3`]],
  ])('DB3 changing %d ps from E falling', (when, shown, diagnostics) => {
    const lcd = dataChange(when);
    expect(lcd.text[0]![0]).toBe(shown);
    expect(kinds(lcd)).toEqual(diagnostics);
    if (shown === '?') expect(lcd.controller.ddramX[0]).toBe(0x08); // only that bit
  });

  it('ignores DB0–DB3 in 4-bit mode, even changing right at E falling', () => {
    const lcd = new LcdBench().initFourBit();
    lcd.nibble(1, 0x4);
    const b = lcd.bench;
    b.set({ RS: 1, ...busValues(0x10, [4, 5, 6, 7]), ...busValues(0x0f, [0, 1, 2, 3]) });
    b.run(ns(100));
    b.set({ E: 1 });
    b.run(ns(250));
    b.set({ DB0: 0 }); // 50 ns before E falls
    b.run(ns(50));
    b.set({ E: 0 });
    b.run(ns(5));
    b.set({ DB1: 0 }); // 5 ns after
    lcd.run(us(60));
    expect(lcd.text[0]![0]).toBe('A');
    b.expectNoDiagnostics();
  });

  it('checks writes only: the module releasing the bus after a read is no hold violation', () => {
    const lcd = ready();
    lcd.read(0);
    lcd.read(0);
    lcd.bench.expectNoDiagnostics();
  });
});

describe('PWEH: E HIGH for 230 ns', () => {
  it.each([
    [ns(230), 'A', []],
    [ns(229), '?', [`${TimingViolation.PULSE_WIDTH} E`]],
  ])('E HIGH for %d ps', (high, shown, diagnostics) => {
    const lcd = ready();
    lcd.write(1, 0x41, { ...SAFE, high });
    lcd.run(us(60));
    expect(lcd.text[0]![0]).toBe(shown);
    expect(kinds(lcd)).toEqual(diagnostics);
  });
});

describe('tcycE: 500 ns from E rising to E rising', () => {
  it.each([
    [ns(500), '00000000', []],
    [ns(499), 'XXXXXXXX', [`${TimingViolation.CYCLE} E`]],
  ])('busy-flag reads %d ps apart', (cycle, second, diagnostics) => {
    const lcd = ready();
    const timing = { setup: ns(100), high: ns(250), hold: ns(50), low: 0 };
    const b = lcd.bench;
    b.set({ RS: 0, RW: 1, ...busValues('Z') });
    b.run(timing.setup);
    for (const _ of [1, 2]) {
      b.set({ E: 1 });
      b.run(timing.high);
      if (_ === 2) expect(lcd.busText()).toBe(second);
      b.set({ E: 0 });
      b.run(cycle - timing.high);
    }
    expect(kinds(lcd)).toEqual(diagnostics);
  });
});

describe('the busy flag', () => {
  it('ignores a write while busy, and reports it', () => {
    const lcd = ready();
    lcd.write(1, 0x41).run(us(20));
    lcd.write(1, 0x42).run(us(60));
    expect(lcd.text[0]!.slice(0, 2)).toBe('A ');
    expect(lcd.diagnostics()).toEqual([
      expect.stringMatching(
        /^busy-violation: written while the LCD is busy \(for .* more\): not accepted$/,
      ),
    ]);
  });

  it('accepts a write once BF clears (37 µs after E fell)', () => {
    const lcd = ready();
    lcd.write(1, 0x41).run(us(37) - SAFE.hold - SAFE.low - SAFE.setup);
    lcd.write(1, 0x42);
    expect(lcd.text[0]!.slice(0, 2)).toBe('AB');
    lcd.bench.expectNoDiagnostics();
  });

  it('gives invalid data for a data read while busy', () => {
    const lcd = ready().command(0x80);
    lcd.write(0, 0x80).run(us(10));
    expect(lcd.read(1)).toBe('XXXXXXXX');
    expect(kinds(lcd)).toEqual([`${Hd44780Diagnostic.BUSY} `]);
  });
});

describe('power-on', () => {
  it('reports a write before 15 ms and ignores it while the internal reset is busy', () => {
    const early = new LcdBench({}, ms(5)).command(0x38).command(0x0c).data('x');
    expect(early.controller.n).toBe(0); // all three ignored: still busy
    expect(kinds(early)).toEqual([`${Hd44780Diagnostic.POWER_ON} `, `${Hd44780Diagnostic.BUSY} `]);
    const late = new LcdBench({}, ms(12)).command(0x38);
    expect(late.controller.n).toBe(1); // accepted, but too early by the data sheet
    expect(kinds(late)).toEqual([`${Hd44780Diagnostic.POWER_ON} `]);
  });

  it('starts with CGRAM unknown: custom characters show garbage until defined', () => {
    const lcd = ready().data([0x00]);
    expect(lcd.text[0]![0]).toBe('·');
    expect(lcd.controller.cgramX[0]).toBe(0xff);
  });
});

describe('unknowns', () => {
  it('stores the unknown bits of a data write', () => {
    const lcd = ready();
    lcd.bench.set({ RS: 1, RW: 0, ...busValues(0x41), DB6: 'X' });
    lcd.run(ns(100));
    lcd.bench.set({ E: 1 });
    lcd.run(ns(300));
    lcd.bench.set({ E: 0 });
    lcd.run(us(60));
    expect(lcd.controller.ddramX[0]).toBe(0x40);
    expect(lcd.text[0]![0]).toBe('?');
  });

  it('makes an address with an unknown bit unknown; a data write then may be anywhere', () => {
    const lcd = ready();
    lcd.bench.set({ RS: 0, RW: 0, ...busValues(0x80), DB0: 'X' });
    lcd.run(ns(100));
    lcd.bench.set({ E: 1 });
    lcd.run(ns(300));
    lcd.bench.set({ E: 0 });
    lcd.run(us(60));
    expect(lcd.controller.unknown & Unknown.AC).toBe(Unknown.AC);
    lcd.data('Q');
    expect(lcd.text).toEqual(['?'.repeat(16), '?'.repeat(16)]);
    // Clear display makes it all known again.
    lcd.command(0x01, ms(2));
    expect(lcd.text).toEqual([' '.repeat(16), ' '.repeat(16)]);
    expect(lcd.controller.unknown).toBe(0);
  });

  /** Writes an instruction with the bus bits in `xBits` unknown. */
  function instructionWithX(lcd: LcdBench, byte: number, xBits: number) {
    const unknown = Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => (xBits >> i) & 1).map((i) => [`DB${i}`, 'X'] as const),
    );
    lcd.bench.set({ RS: 0, RW: 0, ...busValues(byte), ...unknown });
    lcd.run(ns(100));
    lcd.bench.set({ E: 1 });
    lcd.run(ns(300));
    lcd.bench.set({ E: 0 });
    lcd.run(us(60));
  }

  it('runs an instruction with up to 3 unknown bits once per value it could have', () => {
    const lcd = ready();
    instructionWithX(lcd, 0x80, 0x07); // Set DDRAM 0x00–0x07
    const c = lcd.controller;
    // Every value loads the same blank into the data register: only AC is unknown.
    expect(c.unknown).toBe(Unknown.AC);
    expect(c.ac & 0x78).toBe(0); // the known bits stay known
  });

  it('gives up on more: any instruction may have run, everything it could touch unknown', () => {
    const lcd = ready().data('ok');
    instructionWithX(lcd, 0x00, 0xff);
    const c = lcd.controller;
    expect(c.unknown).toBe(ALL_UNKNOWN);
    expect(c.iface).toBe(Iface.EIGHT | Iface.HIGH);
    expect([...c.ddramX.slice(0, 3)]).toEqual([0x20 ^ 0x6f, 0x20 ^ 0x6b, 0]); // a Clear's spaces
    lcd.write(0, 0x01).run(us(60));
    expect(lcd.diagnostics()).toEqual([expect.stringMatching(/^busy-violation: .* may be busy/)]);
  });

  it('reports E going unknown once it was known, and the transfer may have happened', () => {
    const lcd = ready();
    lcd.bench.set({ RS: 1, RW: 0, ...busValues(0x41) });
    lcd.run(ns(100));
    lcd.bench.set({ E: 'X' });
    lcd.run(ns(300));
    lcd.bench.set({ E: 0 });
    lcd.run(us(60));
    expect(kinds(lcd)).toEqual([`${Hd44780Diagnostic.UNCERTAIN_ENABLE} E`]);
    expect(lcd.text[0]![0]).toBe('?');
    // It may not have happened: the cursor is at 0 or 1.
    expect(lcd.controller.unknown & Unknown.AC).toBe(Unknown.AC);
  });

  it('ignores E starting unknown at power-on (a gate output before its first delay)', () => {
    const b = new Bench(hd44780);
    b.set({ RS: 0, RW: 0, E: 'X', V0: 0, A: 1, K: 0 });
    b.run(ns(10));
    b.set({ E: 0 });
    b.run(ms(20));
    b.expectNoDiagnostics();
  });

  it('reads E only when it changes: a 3-state driver enabled after power-on is no floating E', () => {
    const b = new Bench(hd44780);
    b.set({ RS: 0, RW: 0, V0: 0, A: 1, K: 0 });
    b.run(ns(20)); // E floats until the driver turns on
    b.set({ E: 0 });
    b.run(ms(20));
    b.expectNoDiagnostics();
  });

  it('drives X during a read whose R/W̅ is uncertain', () => {
    const lcd = ready();
    lcd.bench.set({ RS: 0, ...busValues('Z') });
    lcd.run(ns(100));
    lcd.bench.set({ RW: 1 });
    lcd.run(ns(10)); // R/W̅ 10 ns before E: too late
    lcd.bench.set({ E: 1 });
    lcd.run(ns(300));
    expect(lcd.busText()).toBe('XXXXXXXX');
    expect(kinds(lcd)).toEqual([`${TimingViolation.SETUP} RW`]);
  });
});
