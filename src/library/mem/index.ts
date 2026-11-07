/**
 * Memory chips (`mem/*`): EEPROMs read as ROMs, SRAMs. Spec: docs/components.md#memories-mem.
 */
import type { AnyComponentDefinition } from '../../core';
import { eeproms } from './eeproms';

export { AT28C16, AT28C64B, AT28C256, EEPROM_MODES, eeproms } from './eeproms';
export {
  createMemoryState,
  enabledByLow,
  MemoryDiagnosticKind,
  type MemoryPins,
  type MemoryState,
  memoryPins,
  ReadPath,
  type ReadTiming,
  withDataLabels,
} from './memory';

/** Every memory chip, in the Parts panel's order. */
export const memories: readonly AnyComponentDefinition[] = [...eeproms];
