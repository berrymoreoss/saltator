/**
 * Memory chips (`mem/*`): EEPROMs read as ROMs, SRAMs. Spec: docs/components.md#memories-mem.
 */
import type { AnyComponentDefinition } from '../../core';
import { eeproms } from './eeproms';
import { srams } from './srams';

export { AT28C16, AT28C64B, AT28C256, EEPROM_MODES, eeproms } from './eeproms';
export {
  addressPinNames,
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
export {
  POWER_ON,
  SRAM_6116,
  SRAM_62256,
  type SramSpec,
  sramDefinition,
  sramModes,
  srams,
} from './srams';
export {
  createRamState,
  forEachCandidate,
  type RamState,
  WritePath,
  type WriteTiming,
} from './write';

/** Every memory chip, in the Parts panel's order. */
export const memories: readonly AnyComponentDefinition[] = [...eeproms, ...srams];
