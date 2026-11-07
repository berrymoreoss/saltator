import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, isDriverPin, pinsOf, Registry } from '../../core';
import { chips74xx } from '.';

const pinList = (d: AnyComponentDefinition) => pinsOf(d, {});
const cases = chips74xx.map((d) => [d.name, d] as const);

describe('74xx chips', () => {
  it('are the chips of R06, R08 and R09a, in number order, and register cleanly', () => {
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
      '74',
      '85',
      '86',
      '125',
      '126',
      '138',
      '139',
      '147',
      '148',
      '151',
      '153',
      '157',
      '158',
      '240',
      '244',
      '245',
      '283',
      '4511',
    ]);
    expect(new Registry(chips74xx).list()).toHaveLength(chips74xx.length);
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
      // Inputs say so; outputs drawn with an overline (138's Yn, 151's YN) may not.
      // A falling-edge clock is drawn overlined; its description says HIGH-to-LOW instead.
      if (pin.activeLow && pin.dir === 'in' && !pin.clock)
        expect(pin.description).toContain('active LOW');
    }
  });

  it.each(cases)('%s cites its data sheet and timing', (_, d) => {
    const nexperia =
      /^https:\/\/assets\.nexperia\.com\/documents\/data-sheet\/(74HC(?:_HCT)?\d+)\.pdf$/.exec(
        d.datasheet ?? '',
      )?.[1];
    const ti = /^https:\/\/www\.ti\.com\/lit\/ds\/symlink\/((?:sn|cd)74hc\d+)\.pdf$/.exec(
      d.datasheet ?? '',
    )?.[1];
    const timing = d.timing!;
    if (nexperia) {
      expect(timing.source).toMatch(
        new RegExp(
          `^Nexperia ${nexperia} product data sheet, rev\\. \\d+ \\(.+ 20\\d\\d\\), table [78]$`,
        ),
      );
    } else {
      expect(ti, d.datasheet).toBeDefined();
      expect(timing.source).toMatch(
        new RegExp(
          `^TI ${ti!.toUpperCase()} data sheet, [A-Z]+\\d+[A-Z] \\(\\w+ 20\\d\\d\\), section `,
        ),
      );
    }
    const delays = Object.keys(timing.max ?? {}).sort();
    const requirements = Object.keys(timing.min ?? {}).sort();
    expect(timing.conditions).toBe(
      `VCC = 4.5 V, CL = 50 pF; typ at 25 °C, max at −40 °C to +85 °C${
        requirements.length === 0
          ? ''
          : `, min at ${d.name === '74HC74' ? '−40 °C to +85 °C' : '25 °C'}`
      }`,
    );
    expect(Object.keys(timing.typical).sort()).toEqual([...delays, ...requirements].sort());
    for (const symbol of delays) {
      // One delay (`tpd`, `ten`, `tdis`) or one per path, worded as the data sheet does.
      expect(symbol).toMatch(/^(tpd|ten|tdis)$|^(tpd|tPHL|tPLH|ten|tdis)\(.+ to .+\)$/);
      expect(timing.typical[symbol]).toBeGreaterThan(0);
      expect(timing.typical[symbol]).toBeLessThan(timing.max![symbol]!);
    }
    for (const symbol of requirements) {
      // Set-up, hold, pulse width and recovery: a typical part needs less than the minimum.
      expect(symbol).toMatch(/^(tsu|th|trec|tW)\(.+\)$/);
      expect(timing.min![symbol]).toBeGreaterThanOrEqual(0);
      expect(timing.typical[symbol]).toBeLessThanOrEqual(timing.min![symbol]!);
    }
    const threeState = pinList(d).some((p) => p.dir === 'tristate' || p.dir === 'bidir');
    if (threeState) {
      expect(delays.some((s) => /^ten\b/.test(s))).toBe(true);
      expect(delays.some((s) => /^tdis\b/.test(s))).toBe(true);
    }
  });

  it.each(cases)('%s has a function table and units covering every signal pin once', (_, d) => {
    expect(d.functionTable).toBeDefined();
    const units = d.units;
    if (!units) return; // one section: 245, decoders and multiplexers with shared controls, …
    const signals = pinList(d)
      .filter((p) => p.dir !== 'power' && p.dir !== 'nc')
      .map((p) => p.name);
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
