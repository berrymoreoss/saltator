import type { AnyComponentDefinition } from '../../core';
import { constant } from './constant';
import { andGate, buffer, inverter, nandGate, norGate, orGate, xnorGate, xorGate } from './gates';
import { pull } from './pull';
import { tristateBuffer } from './tristate-buffer';

export { constant } from './constant';
export {
  andGate,
  buffer,
  gatePins,
  inverter,
  MAX_GATE_INPUTS,
  MIN_GATE_INPUTS,
  nandGate,
  norGate,
  orGate,
  PRIM_DEFAULT_DELAY,
  xnorGate,
  xorGate,
} from './gates';
export { pull } from './pull';
export { tristateBuffer } from './tristate-buffer';

/** All `prim/*` parts, in palette order. */
export const primitives: readonly AnyComponentDefinition[] = [
  buffer,
  inverter,
  andGate,
  orGate,
  nandGate,
  norGate,
  xorGate,
  xnorGate,
  tristateBuffer,
  constant,
  pull,
];
