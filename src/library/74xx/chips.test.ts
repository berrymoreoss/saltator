import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, isDriverPin, pinsOf, Registry } from '../../core';
import { chips74xx } from '.';

const pinList = (d: AnyComponentDefinition) => pinsOf(d, {});
const cases = chips74xx.map((d) => [d.name, d] as const);

describe('74xx chips', () => {
  it('are the 18 chips of R06, in number order, and register cleanly', () => {
    expect(chips74xx.map((d) => d.name.slice(4))).toEqual([
      '00',
      '02',
      '04',
      '08',
      '10',
      '11',
      '14',
      '20',
      '21',
      '27',
      '30',
      '32',
      '86',
      '125',
      '126',
      '240',
      '244',
      '245',
    ]);
    expect(new Registry(chips74xx).list()).toHaveLength(18);
  });

  it.each(cases)('%s is a DIP with every pin numbered and described', (name, d) => {
    expect(d.type).toBe(`74xx/${name.toLowerCase()}`);
    const count = d.package!.pins;
    const pins = pinList(d);
    expect(pins.map((p) => p.number)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    // Corner power pins, as on every 14- and 20-pin 74xx chip.
    expect(pins[count / 2 - 1]).toMatchObject({ name: 'GND', dir: 'power' });
    expect(pins[count - 1]).toMatchObject({ name: 'VCC', dir: 'power' });
    for (const pin of pins) {
      expect(pin.description, pin.name).toMatch(/\S/);
      if (pin.dir === 'nc') expect(pin.name).toBe(`NC${pin.number}`);
      if (pin.activeLow) expect(pin.description).toContain('active LOW');
    }
  });

  it.each(cases)('%s cites its Nexperia data sheet and timing', (_, d) => {
    const doc =
      /^https:\/\/assets\.nexperia\.com\/documents\/data-sheet\/(74HC(?:_HCT)?\d+)\.pdf$/.exec(
        d.datasheet ?? '',
      )?.[1];
    expect(doc).toBeDefined();
    const timing = d.timing!;
    expect(timing.source).toMatch(
      new RegExp(`^Nexperia ${doc} product data sheet, rev\\. \\d+ \\(.+ 20\\d\\d\\), table 7$`),
    );
    expect(timing.conditions).toBe(
      'VCC = 4.5 V, CL = 50 pF; typ at 25 °C, max at −40 °C to +85 °C',
    );
    const threeState = pinList(d).some((p) => p.dir === 'tristate' || p.dir === 'bidir');
    const symbols = threeState ? ['tdis', 'ten', 'tpd'] : ['tpd'];
    expect(Object.keys(timing.typical).sort()).toEqual(symbols);
    expect(Object.keys(timing.max ?? {}).sort()).toEqual(symbols);
    for (const symbol of symbols) {
      expect(timing.typical[symbol]).toBeGreaterThan(0);
      expect(timing.typical[symbol]).toBeLessThan(timing.max![symbol]!);
    }
  });

  it.each(cases)('%s lists units covering every signal pin once', (name, d) => {
    expect(d.functionTable).toBeDefined();
    if (name === '74HC245') {
      expect(d.units).toBeUndefined(); // one section
      return;
    }
    const signals = pinList(d)
      .filter((p) => p.dir !== 'power' && p.dir !== 'nc')
      .map((p) => p.name);
    const units = d.units!;
    expect(units.flatMap((u) => u.pins).sort()).toEqual(signals.sort());
    expect(new Set(units.map((u) => u.name)).size).toBe(units.length);
    // Inputs first: every unit ends with its outputs.
    for (const unit of units) {
      const dirs = unit.pins.map((n) => pinList(d).find((p) => p.name === n)!.dir);
      expect(dirs.indexOf('in'), unit.name).toBe(0);
      expect(dirs.findIndex(isDriverPin)).toBeGreaterThan(dirs.lastIndexOf('in'));
    }
  });
});
