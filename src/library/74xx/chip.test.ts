import { describe, expect, it } from 'vitest';
import { Level, ns, pinIndex, pinsOf, strong, toInput } from '../../core';
import { Bench } from '../../core/testing';
import {
  type ChipBehavior,
  type ChipSpec,
  chipDefinition,
  type LogicFamily,
  pinIndices,
} from './chip';
import { pins } from './pinout';

/** A fixture D latch: Q follows D while LE is low, holds while LE is high. */
const SPEC: ChipSpec = {
  number: '998',
  title: 'Test latch',
  keywords: [],
  pinCount: 6,
  pins: [
    pins('D, LE', '1, 2', 'in', 'data input'),
    pins('GND', '3', 'power', 'ground (0 V)'),
    pins('Q', '4', 'out', 'data output'),
    pins('n.c.', '5', 'nc', 'not connected'),
    pins('VCC', '6', 'power', 'supply voltage'),
  ],
  functionTable: { inputs: ['LE', 'D'], outputs: ['Q'], rows: ['L L | L', 'L H | H'] },
};

const FAMILY: LogicFamily = {
  name: 'TT',
  chips: {
    '998': { datasheet: 'https://example.com/998.pdf', timing: { typical: { tpd: ns(5) } } },
  },
};

const latch: ChipBehavior<{ q: Level }> = (pinList) => {
  const [D, LE, Q] = pinIndices(pinList, 'D, LE, Q') as unknown as [number, number, number];
  return () => ({
    createState: () => ({ q: Level.X }),
    evaluate(ctx) {
      if (ctx.read(LE) === Level.L0) ctx.state.q = toInput(ctx.read(D));
      ctx.drive(Q, strong(ctx.state.q), ns(5));
    },
  });
};

describe('chipDefinition', () => {
  it('makes chips whose instances keep state', () => {
    const chip = chipDefinition(SPEC, FAMILY, latch);
    expect(chip.type).toBe('74xx/74tt998');
    const bench = new Bench(chip);
    bench.set({ LE: 0, D: 1 }).settle();
    bench.expect({ Q: 1 });
    bench.set({ LE: 1 }).settle();
    bench.set({ D: 0 }).settle();
    bench.expect({ Q: 1 });
    bench.set({ LE: 0 }).settle();
    bench.expect({ Q: 0 });
  });
});

describe('pinIndices', () => {
  it('maps comma-separated names to pin refs, in order', () => {
    const chip = chipDefinition(SPEC, FAMILY, latch);
    const list = pinsOf(chip, {});
    expect([...pinIndices(list, 'Q, D,LE')]).toEqual([
      pinIndex(list, 'Q'),
      pinIndex(list, 'D'),
      pinIndex(list, 'LE'),
    ]);
    expect(() => pinIndices(list, 'D, X9')).toThrow(/X9/);
  });
});
