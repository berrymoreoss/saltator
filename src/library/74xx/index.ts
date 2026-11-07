/**
 * Real 74xx logic chips as DIP packages (ADR-0004), 74HC family from Nexperia data sheets.
 * See docs/components.md#74xx-chips-74xx.
 */
import type { AnyComponentDefinition } from '../../core';
import { hcBuffers } from './buffers';
import { hcDecoders } from './decoders';
import { hcGates } from './gates';
import { hcMultiplexers } from './multiplexers';
import { hc245 } from './transceiver';

export { BUFFER_SPECS, type BufferSpec, bufferChips } from './buffers';
export type { ChipSpec, ChipTiming, LogicFamily } from './chip';
export { DECODER_SPECS, type DecoderSpec, decoderChips } from './decoders';
export { GATE_SPECS, type GateSpec, gateChips } from './gates';
export { HC } from './hc-timing';
export { MUX_SPECS, type MuxSpec, muxChips } from './multiplexers';
export { TRANSCEIVER_SPEC, transceiverChip } from './transceiver';

/** Every 74xx chip in the default registry, by number. */
export const chips74xx: readonly AnyComponentDefinition[] = [
  ...hcGates,
  ...hcBuffers,
  hc245,
  ...hcDecoders,
  ...hcMultiplexers,
].sort((a, b) => Number(a.name.slice(4)) - Number(b.name.slice(4)));
