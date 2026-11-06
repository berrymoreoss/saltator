/**
 * Public API of the simulation kernel (signal model, scheduler, netlist runtime, component API).
 * Spec: docs/simulation.md.
 */

export {
  type AnyComponentDefinition,
  type Behavior,
  type ComponentDefinition,
  DEFAULT_DESIGNATOR_PREFIX,
  DESIGNATOR_PREFIX,
  defineComponent,
  designatorPrefixOf,
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
export {
  type ComponentDiagnostic,
  type Diagnostic,
  type DiagnosticInput,
  DiagnosticLog,
  KernelDiagnosticKind,
} from './diagnostics';
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
  sameNetlistStructure,
} from './netlist';
export { type ComponentRegistry, familyOf, Registry } from './registry';
export {
  type CarriedComponent,
  type CarriedEvent,
  type NetChangeListener,
  type RunOptions,
  type RunStatus,
  type SettleOptions,
  Simulator,
  type SimulatorCarry,
  type SimulatorOptions,
  type SimulatorStats,
} from './simulator';
export {
  PIN_SIDES,
  type PinSide,
  type SymbolDef,
  type SymbolPin,
  symbolOf,
  validateSymbol,
} from './symbol';
export { formatTime, ms, ns, parseTime, ps, TIME_MAX, type Time, us } from './time';
