import { describe, expect, it } from 'vitest';
import { designatorPrefixOf, familyOf } from '../core';
import { createDefaultRegistry } from './registry';

const MEMORIES = ['mem/at28c16', 'mem/at28c64b', 'mem/at28c256', 'mem/6116', 'mem/62256'];

const CHIPS = [
  '74xx/74hc00',
  '74xx/74hc02',
  '74xx/74hc04',
  '74xx/74hc08',
  '74xx/74hc10',
  '74xx/74hc11',
  '74xx/74hc14',
  '74xx/74hc20',
  '74xx/74hc21',
  '74xx/74hc27',
  '74xx/74hc30',
  '74xx/74hc32',
  '74xx/74hc74',
  '74xx/74hc85',
  '74xx/74hc86',
  '74xx/74hc107',
  '74xx/74hc109',
  '74xx/74hc112',
  '74xx/74hc125',
  '74xx/74hc126',
  '74xx/74hc138',
  '74xx/74hc139',
  '74xx/74hc147',
  '74xx/74hc148',
  '74xx/74hc151',
  '74xx/74hc153',
  '74xx/74hc157',
  '74xx/74hc158',
  '74xx/74hc161',
  '74xx/74hc163',
  '74xx/74hc164',
  '74xx/74hc165',
  '74xx/74hc173',
  '74xx/74hc175',
  '74xx/74hc191',
  '74xx/74hc193',
  '74xx/74hc240',
  '74xx/74hc244',
  '74xx/74hc245',
  '74xx/74hc273',
  '74xx/74hc283',
  '74xx/74hc374',
  '74xx/74hc377',
  '74xx/74hc574',
  '74xx/74hc595',
  '74xx/74hc4040',
  '74xx/74hc4511',
];

describe('createDefaultRegistry', () => {
  it('contains every primitive, IO part, net part, chip, CPU, peripheral and graphic', () => {
    expect(
      createDefaultRegistry()
        .list()
        .map((d) => d.type),
    ).toEqual([
      'prim/buffer',
      'prim/not',
      'prim/and',
      'prim/or',
      'prim/nand',
      'prim/nor',
      'prim/xor',
      'prim/xnor',
      'prim/tristate-buffer',
      'prim/constant',
      'prim/pull',
      'io/vcc',
      'io/gnd',
      'io/switch',
      'io/button',
      'io/dip-switch',
      'io/clock',
      'io/led',
      'io/led-bar',
      'io/seven-segment',
      'io/hex-display',
      'io/probe',
      'net/label',
      'net/bus-entry',
      'net/port',
      ...CHIPS,
      'timer/ne555',
      ...MEMORIES,
      'cpu/w65c02s',
      'periph/hd44780',
      'periph/st7789',
      'draw/text',
    ]);
  });

  it('gives every part a name, a title and search keywords', () => {
    for (const d of createDefaultRegistry().list()) {
      expect(d.name, d.type).not.toBe('');
      expect(d.title, d.type).not.toBe('');
      expect(d.keywords?.length, d.type).toBeGreaterThan(0);
      expect(['prim', 'io', 'net', '74xx', 'timer', 'mem', 'cpu', 'periph', 'draw']).toContain(
        familyOf(d.type),
      );
    }
  });

  it('gives every part its conventional designator prefix', () => {
    const prefixes = Object.fromEntries(
      createDefaultRegistry()
        .list()
        .map((d) => [d.type, designatorPrefixOf(d)]),
    );
    expect(prefixes).toEqual({
      'prim/buffer': 'U',
      'prim/not': 'U',
      'prim/and': 'U',
      'prim/or': 'U',
      'prim/nand': 'U',
      'prim/nor': 'U',
      'prim/xor': 'U',
      'prim/xnor': 'U',
      'prim/tristate-buffer': 'U',
      'prim/constant': 'U',
      'prim/pull': 'R',
      'io/vcc': 'PWR',
      'io/gnd': 'PWR',
      'io/switch': 'SW',
      'io/button': 'SW',
      'io/dip-switch': 'SW',
      'io/clock': 'X',
      'io/led': 'D',
      'io/led-bar': 'D',
      'io/seven-segment': 'DS',
      'io/hex-display': 'DS',
      'io/probe': 'TP',
      'net/label': 'NL',
      'net/bus-entry': 'BE',
      'net/port': 'P',
      ...Object.fromEntries(CHIPS.map((type) => [type, 'U'])),
      'timer/ne555': 'U',
      ...Object.fromEntries(MEMORIES.map((type) => [type, 'U'])),
      'cpu/w65c02s': 'U',
      'periph/hd44780': 'DS',
      'periph/st7789': 'DS',
      'draw/text': 'TXT',
    });
  });

  it('returns a fresh registry each time', () => {
    const a = createDefaultRegistry();
    const b = createDefaultRegistry();
    expect(a).not.toBe(b);
    expect(a.list()).toEqual(b.list());
  });
});
