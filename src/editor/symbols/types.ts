import type { PartLayout, Rect } from '../../circuit';
import type { AnyComponentDefinition, PropValue, SymbolDef } from '../../core';
import type { SymbolGraphics } from '../graphics';

/** How logic gates are drawn: distinctive shapes (ANSI/IEEE 91) or rectangles (IEC 60617). */
export type GateStyle = 'ansi' | 'iec';

export const GATE_STYLES: readonly GateStyle[] = ['ansi', 'iec'];

/** Everything a symbol drawer may look at; coordinates are the part's local cells. */
export interface DrawContext {
  readonly definition: AnyComponentDefinition;
  readonly symbol: SymbolDef;
  readonly layout: PartLayout;
  /** The body rectangle (pin stubs excluded). */
  readonly body: Rect;
  readonly props: Readonly<Record<string, PropValue>>;
  readonly gateStyle: GateStyle;
}

/** Draws a part's body (pin stubs are drawn by the renderer). */
export type Drawer = (g: SymbolGraphics, c: DrawContext) => void;
