import type { PartLayout, Rect } from '../../circuit';
import type { AnyComponentDefinition, Level, PropValue, SymbolDef } from '../../core';
import type { SymbolGraphics } from '../graphics';

/** How logic gates are drawn: distinctive shapes (ANSI/IEEE 91) or rectangles (IEC 60617). */
export type GateStyle = 'ansi' | 'iec';

export const GATE_STYLES: readonly GateStyle[] = ['ansi', 'iec'];

/** Brightness of a light that may be on or off: `X` could still mean forward bias. */
export const UNKNOWN_LIGHT = -1;

/** A part as it is in the running simulation (R05). */
export interface PartLive {
  /** The part's simulator state (`stateOf`; shapes in docs/components.md). Read-only. */
  readonly state: unknown;
  /** Level of the net on a pin (`Z` for a pin the part doesn't have). */
  level(pin: string): Level;
  /**
   * Light `i`'s brightness (indicators, lights in `LightsState` order): 0 off … 1 on all the
   * time, averaged over the last frame while running; `UNKNOWN_LIGHT` when unknown.
   */
  light(i: number): number;
}

/** Everything a symbol drawer may look at; coordinates are the part's local cells. */
export interface DrawContext {
  readonly definition: AnyComponentDefinition;
  readonly symbol: SymbolDef;
  readonly layout: PartLayout;
  /** The body rectangle (pin stubs excluded). */
  readonly body: Rect;
  readonly props: Readonly<Record<string, PropValue>>;
  readonly gateStyle: GateStyle;
  /** Present while simulating: drawers show the live state instead of the idle look. */
  readonly live?: PartLive;
  /** The wire color of a level (probes, clocks), in the canvas theme. */
  readonly levelColor?: (level: Level) => string;
}

/** Draws a part's body (pin stubs are drawn by the renderer). */
export type Drawer = (g: SymbolGraphics, c: DrawContext) => void;
