import type { AnyComponentDefinition } from '../../core';
import { w65c02s } from './w65c02s';

export { CpuDiagnostic, type W65C02SState, w65c02s } from './w65c02s';
export {
  createCore as createW65C02SCore,
  endCycle as w65c02sEndCycle,
  Flag as W65C02SFlag,
  LostReason as W65C02SLostReason,
  loadRegisters as loadW65C02SRegisters,
  Mode as W65C02SMode,
  type W65C02SCore,
} from './w65c02s-core';
export {
  type AddressingMode,
  MODE_BYTES,
  type OpcodeInfo,
  W65C02S_OPCODES,
} from './w65c02s-opcodes';

/** All `cpu/*` parts, in palette order. */
export const cpus: readonly AnyComponentDefinition[] = [w65c02s];
