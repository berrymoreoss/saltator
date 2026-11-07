/**
 * The generic DIP package drawing (ADR-0004): a vertical body with the notch at the top, pin
 * numbers outside next to each stub, pin names inside (an active-low pin's letters overlined,
 * or the characters its label marks (`pinTextRuns`), after a clock
 * triangle for clock inputs; `NC` for not-connected pins, whose names are `NC<number>`) and the
 * part name down the middle, as in a datasheet drawing.
 */
import type { PartLayout } from '../../circuit';
import { type PinDef, pinTextRuns } from '../../core';
import { overlinedText, type SymbolGraphics } from '../graphics';

const NAME_SIZE = 0.5;
const NUMBER_SIZE = 0.4;

export function drawDip(
  g: SymbolGraphics,
  layout: PartLayout,
  pins: readonly PinDef[],
  name: string,
): void {
  const { body } = layout;
  const left = body.x;
  const right = body.x + body.width;
  const cx = left + body.width / 2;

  g.beginPath();
  g.moveTo(left, body.y);
  g.lineTo(cx - 0.5, body.y);
  g.arc(cx, body.y, 0.5, Math.PI, 0, true);
  g.lineTo(right, body.y);
  g.lineTo(right, body.y + body.height);
  g.lineTo(left, body.y + body.height);
  g.closePath();
  g.fill('body');
  g.stroke();

  for (const [i, pin] of layout.pins.entries()) {
    const def = pins[i];
    const [tipX, y] = pin.at;
    const onLeft = pin.side === 'left';
    g.text(String(def?.number ?? ''), (tipX + (onLeft ? left : right)) / 2, y - 0.08, {
      size: NUMBER_SIZE,
      align: 'center',
      baseline: 'bottom',
      paint: 'pinText',
      font: 'mono',
      minPx: 6,
    });
    let inset = 0.25;
    if (def?.clock) {
      const edge = onLeft ? left : right;
      const dir = onLeft ? 1 : -1;
      g.beginPath();
      g.moveTo(edge, y - 0.3);
      g.lineTo(edge + dir * 0.4, y);
      g.lineTo(edge, y + 0.3);
      g.stroke();
      inset = 0.55;
    }
    // n.c. pins (`NC3`) as NC; other `nc` pins keep their names (a 555's timing pins).
    const { text, overline } = /^NC\d+$/.test(pin.name)
      ? { text: 'NC', overline: false }
      : overlinedText(pinTextRuns(def ?? pin));
    g.text(text, onLeft ? left + inset : right - inset, y, {
      size: NAME_SIZE,
      align: onLeft ? 'left' : 'right',
      baseline: 'middle',
      paint: 'pinText',
      overline,
      minPx: 6,
    });
  }

  g.text(name, cx, body.y + body.height / 2, {
    size: 0.6,
    align: 'center',
    baseline: 'middle',
    rotate: 90,
    bold: true,
    paint: 'line',
  });
}
