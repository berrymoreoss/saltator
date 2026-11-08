/**
 * Graphics (`draw/*`): parts that are only drawn. The text: its lines from the top-left of its
 * box, upright whatever the placement (`textBlock`), in the part text color — the selection
 * color when selected; no outline, so it reads as a note on the sheet.
 */
import {
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  TEXT_SIZES,
  type TextFont,
  type TextSize,
  textLines,
} from '../../library';
import type { Drawer } from './types';

const text: Drawer = (g, { body, props }) => {
  const size = TEXT_SIZES[props.size as TextSize] ?? TEXT_SIZES.normal;
  g.textBlock(textLines(String(props.text ?? '')), body, {
    size,
    lineHeight: TEXT_LINE_HEIGHT * size,
    padding: TEXT_PADDING,
    font: (props.font as TextFont) === 'mono' ? 'mono' : 'sans',
    paint: 'text',
  });
};

export const DRAW_DRAWERS = { text } as const;
