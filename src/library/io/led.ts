import { defineComponent, type PinDef } from '../../core';
import {
  createLights,
  type LedColor,
  type LightsState,
  ledColorProp,
  ledLight,
  setLight,
} from './lights';

/**
 * Light-emitting diode: lit while the anode `A` is 1 and the cathode `K` is 0, so it can be driven
 * from an output (cathode to GND) or sunk by an active-low output (anode to VCC). Both pins only
 * observe their nets (`sense`): an LED on a floating net is dark, not a floating CMOS input. The
 * series resistor is implied. State: `LightsState` with one light.
 */
export const led = defineComponent<{ color: LedColor }, LightsState>({
  type: 'io/led',
  name: 'LED',
  title: 'LED',
  keywords: ['led', 'light', 'diode', 'lamp', 'indicator', 'output'],
  props: [ledColorProp],
  pins: [
    { name: 'A', dir: 'in', sense: true },
    { name: 'K', dir: 'in', sense: true },
  ],
  symbol: {
    kind: 'led',
    width: 2,
    height: 2,
    pins: { A: { side: 'left', offset: 1 }, K: { side: 'right', offset: 1 } },
  },
  create: () => ({
    createState: () => createLights(1),
    evaluate: (ctx) => setLight(ctx.state, 0, ledLight(ctx.read(0), ctx.read(1)), ctx.now),
  }),
});

export const MAX_LED_BAR = 12;

/**
 * LED bar graph: `count` separate LEDs stacked vertically, anodes `A1`…`An` on the left and
 * cathodes `K1`…`Kn` on the right, like the DIP-style bar graph parts. Light i is LED i + 1.
 */
export const ledBar = defineComponent<{ count: number; color: LedColor }, LightsState>({
  type: 'io/led-bar',
  name: 'BAR',
  title: 'LED bar graph',
  keywords: ['led', 'bar', 'graph', 'array', 'light', 'indicator', 'output'],
  props: [
    { key: 'count', label: 'LEDs', type: 'integer', default: 10, min: 1, max: MAX_LED_BAR },
    ledColorProp,
  ],
  pins: ({ count }) => [
    ...Array.from(
      { length: count },
      (_, i): PinDef => ({ name: `A${i + 1}`, dir: 'in', sense: true }),
    ),
    ...Array.from(
      { length: count },
      (_, i): PinDef => ({ name: `K${i + 1}`, dir: 'in', sense: true }),
    ),
  ],
  symbol: ({ count }) => ({
    kind: 'led-bar',
    width: 2,
    height: count + 1,
    pins: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        [`A${i + 1}`, { side: 'left', offset: i + 1 }],
        [`K${i + 1}`, { side: 'right', offset: i + 1 }],
      ]).flat(),
    ),
  }),
  create: ({ count }) => ({
    createState: () => createLights(count),
    evaluate(ctx) {
      for (let i = 0; i < count; i++) {
        setLight(ctx.state, i, ledLight(ctx.read(i), ctx.read(count + i)), ctx.now);
      }
    },
  }),
});
