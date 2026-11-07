/**
 * Net parts. The net label: an outlined tag pointing at its connection point, the name inside
 * (overlined where it says `~{…}`); while simulating, the outline takes its net's wire color. The
 * bus entry: a diagonal across its one-cell body between its bit stub and its bus stub, its name
 * beside it.
 */
import { isBusName, netNameRuns } from '../../core';
import { NET_LABEL_FONT } from '../../library';
import { overlinedText, type SymbolGraphics, WIRE_WIDTH } from '../graphics';
import type { Drawer } from './types';

/** Half the tag's height, in cells: it stays within its pin's row, so labels stack. */
const HALF = 0.4;
/** How far the point reaches into the body, in cells. */
const POINT = 0.5;

/** Width of one character of the monospaced name font, in cells. */
const CHAR_WIDTH = NET_LABEL_FONT * 0.6;

const netLabel: Drawer = (g, { body, props, pinColor, busValue }) => {
  const name = String(props.name ?? '');
  const bus = isBusName(name);
  const x0 = body.x;
  const x1 = body.x + body.width;
  const y = body.y + body.height / 2;
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(x0 + POINT, y - HALF);
  g.lineTo(x1, y - HALF);
  g.lineTo(x1, y + HALF);
  g.lineTo(x0 + POINT, y + HALF);
  g.closePath();
  g.fill('body');
  // A bus label is outlined like its bus; a net label like the part outlines.
  const outline = pinColor?.('N') ?? (bus ? 'bus' : 'line');
  g.stroke(outline, bus ? WIRE_WIDTH : undefined);
  const { text, overline } = overlinedText(netNameRuns(name));
  g.text(text, (x0 + POINT + x1) / 2, y, {
    size: NET_LABEL_FONT,
    align: 'center',
    baseline: 'middle',
    font: 'mono',
    paint: 'text',
    overline,
  });
  if (busValue !== undefined) drawValueTag(g, busValue, x1, y, outline);
};

/** A bus label's value while simulating: a box after the tag's end, `0x3F` in it. */
function drawValueTag(g: SymbolGraphics, value: string, x: number, y: number, outline: string) {
  const x0 = x + 0.2;
  const width = value.length * CHAR_WIDTH + 0.4;
  g.beginPath();
  g.rect(x0, y - HALF, width, 2 * HALF);
  g.fill('body');
  g.stroke(outline);
  g.text(value, x0 + width / 2, y, {
    size: NET_LABEL_FONT,
    align: 'center',
    baseline: 'middle',
    font: 'mono',
    paint: 'text',
  });
}

/** Font size of a bus entry's name, in cells. */
const ENTRY_FONT = 0.5;

const busEntry: Drawer = (g, { body, props, pinColor }) => {
  // The bit stub ends at the body's top-left corner, the bus stub starts at its bottom-right.
  g.beginPath();
  g.moveTo(body.x, body.y);
  g.lineTo(body.x + body.width, body.y + body.height);
  g.stroke(pinColor?.('N') ?? 'line', WIRE_WIDTH);
  // The name above the bus stub, clear of the diagonal and of the next entry down.
  const { text, overline } = overlinedText(netNameRuns(String(props.name ?? '')));
  g.text(text, body.x + body.width + 0.5, body.y + body.height / 2, {
    size: ENTRY_FONT,
    align: 'center',
    baseline: 'middle',
    font: 'mono',
    paint: 'text',
    overline,
  });
};

export const NET_DRAWERS: Readonly<Record<string, Drawer>> = {
  'net-label': netLabel,
  'bus-entry': busEntry,
};
