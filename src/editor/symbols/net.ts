/**
 * The net label: an outlined tag pointing at its connection point, the name inside (overlined
 * where it says `~{…}`). While simulating, the outline takes its net's wire color.
 */
import { netNameRuns } from '../../core';
import { NET_LABEL_FONT } from '../../library';
import { overlinedText } from '../graphics';
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

export const NET_DRAWERS: Readonly<Record<string, Drawer>> = { 'net-label': netLabel };
