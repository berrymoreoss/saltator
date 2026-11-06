/**
 * Symbol drawers keyed by `symbol.kind`, and the dispatcher that draws any part's body: its
 * symbol drawer, the DIP package, the generic box, or a broken-part placeholder.
 * Spec: docs/editor.md#symbol-drawing.
 */
import { type Level, pinsOf } from '../../core';
import type { SymbolGraphics } from '../graphics';
import type { ScenePart } from '../scene';
import { drawDip } from './dip';
import { drawBroken, drawLabeledBox } from './fallback';
import { GATE_DRAWERS } from './gates';
import { IO_DRAWERS } from './io';
import { POWER_DRAWERS } from './power';
import type { Drawer, GateStyle, PartLive } from './types';

export { drawDip } from './dip';
export * from './fallback';
export { BUBBLE } from './gates';
export { LED_COLORS, lit, unlit } from './io';
export * from './types';

/** Every symbol kind the editor can draw. Kinds missing here are drawn as a labeled box. */
export const DRAWERS: Readonly<Record<string, Drawer>> = {
  ...GATE_DRAWERS,
  ...POWER_DRAWERS,
  ...IO_DRAWERS,
};

/** What a part looks like in the running simulation, for its drawer. */
export interface LiveDraw {
  readonly part: PartLive;
  readonly levelColor: (level: Level) => string;
}

/**
 * Draws the body of a part in its local coordinates (the caller sets up the placement); with
 * `live`, as it is in the running simulation.
 */
export function drawPartBody(
  g: SymbolGraphics,
  part: ScenePart,
  gateStyle: GateStyle,
  errorColor: string,
  live?: LiveDraw,
): void {
  const { drawing, layout, definition } = part;
  switch (drawing.kind) {
    case 'symbol': {
      const drawer = DRAWERS[drawing.symbol.kind];
      if (drawer && definition) {
        drawer(g, {
          definition,
          symbol: drawing.symbol,
          layout,
          body: layout.body,
          props: part.props,
          gateStyle,
          ...(live && { live: live.part, levelColor: live.levelColor }),
        });
      } else {
        drawLabeledBox(g, layout.body, definition?.name ?? drawing.symbol.kind, layout.pins);
      }
      return;
    }
    case 'dip':
      if (definition) {
        drawDip(g, layout, pinsOf(definition, part.props), definition.name);
        return;
      }
      drawLabeledBox(g, layout.body, part.instance.type, layout.pins);
      return;
    case 'box':
      drawLabeledBox(g, layout.body, definition?.name ?? part.instance.type, layout.pins);
      return;
    case 'broken':
      drawBroken(g, layout.body, part.instance.type, errorColor);
      return;
  }
}
