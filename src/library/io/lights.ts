/**
 * Lights of indicators (LEDs, LED bars, 7-segment displays): what each light shows now, and for
 * how long it has been on, so a renderer can show a multiplexed display or an LED on a fast clock
 * at its real average brightness instead of sampling random frames.
 */
import { Level, type PropDef, type Time } from '../../core';

/** What a light shows. */
export const Light = { OFF: 0, ON: 1, UNKNOWN: 2 } as const;
export type Light = (typeof Light)[keyof typeof Light];

/**
 * An LED lights with forward bias: anode 1, cathode 0. A floating (`Z`) side carries no current,
 * so it is off; it is unknown only when an `X` could still mean forward bias.
 */
export function ledLight(anode: Level, cathode: Level): Light {
  if (anode === Level.L1 && cathode === Level.L0) return Light.ON;
  if (anode === Level.L0 || anode === Level.Z || cathode === Level.L1 || cathode === Level.Z) {
    return Light.OFF;
  }
  return Light.UNKNOWN;
}

/** State of an indicator's lights; plain typed arrays (structured-clone-able). */
export interface LightsState {
  /** What each light shows now (`Light`). */
  readonly light: Uint8Array;
  /** When each light last changed. */
  readonly since: Float64Array;
  /** How long each light was on before `since`. */
  readonly onTime: Float64Array;
}

/** `count` lights, off since t = 0. */
export function createLights(count: number): LightsState {
  return {
    light: new Uint8Array(count),
    since: new Float64Array(count),
    onTime: new Float64Array(count),
  };
}

/** Records what light `i` shows from `now` on. */
export function setLight(state: LightsState, i: number, light: Light, now: Time): void {
  const before = state.light[i]!;
  if (before === light) return;
  if (before === Light.ON) state.onTime[i]! += now - state.since[i]!;
  state.light[i] = light;
  state.since[i] = now;
}

/**
 * Total time light `i` has been on up to `now` (not before its last change: sample as time
 * passes). Average brightness over a frame from `t0` to `t1` is
 * `(onTimeAt(s, i, t1) − onTimeAt(s, i, t0)) / (t1 − t0)`, with the first value taken at `t0`.
 */
export function onTimeAt(state: LightsState, i: number, now: Time): Time {
  const on = state.light[i] === Light.ON ? now - state.since[i]! : 0;
  return state.onTime[i]! + on;
}

export const LED_COLORS = ['red', 'green', 'yellow', 'orange', 'blue', 'white'] as const;
export type LedColor = (typeof LED_COLORS)[number];

/** Color of an LED or display: real LED colors rather than arbitrary CSS (and a BOM line later). */
export const ledColorProp: PropDef = {
  key: 'color',
  label: 'Color',
  type: 'enum',
  default: 'red',
  options: LED_COLORS.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
};
