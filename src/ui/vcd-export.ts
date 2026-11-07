/**
 * Export VCD… (R13): the Waveforms tab's channels as a Value Change Dump, the whole record or
 * the span between the cursors. Spec: docs/editor.md#waveforms-tab.
 */
import { formatTime, type Time, writeVcd } from '../core';
import type { Analyzer } from '../editor';

export type VcdRange = 'all' | 'cursors';

export interface VcdFile {
  readonly name: string;
  readonly text: string;
  readonly signals: number;
  readonly from: Time;
  readonly to: Time;
}

/** What a range covers, for the dialog: `0 ps – 4.456 s`; undefined when it isn't available. */
export function vcdSpan(analyzer: Analyzer, range: VcdRange): { from: Time; to: Time } | undefined {
  if (range === 'all') return { from: analyzer.recorder.start, to: analyzer.end };
  const { cursorA, cursorB } = analyzer.view.get();
  if (cursorA === undefined || cursorB === undefined || cursorA === cursorB) return undefined;
  return { from: Math.min(cursorA, cursorB), to: Math.max(cursorA, cursorB) };
}

export const formatSpan = (span: { from: Time; to: Time }) =>
  `${formatTime(span.from)} – ${formatTime(span.to)}`;

/** A file name from the document's (`Data Bus.vcd`). */
export const vcdFileName = (title: string) =>
  `${title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'waveforms'}.vcd`;

/**
 * The dump of the channels that resolve, or why there is none. `date` and `version` go into the
 * header (the caller reads the clock; core never does).
 */
export function vcdFile(
  analyzer: Analyzer,
  options: {
    readonly range: VcdRange;
    readonly title: string;
    readonly date: string;
    readonly version: string;
  },
): VcdFile | string {
  const signals = analyzer.channels
    .get()
    .filter((c) => c.problem === undefined)
    .map((c) => ({ name: c.label, channels: c.bits }));
  if (signals.length === 0) return 'Nothing to export: probe some signals first.';
  if (analyzer.recorder.size === 0) return 'Nothing recorded yet: run the simulation first.';
  const span = vcdSpan(analyzer, options.range);
  if (!span) return 'Place cursors A and B to export the span between them.';
  const text = writeVcd(analyzer.recorder, signals, {
    from: span.from,
    to: span.to,
    scope: options.title,
    date: options.date,
    version: options.version,
  });
  return { name: vcdFileName(options.title), text, signals: signals.length, ...span };
}
