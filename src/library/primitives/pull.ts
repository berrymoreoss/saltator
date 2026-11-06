import { defineComponent, Level, weak } from '../../core';

/**
 * Pull-up / pull-down resistor: drives its net weakly to 1 / 0, so any strong driver (an output,
 * a pressed button) overrides it, and a released bus reads a defined level instead of floating.
 */
export const pull = defineComponent<{ direction: 'up' | 'down' }, undefined>({
  type: 'prim/pull',
  name: 'PULL',
  title: 'Pull-up / pull-down resistor',
  keywords: ['pull', 'pull-up', 'pull-down', 'resistor', 'weak'],
  pins: [{ name: 'Y', dir: 'out', weak: true }],
  props: [
    {
      key: 'direction',
      label: 'Direction',
      type: 'enum',
      default: 'up',
      options: [
        { value: 'up', label: 'Pull-up (weak 1)' },
        { value: 'down', label: 'Pull-down (weak 0)' },
      ],
    },
  ],
  create: ({ direction }) => ({
    init: (ctx) => ctx.drive(0, weak(direction === 'up' ? Level.L1 : Level.L0), 0),
  }),
});
