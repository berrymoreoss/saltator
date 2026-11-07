/**
 * Real 74xx logic chips as DIP packages (ADR-0004), 74HC family from Nexperia data sheets.
 * See docs/components.md#74xx-chips-74xx.
 */
import type { AnyComponentDefinition } from '../../core';
import { hcArithmetic } from './arithmetic';
import { hcBuffers } from './buffers';
import { hcCounters } from './counters';
import { hcDecoders } from './decoders';
import { hcEncoders } from './encoders';
import { hcFlipFlops } from './flip-flops';
import { hcGates } from './gates';
import { hcMultiplexers } from './multiplexers';
import { hcRegisters } from './registers';
import { hc4511 } from './seven-segment-decoder';
import { hc245 } from './transceiver';

export { ADDER_SPEC, arithmeticChips, COMPARATOR_SPEC } from './arithmetic';
export { BUFFER_SPECS, type BufferSpec, bufferChips } from './buffers';
export type { ChipSpec, ChipTiming, LogicFamily } from './chip';
export {
  CNT161_SPEC,
  CNT163_SPEC,
  COUNTER_SPECS,
  type CounterState,
  counterChips,
  type SyncCounterSpec,
} from './counters';
export { DECODER_SPECS, type DecoderSpec, decoderChips } from './decoders';
export { ENCODER147_SPEC, ENCODER148_SPEC, encoderChips } from './encoders';
export {
  FF74_SPEC,
  FF107_SPEC,
  FF109_SPEC,
  FF112_SPEC,
  FLIP_FLOP_SPECS,
  type FlipFlopSpec,
  type FlipFlopState,
  flipFlopChips,
} from './flip-flops';
export { GATE_SPECS, type GateSpec, gateChips } from './gates';
export { HC } from './hc-timing';
export { MUX_SPECS, type MuxSpec, muxChips } from './multiplexers';
export {
  REG173_SPEC,
  REG175_SPEC,
  REG273_SPEC,
  REG374_SPEC,
  REG377_SPEC,
  REG574_SPEC,
  REGISTER_SPECS,
  type RegisterSpec,
  type RegisterState,
  registerChips,
} from './registers';
export {
  BCD_DECODER_SPEC,
  type BcdDecoderState,
  bcdDecoderChip,
} from './seven-segment-decoder';
export { TRANSCEIVER_SPEC, transceiverChip } from './transceiver';

/** Every 74xx chip in the default registry, by number. */
export const chips74xx: readonly AnyComponentDefinition[] = [
  ...hcGates,
  ...hcBuffers,
  hc245,
  ...hcDecoders,
  ...hcMultiplexers,
  ...hcArithmetic,
  ...hcEncoders,
  hc4511,
  ...hcFlipFlops,
  ...hcRegisters,
  ...hcCounters,
].sort((a, b) => Number(a.name.slice(4)) - Number(b.name.slice(4)));
