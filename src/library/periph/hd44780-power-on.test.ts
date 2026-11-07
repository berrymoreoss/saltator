/**
 * `powerOn: unknown` — the internal reset didn't work (the supply rose too slowly), so the
 * controller may be in any interface mode with any settings: only the data sheet's
 * initialization by instruction (Figures 23 and 24) brings it to a known state.
 */
import { describe, expect, it } from 'vitest';
import { ms, us } from '../../core';
import { ALL_UNKNOWN, Hd44780Diagnostic, Iface } from './hd44780-controller';
import { LcdBench } from './test-helpers';

const unknownLcd = () => new LcdBench({ powerOn: 'unknown' });

describe('HD44780 power-on without the internal reset', () => {
  it('starts with everything unknown: any interface mode, every register, the glass', () => {
    const lcd = unknownLcd();
    const c = lcd.controller;
    expect(c.iface).toBe(Iface.EIGHT | Iface.HIGH | Iface.LOW);
    expect(c.unknown).toBe(ALL_UNKNOWN);
    expect(lcd.text).toEqual(['?'.repeat(16), '?'.repeat(16)]);
  });

  it('comes up in 8-bit mode by Figure 23 (0x30 three times, then the settings)', () => {
    const lcd = unknownLcd();
    lcd.command(0x30, ms(4.2)).command(0x30, us(110)).command(0x30, us(110));
    expect(lcd.controller.iface).toBe(Iface.EIGHT);
    lcd.command(0x38).command(0x08).command(0x01, ms(2)).command(0x06).command(0x0c);
    expect(lcd.controller.unknown).toBe(0);
    lcd.data('Robust');
    expect(lcd.text[0]).toBe('Robust          ');
    lcd.bench.expectNoDiagnostics();
  });

  it('comes up in 4-bit mode by Figure 24 (0x3 three times, 0x2, then the settings)', () => {
    const lcd = unknownLcd().initFourBit();
    expect(lcd.controller.iface).toBe(Iface.HIGH);
    expect(lcd.controller.unknown).toBe(0);
    for (const ch of 'Robust 4') lcd.byte4(1, ch.charCodeAt(0));
    expect(lcd.text[0]).toBe('Robust 4        ');
    lcd.bench.expectNoDiagnostics();
  });

  it('resolves the mode only after the third 0x3', () => {
    const lcd = unknownLcd();
    lcd.nibble(0, 0x3).run(ms(4.2));
    expect(lcd.controller.iface).toBe(Iface.EIGHT | Iface.HIGH | Iface.LOW);
    lcd.nibble(0, 0x3).run(us(110));
    expect(lcd.controller.iface).toBe(Iface.EIGHT | Iface.LOW);
    lcd.nibble(0, 0x3).run(us(110));
    expect(lcd.controller.iface).toBe(Iface.EIGHT);
  });

  it('stays unknown with too short a first wait: the controller may still be busy', () => {
    const lcd = unknownLcd();
    lcd.nibble(0, 0x3).run(ms(1)); // a Return home may still be running
    lcd.nibble(0, 0x3).run(us(110)).nibble(0, 0x3).run(us(110)).nibble(0, 0x2).run(us(60));
    expect(lcd.controller.iface).not.toBe(Iface.HIGH);
    expect(lcd.bench.diagnostics.map((d) => d.kind)).toContain(Hd44780Diagnostic.BUSY);
  });

  it('stays unknown without the three 0x3 (Ben Eater’s 8-bit code relies on the reset)', () => {
    const lcd = unknownLcd().initEightBit().data('Hello');
    expect(lcd.controller.iface).not.toBe(Iface.EIGHT);
    expect(lcd.text[0]).toContain('?');
    // The same code with the internal reset works.
    const reset = new LcdBench().initEightBit().data('Hello');
    expect(reset.text[0]!.startsWith('Hello')).toBe(true);
  });
});
