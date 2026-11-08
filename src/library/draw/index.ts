import type { AnyComponentDefinition } from '../../core';
import { schematicText } from './text';

export {
  lineWidth,
  schematicText,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  TEXT_SIZES,
  type TextFont,
  type TextSize,
  textBlockSize,
  textLines,
} from './text';

/** All `draw/*` parts (graphics: schematic-only, without pins), in palette order. */
export const graphics: readonly AnyComponentDefinition[] = [schematicText];
