/**
 * Part layouts: where each pin of a part connects, in local grid coordinates, and where it lands
 * once the part is placed. Shared by the compiler (connectivity) and the editor (drawing,
 * hit-testing), so both always agree. Spec: docs/circuit.md#part-layouts.
 *
 * Every layout has its local origin at the top-left corner of its bounding box (pin stubs
 * included); pins stick out of the body by one cell and connect at the stub's tip.
 */
import {
  type AnyComponentDefinition,
  type PinDef,
  type PropValue,
  pinsOf,
  type SymbolDef,
  symbolOf,
  validateSymbol,
} from '../core';
import type { ComponentInstance } from './document';
import {
  type Placement,
  type Point,
  type Rect,
  type Side,
  transformPoint,
  transformSide,
} from './geometry';

export interface PinLayout {
  readonly name: string;
  /** Connection point (tip of the pin stub). */
  readonly at: Point;
  /** Side of the body the pin sticks out of. */
  readonly side: Side;
}

export interface PartLayout {
  /** The part's body, without pin stubs. */
  readonly body: Rect;
  /** One entry per pin, in the definition's pin order. */
  readonly pins: readonly PinLayout[];
}

/** DIP body width in cells: narrow (0.3") packages up to 20 pins, wide (0.6") above. */
export function dipBodyWidth(pinCount: number): number {
  return pinCount <= 20 ? 4 : 6;
}

/**
 * Layout of a part with the given (resolved) props: a DIP drawing for parts with a `package`
 * (chips are drawn as packages, ADR-0004), the part's `symbol` otherwise, and a generic box for
 * parts with neither. Throws if a package or symbol definition is inconsistent (a library bug).
 */
export function partLayout(
  definition: AnyComponentDefinition,
  props: Readonly<Record<string, PropValue>>,
): PartLayout {
  const pins = pinsOf(definition, props);
  if (definition.package) return dipLayout(definition.type, definition.package.pins, pins);
  const symbol = symbolOf(definition, props);
  if (symbol) return symbolLayout(definition.type, symbol, pins);
  return boxLayout(pins);
}

/**
 * A symbol's body with a one-cell margin for the pin stubs on each side that has pins; the
 * origin stays at the top-left of the bounding box, as for the other layouts.
 */
function symbolLayout(type: string, symbol: SymbolDef, pins: readonly PinDef[]): PartLayout {
  validateSymbol(symbol, pins, type);
  const used = new Set(pins.map((pin) => symbol.pins[pin.name]!.side));
  const left = used.has('left') ? 1 : 0;
  const top = used.has('top') ? 1 : 0;
  const { width, height } = symbol;
  const tip = (side: Side, offset: number): Point => {
    switch (side) {
      case 'left':
        return [0, top + offset];
      case 'right':
        return [left + width + 1, top + offset];
      case 'top':
        return [left + offset, 0];
      case 'bottom':
        return [left + offset, top + height + 1];
    }
  };
  const layout = pins.map((pin): PinLayout => {
    const { side, offset } = symbol.pins[pin.name]!;
    return { name: pin.name, at: tip(side, offset), side };
  });
  return { body: { x: left, y: top, width, height }, pins: layout };
}

/**
 * Vertical DIP, notch up, as drawn in datasheets: pins 1…N/2 down the left side, N/2+1…N up the
 * right side (pin N top-right). Pin pitch is one cell.
 */
function dipLayout(type: string, count: number, pins: readonly PinDef[]): PartLayout {
  if (count < 2 || count % 2 !== 0) throw new Error(`${type}: a DIP needs an even pin count`);
  if (pins.length !== count) {
    throw new Error(`${type}: DIP-${count} package but ${pins.length} pins defined`);
  }
  const rows = count / 2;
  const width = dipBodyWidth(count);
  const seen = new Set<number>();
  const layout = pins.map((pin): PinLayout => {
    const n = pin.number;
    if (n === undefined || !Number.isInteger(n) || n < 1 || n > count || seen.has(n)) {
      throw new Error(`${type}: pin "${pin.name}" needs a unique number 1…${count}, got ${n}`);
    }
    seen.add(n);
    return n <= rows
      ? { name: pin.name, at: [0, n], side: 'left' }
      : { name: pin.name, at: [width + 2, count + 1 - n], side: 'right' };
  });
  return { body: { x: 1, y: 0, width, height: rows + 1 }, pins: layout };
}

/**
 * Generic box: inputs on the left, outputs (incl. tri-state and bidirectional) on the right, power
 * and unconnected pins at the bottom. The shorter side is centered where the grid allows.
 */
function boxLayout(pins: readonly PinDef[]): PartLayout {
  const sideOf = (pin: PinDef): Side =>
    pin.dir === 'in' ? 'left' : pin.dir === 'power' || pin.dir === 'nc' ? 'bottom' : 'right';
  const count = { left: 0, right: 0, bottom: 0, top: 0 };
  for (const pin of pins) count[sideOf(pin)]++;
  const rows = Math.max(count.left, count.right, 1);
  const width = Math.max(3, count.bottom + 1);
  const offset = { left: (rows - count.left) >> 1, right: (rows - count.right) >> 1 };
  const next = { left: 0, right: 0, bottom: 0, top: 0 };
  const layout = pins.map((pin): PinLayout => {
    const side = sideOf(pin);
    const i = next[side]++;
    switch (side) {
      case 'left':
        return { name: pin.name, at: [0, 1 + offset.left + i], side };
      case 'right':
        return { name: pin.name, at: [width + 2, 1 + offset.right + i], side };
      default:
        return { name: pin.name, at: [2 + i, rows + 2], side };
    }
  });
  return { body: { x: 1, y: 0, width, height: rows + 1 }, pins: layout };
}

/** Where an instance sits: its origin, rotation and mirroring. */
export function placementOf(instance: ComponentInstance): Placement {
  return { origin: [instance.x, instance.y], rotation: instance.rotation, flip: instance.flip };
}

/** The layout's pins in grid coordinates after placement. */
export function placePins(layout: PartLayout, placement: Placement): PinLayout[] {
  return layout.pins.map((pin) => ({
    name: pin.name,
    at: transformPoint(pin.at, placement),
    side: transformSide(pin.side, placement),
  }));
}
