import { Drive, defineComponent, Level, strong, toInput } from '../../core';
import { delayProp } from './gates';

const A = 0;
const EN = 1;
const Y = 2;

/**
 * Tri-state buffer with an active-high enable: EN = 1 → Y = A; EN = 0 → Y released (Z);
 * EN unknown or floating → Y = X (it might be driving, so a bus reads unknown).
 */
export const tristateBuffer = defineComponent<{ delay: number }, undefined>({
  type: 'prim/tristate-buffer',
  name: 'TRI',
  title: 'Tri-state buffer',
  keywords: ['tristate', 'tri-state', 'three-state', 'buffer', 'bus', 'enable', 'high impedance'],
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'EN', dir: 'in' },
    { name: 'Y', dir: 'tristate' },
  ],
  // A triangle with the enable entering from below.
  symbol: {
    kind: 'tristate-buffer',
    width: 4,
    height: 2,
    pins: {
      A: { side: 'left', offset: 1 },
      EN: { side: 'bottom', offset: 2 },
      Y: { side: 'right', offset: 1 },
    },
  },
  props: [delayProp],
  create: ({ delay }) => ({
    evaluate(ctx) {
      const enable = ctx.read(EN);
      const drive =
        enable === Level.L1
          ? strong(toInput(ctx.read(A)))
          : enable === Level.L0
            ? Drive.Z
            : Drive.STRONG_X;
      ctx.drive(Y, drive, delay);
    },
  }),
});
