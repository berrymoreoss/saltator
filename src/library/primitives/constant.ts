import { defineComponent, Level, strong } from '../../core';

const VALUES = { '0': Level.L0, '1': Level.L1, X: Level.X } as const;

/** Constant logic level (a tie to a rail, or a deliberate X), driven strong from t = 0. */
export const constant = defineComponent<{ value: keyof typeof VALUES }, undefined>({
  type: 'prim/constant',
  name: 'CONST',
  title: 'Constant',
  keywords: ['constant', 'tie', 'high', 'low', 'vcc', 'gnd', 'logic 1', 'logic 0'],
  pins: [{ name: 'Y', dir: 'out' }],
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
