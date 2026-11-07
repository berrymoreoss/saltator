/**
 * Net parts. The net label: an outlined tag pointing at its connection point, the name inside
 * (overlined where it says `~{…}`); while simulating, the outline takes its net's wire color. The
 * bus entry: a diagonal across its one-cell body between its bit stub and its bus stub, its name
 * beside it.
 */
import { netNameRuns } from '../../core';
import { NET_LABEL_FONT } from '../../library';
import { overlinedText, WIRE_WIDTH } from '../graphics';
import type { Drawer } from './types';

/** Half the tag's height, in cells: it stays within its pin's row, so labels stack. */
const HALF = 0.4;
/** How far the point reaches into the body, in cells. */
const POINT = 0.5;

const netLabel: Drawer = (g, { body, props, pinColor }) => {
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
  g.stroke(pinColor?.('N') ?? 'line');
  const { text, overline } = overlinedText(netNameRuns(String(props.name ?? '')));
  g.text(text, (x0 + POINT + x1) / 2, y, {
    size: NET_LABEL_FONT,
    align: 'center',
    baseline: 'middle',
    font: 'mono',
    paint: 'text',
    overline,
  });
};

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
