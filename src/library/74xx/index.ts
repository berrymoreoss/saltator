/**
 * Real 74xx logic chips as DIP packages (ADR-0004), 74HC family from Nexperia data sheets.
 * See docs/components.md#74xx-chips.
 */
import type { AnyComponentDefinition } from '../../core';
import { hcBuffers } from './buffers';
import { hcGates } from './gates';
import { hc245 } from './transceiver';

export { BUFFER_SPECS, type BufferSpec, bufferChips } from './buffers';
export type { ChipSpec, ChipTiming, LogicFamily } from './chip';
export { GATE_SPECS, type GateSpec, gateChips } from './gates';
export { HC } from './hc-timing';
export { TRANSCEIVER_SPEC, transceiverChip } from './transceiver';

/** Every 74xx chip in the default registry, by number. */
export const chips74xx: readonly AnyComponentDefinition[] = [...hcGates, ...hcBuffers, hc245].sort(
  (a, b) => Number(a.name.slice(4)) - Number(b.name.slice(4)),
);
