import { type Editor, SignalStyle } from '../editor';
import { useStore } from './hooks';

const STYLE_TEXT: Readonly<Record<SignalStyle, [text: string, className: string, title: string]>> =
  {
    [SignalStyle.NONE]: ['', '', ''],
    [SignalStyle.L0]: ['0', 'l0', 'Driven low'],
    [SignalStyle.L1]: ['1', 'l1', 'Driven high'],
    [SignalStyle.Z]: ['Z', 'z', 'Floating: nothing drives it'],
    [SignalStyle.X]: ['X', 'x', 'Unknown'],
    [SignalStyle.WEAK_0]: ['0', 'weak0', 'Pulled low (weak)'],
    [SignalStyle.WEAK_1]: ['1', 'weak1', 'Pulled high (weak)'],
    [SignalStyle.CONTENTION]: ['X', 'contention', 'Contention: drivers disagree (a short)'],
    [SignalStyle.BUS]: ['', '', ''], // a bus shows its value, not a level
  };

/**
 * The live level of a pin's or a wire's net while simulating, as a small badge; nothing when
 * stopped. Re-renders with the simulation's ticks (a few times per second), not every frame.
 */
export function LiveLevel({
  editor,
  pin,
  wire,
}: {
  readonly editor: Editor;
  readonly pin?: readonly [component: string, pin: string];
  readonly wire?: string;
}) {
  useStore(editor.simulation.ticks);
  const simulation = editor.simulation;
  // A part of the open circuit by its netlist id: none when the circuit doesn't simulate as drawn.
  const part = pin && editor.flatPart(pin[0]);
  const style = pin
    ? part === undefined
      ? undefined
      : simulation.pinStyle(part, pin[1])
    : wire !== undefined
      ? simulation.wireStyle(wire)
      : undefined;
  return style === undefined ? null : <LevelBadge style={style} />;
}

/** A level badge for a signal style (nothing for `NONE` and `BUS`). */
export function LevelBadge({ style }: { readonly style: SignalStyle }) {
  if (style === SignalStyle.NONE || style === SignalStyle.BUS) return null;
  const [text, className, title] = STYLE_TEXT[style];
  return (
    <span className={`level-badge ${className}`} title={title} data-testid="live-level">
      {text}
    </span>
  );
}

/** The bit a signal style reads as: `0`, `1` (weak too), `Z`, else `X`. */
export function styleBit(style: SignalStyle): string {
  switch (style) {
    case SignalStyle.L0:
    case SignalStyle.WEAK_0:
      return '0';
    case SignalStyle.L1:
    case SignalStyle.WEAK_1:
      return '1';
    case SignalStyle.Z:
      return 'Z';
    default:
      return 'X';
  }
}
