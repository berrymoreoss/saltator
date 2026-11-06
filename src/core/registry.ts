import { type AnyComponentDefinition, validatePins } from './component';

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

  /** Adds definitions. Throws on a malformed or duplicate type id, or invalid static pins. */
  register(...definitions: AnyComponentDefinition[]): this {
    for (const definition of definitions) {
      const { type } = definition;
      if (!TYPE_ID.test(type)) {
        throw new Error(`invalid type id "${type}" (expected "family/part", e.g. "prim/nand")`);
      }
      if (this.byType.has(type)) throw new Error(`duplicate component type "${type}"`);
      if (typeof definition.pins !== 'function') validatePins(definition.pins, type);
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
