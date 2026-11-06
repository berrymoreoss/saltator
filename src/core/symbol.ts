/**
 * Symbol geometry: how a part without a package is drawn, as data. The library describes where
 * the body is and where each pin sticks out; the editor maps `kind` to a drawing function, and
 * `src/circuit`'s `partLayout` turns the geometry into connection points.
 * Spec: docs/components.md#symbols.
 */
import type { AnyComponentDefinition, PinDef, PropValue } from './component';

/** Side of a part's body a pin sticks out of. */
export type PinSide = 'left' | 'top' | 'right' | 'bottom';

export const PIN_SIDES: readonly PinSide[] = ['left', 'top', 'right', 'bottom'];

/** Where one pin sits on a symbol's body. */
export interface SymbolPin {
  readonly side: PinSide;
  /**
   * Grid cells along the side from the body's top edge (`left`/`right` sides) or left edge
   * (`top`/`bottom` sides): 0 … height or 0 … width.
   */
  readonly offset: number;
}

export interface SymbolDef {
  /** Drawing function in the editor: `led`, `switch`, `gate-and`, … (unknown kinds: a box). */
  readonly kind: string;
  /** Body size in grid cells, pin stubs excluded. */
  readonly width: number;
  readonly height: number;
  /** Placement of every pin of the part (power and nc pins too), by pin name. */
  readonly pins: Readonly<Record<string, SymbolPin>>;
}

/** The symbol of an instance with the given (resolved) props, or `undefined` if it has none. */
export function symbolOf(
  definition: AnyComponentDefinition,
  props: Readonly<Record<string, PropValue>>,
): SymbolDef | undefined {
  const { symbol } = definition;
  return typeof symbol === 'function' ? symbol(props) : symbol;
}

/**
 * Throws unless the symbol has a positive integer size and places every pin exactly once, on its
 * body's edge, with no two pins on the same point. `where` prefixes the message.
 */
export function validateSymbol(symbol: SymbolDef, pins: readonly PinDef[], where: string): void {
  const { kind, width, height } = symbol;
  if (kind === '') throw new Error(`${where}: empty symbol kind`);
  for (const [name, size] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (!Number.isInteger(size) || size < 1) {
      throw new Error(`${where}: symbol ${name} must be a positive integer, got ${size}`);
    }
  }
  const names = new Set(pins.map((p) => p.name));
  for (const name of Object.keys(symbol.pins)) {
    if (!names.has(name)) throw new Error(`${where}: symbol places unknown pin "${name}"`);
  }
  const taken = new Map<string, string>();
  for (const { name } of pins) {
    const place = symbol.pins[name];
    if (place === undefined) throw new Error(`${where}: symbol does not place pin "${name}"`);
    const { side, offset } = place;
    if (!PIN_SIDES.includes(side)) {
      throw new Error(`${where}: pin "${name}" has an invalid side ${JSON.stringify(side)}`);
    }
    const length = side === 'left' || side === 'right' ? height : width;
    if (!Number.isInteger(offset) || offset < 0 || offset > length) {
      throw new Error(
        `${where}: pin "${name}" offset must be an integer 0…${length} on the ${side} side, got ${offset}`,
      );
    }
    const key = `${side}:${offset}`;
    const other = taken.get(key);
    if (other !== undefined) {
      throw new Error(`${where}: pins "${other}" and "${name}" are on the same point`);
    }
    taken.set(key, name);
  }
}
