import { Drive, defineComponent, type Time } from '../../core';
import { actionOf, badAction } from './contact';

/** Actions `io/clock` accepts: `step` emits one pulse in manual mode (ignored in auto mode). */
export type ClockAction = { readonly type: 'step' };

/** State of an `io/clock`: whether the output is in its high phase (a pulse is under way). */
export interface ClockState {
  high: boolean;
}

type Props = { frequency: number; duty: number; mode: 'auto' | 'manual' };

/** Wake tokens: the output went high / low at this instant; the next edge is scheduled then. */
const HIGH = 1;
const LOW = 2;

/**
 * High and low time of a clock in picoseconds: period = round(10¹² / frequency), high =
 * round(period × duty / 100). The prop limits (≤ 1 GHz, duty 1–99 %) keep both phases ≥ 10 ps.
 */
export function clockPhases(frequency: number, duty: number): { high: Time; low: Time } {
  const period = Math.round(1e12 / frequency);
  const high = Math.round((period * duty) / 100);
  return { high, low: period - high };
}

/**
 * Ideal clock generator. Starts low at power-on; in `auto` mode the first rising edge comes after
 * the low time, then it runs freely. In `manual` mode it stays low and each `step` action emits
 * one pulse of the high time (like the single-step button of a breadboard clock module).
 *
 * Each edge is a change scheduled on the output a phase ahead (with a timer at the edge that
 * schedules the next one), not a zero-delay drive at a timer: so the kernel sees the next edge
 * coming (`stopBefore`, the debugger's Step Clock).
 */
export const clock = defineComponent<Props, ClockState>({
  type: 'io/clock',
  name: 'CLK',
  title: 'Clock generator',
  keywords: ['clock', 'oscillator', 'square wave', 'pulse', 'step', 'timer', 'input'],
  designatorPrefix: 'X',
  props: [
    {
      key: 'frequency',
      label: 'Frequency',
      type: 'number',
      default: 1,
      min: 0.001,
      max: 1e9,
      unit: 'Hz',
      si: true,
    },
    { key: 'duty', label: 'Duty cycle', type: 'number', default: 50, min: 1, max: 99, unit: '%' },
    {
      key: 'mode',
      label: 'Mode',
      type: 'enum',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Free-running' },
        { value: 'manual', label: 'Manual: one pulse per step' },
      ],
    },
  ],
  pins: [{ name: 'Y', dir: 'out' }],
  symbol: { kind: 'clock', width: 3, height: 2, pins: { Y: { side: 'right', offset: 1 } } },
  create: ({ frequency, duty, mode }) => {
    const { high, low } = clockPhases(frequency, duty);
    const auto = mode === 'auto';
    return {
      createState: () => ({ high: false }),
      init(ctx) {
        ctx.drive(0, Drive.STRONG_0, 0);
        if (auto) ctx.wakeAfter(0, LOW); // schedules the first rising edge once it is low
      },
      wake(ctx, token) {
        ctx.state.high = token === HIGH;
        // The output changed at this instant (the drive lands before timers run): the next edge.
        if (ctx.state.high) {
          ctx.drive(0, Drive.STRONG_0, high);
          ctx.wakeAfter(high, LOW);
        } else if (auto) {
          ctx.drive(0, Drive.STRONG_1, low);
          ctx.wakeAfter(low, HIGH);
        }
      },
      action(ctx, payload) {
        if (actionOf(ctx.id, payload).type !== 'step') throw badAction(ctx.id, payload);
        if (auto || ctx.state.high) return; // free-running, or a pulse is already under way
        ctx.state.high = true;
        ctx.drive(0, Drive.STRONG_1, 0);
        ctx.wakeAfter(0, HIGH); // schedules the falling edge once it is high
      },
    };
  },
});
