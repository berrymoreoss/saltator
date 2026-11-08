/**
 * Subcircuit instances (R11a): a box with the circuit's name in bold on its title row and each
 * port's name inside next to its pin (overlined where it says `~{…}`); names on the top and
 * bottom edges read across the edge. Geometry from the generated symbol (docs/circuit.md#subcircuits).
 */
import { SUBCIRCUIT_PIN_FONT, SUBCIRCUIT_TITLE_FONT, subcircuitRoom } from '../../circuit';
import { netNameRuns } from '../../core';
import { overlinedText } from '../graphics';
import type { Drawer } from './types';

const subcircuit: Drawer = (g, { body, definition, layout }) => {
  g.beginPath();
  g.rect(body.x, body.y, body.width, body.height);
  g.fill('body');
  g.stroke();
  const top = layout.pins.filter((p) => p.side === 'top').map((p) => p.name);
  const titleY = body.y + subcircuitRoom(top) + 1;
  const title = overlinedText(netNameRuns(definition.name));
  g.text(title.text, body.x + body.width / 2, titleY, {
    size: SUBCIRCUIT_TITLE_FONT,
    align: 'center',
    baseline: 'middle',
    bold: true,
    overline: title.overline,
  });
  for (const pin of layout.pins) {
    const [x, y] = pin.at;
    const { text, overline } = overlinedText(netNameRuns(pin.name));
    const style = {
      size: SUBCIRCUIT_PIN_FONT,
      font: 'mono',
      paint: 'pinText',
      minPx: 6,
      overline,
    } as const;
    switch (pin.side) {
      case 'left':
        g.text(text, body.x + 0.25, y, { ...style, align: 'left', baseline: 'middle' });
        break;
      case 'right':
        g.text(text, body.x + body.width - 0.25, y, {
          ...style,
          align: 'right',
          baseline: 'middle',
        });
        break;
      case 'top':
        g.text(text, x, body.y + 0.25, { ...style, align: 'left', baseline: 'middle', rotate: 90 });
        break;
      case 'bottom':
        g.text(text, x, body.y + body.height - 0.25, {
          ...style,
          align: 'right',
          baseline: 'middle',
          rotate: 90,
        });
        break;
    }
  }
};

export const SUBCIRCUIT_DRAWERS: Readonly<Record<string, Drawer>> = { subcircuit };
