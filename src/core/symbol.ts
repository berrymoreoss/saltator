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
  /**
   * The body sits half a cell higher than its cells, so a one-cell-high body is centered on the
   * row of its pins at offset 0, and such parts stack on adjacent pins at a one-cell pitch (net
   * labels on a chip's data pins). Pins on the left and right sides only.
   */
  readonly centered?: boolean;
}

/** Combining overline (U+0305), written after each character a label overlines: `U̅/D`. */
export const COMBINING_OVERLINE = '\u0305';

/** A piece of a pin's drawn text, overlined or not. */
export interface TextRun {
  readonly text: string;
  readonly overline: boolean;
}

/**
 * A pin's text as drawn, in runs: `text` (default: its label, else its name). A text that marks
 * its overlined characters (U+0305 after each: `U̅/D`, `Q̅0̅`) is drawn as marked. Otherwise an
 * active-LOW pin's letters are overlined and its digits are not, as the data sheets draw them
 * (`1R̅D̅`, `E̅1`, `Y̅0`, `1Q̅`); other pins have no overline.
 */
export function pinTextRuns(
  pin: Pick<PinDef, 'name' | 'label' | 'activeLow'>,
  text: string = pin.label ?? pin.name,
): TextRun[] {
  const marked = text.includes(COMBINING_OVERLINE);
  const runs: { text: string; overline: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === COMBINING_OVERLINE) continue;
    const overline = marked
      ? text[i + 1] === COMBINING_OVERLINE
      : pin.activeLow === true && !/[0-9]/.test(char);
    const last = runs.at(-1);
    if (last?.overline === overline) last.text += char;
    else runs.push({ text: char, overline });
  }
  return runs;
}

/**
 * A net name as drawn: `~{…}` marks an overlined part, as in KiCad (`~{CLR}` → C̅L̅R̅,
 * `~{CS}1` → C̅S̅1). A `~` without a closing brace is plain text.
 */
export function netNameRuns(name: string): TextRun[] {
  const runs: TextRun[] = [];
  const push = (text: string, overline: boolean) => {
    const last = runs.at(-1);
    if (last?.overline === overline) runs[runs.length - 1] = { text: last.text + text, overline };
    else if (text !== '') runs.push({ text, overline });
  };
  let i = 0;
  while (i < name.length) {
    const close = name.startsWith('~{', i) ? name.indexOf('}', i + 2) : -1;
    if (close > i + 2) {
      push(name.slice(i + 2, close), true);
      i = close + 1;
    } else {
      push(name[i]!, false);
      i++;
    }
  }
  return runs;
}

/** The plain text of runs, without marks. */
export function runsText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join('');
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
    if (symbol.centered && (side === 'top' || side === 'bottom')) {
      throw new Error(`${where}: pin "${name}" is on the ${side} side of a centered symbol`);
    }
    const key = `${side}:${offset}`;
    const other = taken.get(key);
    if (other !== undefined) {
      throw new Error(`${where}: pins "${other}" and "${name}" are on the same point`);
    }
    taken.set(key, name);
  }
}
