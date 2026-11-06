import { defineComponent, Level, weak } from '../../core';

/**
 * Pull-up / pull-down resistor: drives its net weakly to 1 / 0, so any strong driver (an output,
 * a pressed button) overrides it, and a released bus reads a defined level instead of floating.
 * The resistor's value is implied; its other end goes to the rail drawn with the symbol.
 */
export const pull = defineComponent<{ direction: 'up' | 'down' }, undefined>({
  type: 'prim/pull',
  name: 'PULL',
  title: 'Pull-up / pull-down resistor',
  keywords: ['pull', 'pull-up', 'pull-down', 'resistor', 'weak'],
  designatorPrefix: 'R',
  pins: [{ name: 'Y', dir: 'out', weak: true }],
  // A resistor to its rail: VCC above and the pin below for a pull-up, the other way round down.
  symbol: ({ direction }) => ({
    kind: `pull-${direction}`,
    width: 2,
    height: 3,
    pins: { Y: { side: direction === 'up' ? 'bottom' : 'top', offset: 1 } },
  }),
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
