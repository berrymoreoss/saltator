import {
  type AnyComponentDefinition,
  DESIGNATOR_PREFIX,
  pinsOf,
  resolveProps,
  validatePins,
} from './component';
import { validateFunctionTable } from './function-table';
import { symbolOf, validateSymbol } from './symbol';

/**
 * Read access to part definitions by type id. The simulator and the circuit compiler depend on
 * this interface; the library provides the populated instance (`createDefaultRegistry()`).
 */
export interface ComponentRegistry {
  get(type: string): AnyComponentDefinition | undefined;
  has(type: string): boolean;
  /** All definitions, in registration order. */
  list(): readonly AnyComponentDefinition[];
}

/** `family/part`: lowercase letters, digits and dashes, e.g. `74xx/74hc00`, `prim/tristate-buffer`. */
const TYPE_ID = /^[a-z0-9]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Family part of a type id: `familyOf('74xx/74hc00')` → `'74xx'`. */
export function familyOf(type: string): string {
  return type.slice(0, type.indexOf('/'));
}

/** A registry that definitions can be added to. */
export class Registry implements ComponentRegistry {
  private readonly byType = new Map<string, AnyComponentDefinition>();

  constructor(definitions: Iterable<AnyComponentDefinition> = []) {
    this.register(...definitions);
  }

  /**
   * Adds definitions. Throws on a malformed or duplicate type id, a malformed designator prefix,
   * a malformed function table or memory size, an `image` prop without a size, or on invalid
   * pins or symbol with the default props
   * (prop-dependent ones are checked again when instances are laid out).
   */
  register(...definitions: AnyComponentDefinition[]): this {
    for (const definition of definitions) {
      const { type } = definition;
      if (!TYPE_ID.test(type)) {
        throw new Error(`invalid type id "${type}" (expected "family/part", e.g. "prim/nand")`);
      }
      if (this.byType.has(type)) throw new Error(`duplicate component type "${type}"`);
      const prefix = definition.designatorPrefix;
      if (prefix !== undefined && !DESIGNATOR_PREFIX.test(prefix)) {
        throw new Error(`${type}: invalid designator prefix "${prefix}" (expected A–Z letters)`);
      }
      const props = resolveProps(definition);
      const pins = pinsOf(definition, props);
      validatePins(pins, type);
      const symbol = symbolOf(definition, props);
      if (symbol) validateSymbol(symbol, pins, type);
      if (definition.functionTable) validateFunctionTable(definition.functionTable, type);
      validateMemory(definition);
      this.byType.set(type, definition);
    }
    return this;
  }

  get(type: string): AnyComponentDefinition | undefined {
    return this.byType.get(type);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  list(): readonly AnyComponentDefinition[] {
    return [...this.byType.values()];
  }
}

/**
 * A memory part's size must be whole words of 1–8 bits; an `image` prop needs its size in bytes
 * (`max`), the memory's word count when the part has one.
 */
function validateMemory(definition: AnyComponentDefinition): void {
  const { type, memory } = definition;
  if (memory) {
    if (!Number.isInteger(memory.words) || memory.words < 1) {
      throw new Error(`${type}: memory words must be a positive integer, got ${memory.words}`);
    }
    if (!Number.isInteger(memory.width) || memory.width < 1 || memory.width > 8) {
      throw new Error(`${type}: memory width must be 1 to 8 bits, got ${memory.width}`);
    }
  }
  for (const prop of definition.props ?? []) {
    if (prop.type !== 'image') continue;
    if (prop.max === undefined || !Number.isInteger(prop.max) || prop.max < 1) {
      throw new Error(`${type}: image prop "${prop.key}" needs its size in bytes as max`);
    }
    if (memory && prop.max !== memory.words) {
      throw new Error(
        `${type}: image prop "${prop.key}" holds ${prop.max} bytes, the memory ${memory.words} words`,
      );
    }
  }
}
