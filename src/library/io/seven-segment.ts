import { defineComponent, type PinDef } from '../../core';
import {
  createLights,
  type LedColor,
  type LightsState,
  ledColorProp,
  ledLight,
  setLight,
} from './lights';

/** Segment pins in light order: light i of the state is segment `SEGMENTS[i]`. */
export const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const;

const COM = SEGMENTS.length; // pin index of COM

/**
 * Single-digit 7-segment LED display with decimal point. Each segment is an LED between its pin
 * and the common pin `COM`: common cathode — lit while the segment is 1 and COM is 0; common anode
 * — lit while the segment is 0 and COM is 1. Driving COM from an output multiplexes digits; the
 * lights' on-time gives their average brightness. The real part's two COM pins are one pin here.
 */
export const sevenSegment = defineComponent<
  { common: 'cathode' | 'anode'; color: LedColor },
  LightsState
>({
  type: 'io/seven-segment',
  name: '7SEG',
  title: '7-segment display',
  keywords: [
    '7-segment',
    'seven segment',
    'display',
    'digit',
    'led',
    'common anode',
    'common cathode',
  ],
  designatorPrefix: 'DS',
  props: [
    {
      key: 'common',
      label: 'Common',
      type: 'enum',
      default: 'cathode',
      options: [
        { value: 'cathode', label: 'Common cathode (segment lit on 1)' },
        { value: 'anode', label: 'Common anode (segment lit on 0)' },
      ],
    },
    ledColorProp,
  ],
  pins: [
    ...SEGMENTS.map((name): PinDef => ({ name, dir: 'in', sense: true })),
    { name: 'COM', dir: 'in', sense: true },
  ],
  // Pins where the common 0.56" single-digit part has them: top g f COM a b, bottom e d (COM) c dp.
  symbol: {
    kind: 'seven-segment',
    width: 6,
    height: 7,
    pins: {
      g: { side: 'top', offset: 1 },
      f: { side: 'top', offset: 2 },
      COM: { side: 'top', offset: 3 },
      a: { side: 'top', offset: 4 },
      b: { side: 'top', offset: 5 },
      e: { side: 'bottom', offset: 1 },
      d: { side: 'bottom', offset: 2 },
      c: { side: 'bottom', offset: 4 },
      dp: { side: 'bottom', offset: 5 },
    },
  },
  create: ({ common }) => ({
    createState: () => createLights(SEGMENTS.length),
    evaluate(ctx) {
      const com = ctx.read(COM);
      for (let i = 0; i < COM; i++) {
        const segment = ctx.read(i);
        const light = common === 'cathode' ? ledLight(segment, com) : ledLight(com, segment);
        setLight(ctx.state, i, light, ctx.now);
      }
    },
  }),
});
