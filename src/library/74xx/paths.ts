/**
 * Delays with several paths. MSI data sheets give one propagation delay per path (74HC138:
 * `An to Yn`, `E3 to Yn`, `En to Yn`); a chip lists its paths and asks for each output's delay
 * when it drives it. Spec: docs/components.md#74xx-chips-74xx.
 */
import {
  type EvalContext,
  isDriverPin,
  type PinDef,
  type PinRef,
  pinIndex,
  type Time,
} from '../../core';
import { delay, pinNames } from './chip';

/** One row of the data sheet's timing table: inputs → outputs with the delay of a timing symbol. */
export interface DelayPath {
  /** Comma-separated input pin names. */
  readonly from: string;
  /** Comma-separated output pin names. */
  readonly to: string;
  /** The timing symbol with its path, from the family's timing: `tpd(An-Yn)`. */
  readonly delay: string;
}

/** Output delays of a chip with several delay paths; see `pathDelays`. */
export interface PathDelays {
  /** The delay to drive `output` with in this evaluation. */
  delay(ctx: EvalContext<unknown>, output: PinRef): Time;
}

/**
 * Per output, the delay is the longest typical delay among the paths whose input changed in this
 * delta: the output settles after its slowest cause. With no input changed (the forced evaluation
 * at power-on or after a recompile), it is the output's longest path; re-driving a pending value
 * keeps it where it is (inertial model), so a carried-over simulation is unchanged.
 *
 * The paths are flattened into typed arrays, longest delay first per output, so `delay` scans
 * them without allocating. Throws at definition time if a driver pin has no path.
 */
export function pathDelays(
  pinList: readonly PinDef[],
  delays: Readonly<Record<string, Time>>,
  paths: readonly DelayPath[],
): PathDelays {
  // Per output pin: input → its longest delay to that output.
  const byOutput = pinList.map(() => new Map<PinRef, Time>());
  for (const path of paths) {
    const time = delay(delays, path.delay);
    for (const to of pinNames(path.to)) {
      const reached = byOutput[pinIndex(pinList, to)]!;
      for (const from of pinNames(path.from)) {
        const input = pinIndex(pinList, from);
        reached.set(input, Math.max(reached.get(input) ?? 0, time));
      }
    }
  }
  const starts = new Int32Array(pinList.length + 1);
  const inputs: PinRef[] = [];
  const times: Time[] = [];
  pinList.forEach((pin, output) => {
    const reached = [...byOutput[output]!].sort((a, b) => b[1] - a[1]);
    if (isDriverPin(pin.dir) && reached.length === 0)
      throw new Error(`no delay path to pin ${pin.name}`);
    for (const [input, time] of reached) {
      inputs.push(input);
      times.push(time);
    }
    starts[output + 1] = inputs.length;
  });
  const fromPins = Int32Array.from(inputs);
  const delayTimes = Float64Array.from(times);

  return {
    delay(ctx, output) {
      const start = starts[output]!;
      const end = starts[output + 1]!;
      for (let i = start; i < end; i++) {
        if (ctx.changed(fromPins[i]!)) return delayTimes[i]!;
      }
      return delayTimes[start]!;
    },
  };
}
