import { defineComponent, Level, strong } from '../../core';

const VALUES = { '0': Level.L0, '1': Level.L1, X: Level.X } as const;

/** Constant logic level (a tie to a rail, or a deliberate X), driven strong from t = 0. */
export const constant = defineComponent<{ value: keyof typeof VALUES }, undefined>({
  type: 'prim/constant',
  name: 'CONST',
  title: 'Constant',
  keywords: ['constant', 'tie', 'high', 'low', 'vcc', 'gnd', 'logic 1', 'logic 0'],
  // Tied to 0 or 1: a rail as far as design checks are concerned (two 1s wired together are fine).
  pins: ({ value }) => [
    value === 'X' ? { name: 'Y', dir: 'out' } : { name: 'Y', dir: 'out', constant: VALUES[value] },
  ],
  symbol: { kind: 'constant', width: 2, height: 2, pins: { Y: { side: 'right', offset: 1 } } },
  props: [
    {
      key: 'value',
      label: 'Value',
      type: 'enum',
      default: '1',
      options: [
        { value: '0', label: '0 (low)' },
        { value: '1', label: '1 (high)' },
        { value: 'X', label: 'X (unknown)' },
      ],
    },
  ],
  create: ({ value }) => ({
    init: (ctx) => ctx.drive(0, strong(VALUES[value]), 0),
  }),
});
