/**
 * Public API of the simulation kernel (signal model, scheduler, netlist runtime, component API).
 * Spec: docs/simulation.md.
 */

export {
  type AnyComponentDefinition,
  type Behavior,
  type ComponentDefinition,
  defineComponent,
  type EvalContext,
  isDriverPin,
  isReadPin,
  type PackageDef,
  type PinDef,
  type PinDir,
  type PinRef,
  type PropDef,
  type PropValue,
  pinIndex,
  pinsOf,
  resolveProps,
  type TimingDef,
  type UnitDef,
} from './component';
export { type ComponentDiagnostic, type Diagnostic, KernelDiagnosticKind } from './diagnostics';
export {
  and,
  DRIVES,
  Drive,
  driveName,
  isContention,
  LEVELS,
  Level,
  levelChar,
  levelOf,
  not,
  or,
  resolve,
  Strength,
  strengthOf,
  strong,
  toInput,
  weak,
  xor,
} from './logic';
export {
  type Netlist,
  NetlistBuilder,
  type NetlistComponent,
  NetlistError,
  type NetlistNet,
  type NetlistPin,
  type PinSpec,
  type ResolvedComponent,
  type ResolvedNet,
  type ResolvedNetlist,
  type ResolvedPin,
  resolveNetlist,
} from './netlist';
export { type ComponentRegistry, familyOf, Registry } from './registry';
export { formatTime, ms, ns, ps, TIME_MAX, type Time, us } from './time';
