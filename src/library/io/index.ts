import type { AnyComponentDefinition } from '../../core';
import { gnd, vcc } from './rails';

export { gnd, vcc } from './rails';

/** All `io/*` parts, in palette order. */
export const io: readonly AnyComponentDefinition[] = [vcc, gnd];
