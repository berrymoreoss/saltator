/**
 * Public API of the circuit document model: document types, JSON loading and saving, part layouts,
 * connectivity, the netlist compiler with design checks, and a code-first builder.
 * Spec: docs/circuit.md.
 */

export {
  type BenchFailure,
  type BenchLog,
  type BenchOptions,
  type BenchReport,
  type BenchStatus,
  CircuitBench,
  DEFAULT_STEP,
} from './bench/bench';
export { functionScriptHost } from './bench/function-host';
export {
  type BenchEntry,
  type BenchResult,
  benchApi,
  loadTestScript,
  type RunOptions,
  runBench,
  runTestScript,
  type ScriptHost,
  scriptSource,
  type TestScript,
} from './bench/script';
export {
  type BenchRequest,
  type BenchResponse,
  type BenchService,
  benchService,
  type PlannedBench,
  type RunTarget,
} from './bench/service';
export { BenchError } from './bench/values';
export { CircuitBuilder, type PlaceOptions, type WirePoint } from './builder';
export type {
  CircuitBus,
  CircuitNet,
  DesignIssue,
  DesignIssueCode,
  PlacedPin,
} from './checks';
export { type CompileResult, compileCircuit, compileDocument } from './compile';
export { type Connectivity, connect, type WireEnd, type WireSegment } from './connectivity';
export {
  type CircuitIssue,
  CompileCache,
  compileDesign,
  type Design,
  type DesignInstance,
  type DesignOptions,
  recursiveInstances,
} from './design';
export {
  CIRCUIT_ID,
  type Circuit,
  type CircuitDocument,
  type ComponentInstance,
  circuitIdFor,
  emptyCircuit,
  emptyDocument,
  type GroupProbe,
  ID_PATTERN,
  isGroupProbe,
  PROBE_RADIXES,
  type Probe,
  type ProbeRadix,
  SCHEMA_VERSION,
  type SignalProbe,
  scriptLines,
  type Wire,
} from './document';
export {
  addCircuit,
  circuitsContaining,
  circuitUses,
  duplicateCircuit,
  fragmentDocument,
  importCircuits,
  placementsOf,
  removeCircuit,
  renameCircuit,
  renamePartInDocument,
  replaceCircuit,
  setTopCircuit,
} from './document-edit';
export {
  addComponents,
  addWires,
  type ComponentPatch,
  circuitIds,
  copyFragment,
  designatorError,
  IdAllocator,
  type ItemIds,
  nextDesignator,
  normalizeWires,
  type PasteResult,
  pasteFragment,
  prefixOfType,
  removeItems,
  renameComponent,
  renameInProbes,
  renameReference,
  sameCircuit,
  sameDocument,
  sameProbes,
  translateCircuit,
  updateComponent,
  WIRE_PREFIX,
} from './edit';
export {
  COORD_LIMIT,
  comparePoints,
  inSegmentInterior,
  inverseTransformPoint,
  isAxisAligned,
  isRotation,
  type Placement,
  type Point,
  pointKey,
  pointOfKey,
  type Rect,
  ROTATIONS,
  type Rotation,
  type Side,
  samePoint,
  transformPoint,
  transformRect,
  transformSide,
} from './geometry';
export {
  dipBodyWidth,
  type PartLayout,
  type PinLayout,
  partLayout,
  placementOf,
  placePins,
} from './layout';
export {
  MIGRATIONS,
  type Migration,
  type Migrations,
  migrate,
  type RawDocument,
} from './migrations';
export {
  compareDesignators,
  type MemoryPart,
  type ProbeTarget,
  parseAddress,
  Resolver,
  type Target,
} from './resolve';
export { DocumentError, type LoadOptions, loadDocument, parseDocument } from './schema';
export { serializeDocument } from './serialize';
export {
  type CircuitPort,
  circuitPorts,
  DocumentRegistry,
  documentRegistry,
  SUBCIRCUIT_FAMILY,
  SUBCIRCUIT_PIN_FONT,
  SUBCIRCUIT_PREFIX,
  SUBCIRCUIT_TITLE_FONT,
  subcircuitDefinition,
  subcircuitOf,
  subcircuitRoom,
  subcircuitType,
} from './subcircuit';
