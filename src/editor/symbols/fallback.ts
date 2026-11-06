/**
 * Drawings for parts without a dedicated drawer: the generic box (no package, no symbol, or a
 * symbol kind the editor doesn't know) and the placeholder of a broken part (unknown type,
 * invalid props).
 */
import type { PinLayout, Rect } from '../../circuit';
import type { SymbolGraphics } from '../graphics';

const PIN_NAME_SIZE = 0.55;

/** A filled rectangle with the part name in the middle and pin names inside next to each pin. */
export function drawLabeledBox(
  g: SymbolGraphics,
  body: Rect,
  name: string,
  pins: readonly PinLayout[],
): void {
  g.beginPath();
  g.rect(body.x, body.y, body.width, body.height);
  g.fill('body');
  g.stroke();
  g.text(name, body.x + body.width / 2, body.y + body.height / 2, {
    size: 0.65,
    align: 'center',
    baseline: 'middle',
    bold: true,
  });
  for (const pin of pins) {
    const [x, y] = pin.at;
    const style = { size: PIN_NAME_SIZE, paint: 'pinText', minPx: 6 } as const;
    switch (pin.side) {
      case 'left':
        g.text(pin.name, body.x + 0.25, y, { ...style, align: 'left', baseline: 'middle' });
        break;
      case 'right':
        g.text(pin.name, body.x + body.width - 0.25, y, {
          ...style,
          align: 'right',
          baseline: 'middle',
        });
        break;
      case 'top':
        g.text(pin.name, x, body.y + 0.2, { ...style, align: 'center', baseline: 'top' });
        break;
      case 'bottom':
        g.text(pin.name, x, body.y + body.height - 0.2, {
          ...style,
          align: 'center',
          baseline: 'bottom',
        });
        break;
    }
  }
}

/** A dashed box in the error color with a question mark and the reason's subject. */
export function drawBroken(g: SymbolGraphics, body: Rect, caption: string, color: string): void {
  g.setDash([0.3, 0.2]);
  g.beginPath();
  g.rect(body.x, body.y, body.width, body.height);
  g.stroke(color);
  g.setDash([]);
  g.text('?', body.x + body.width / 2, body.y + body.height / 2, {
    size: 1,
    align: 'center',
    baseline: 'middle',
    paint: color,
    bold: true,
  });
  g.text(caption, body.x + body.width / 2, body.y + body.height + 0.2, {
    size: 0.5,
    align: 'center',
    baseline: 'top',
    paint: color,
  });
}
