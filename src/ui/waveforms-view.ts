/**
 * Pure pieces of the Waveforms tab (R13): its rows (vectors expanded into their bits), the
 * cursor readout, the keys the plot handles, and completion for the Add signal box. Spec:
 * docs/editor.md#waveforms-tab.
 */

import type { Circuit, CompileResult } from '../circuit';
import { type ComponentRegistry, formatTime } from '../core';
import { type AnalyzerChannel, WAVE_ROW_HEIGHT, type WaveRow, type WaveView } from '../editor';
import { formatSi } from './prop-input';

/** A channel's key for the expanded set (its label and reference). */
export const rowKey = (channel: AnalyzerChannel) => `${channel.label}|${channel.reference}`;

/** The rows of the diagram: each channel, and the bits of each expanded vector after it. */
export function waveRows(
  channels: readonly AnalyzerChannel[],
  expanded: ReadonlySet<string>,
  height = WAVE_ROW_HEIGHT,
): WaveRow[] {
  const rows: WaveRow[] = [];
  for (const channel of channels) {
    rows.push({ channel, y: rows.length * height, height });
    if (!channel.vector || !expanded.has(rowKey(channel))) continue;
    // Most significant bit first, as a bus is read.
    for (let bit = channel.bits.length - 1; bit >= 0; bit--) {
      rows.push({ channel, bit, y: rows.length * height, height });
    }
  }
  return rows;
}

/** The row at plot height `y` (below the ruler, rows scrolled by `scroll`). */
export function rowAt(rows: readonly WaveRow[], y: number, scroll: number): WaveRow | undefined {
  const at = y + scroll;
  return rows.find((row) => at >= row.y && at < row.y + row.height);
}

/** The cursors as the toolbar reads them: `A 1.5 µs · B 4 µs · Δ 2.5 µs · 400 kHz`. */
export interface CursorReadout {
  readonly a?: string;
  readonly b?: string;
  readonly delta?: string;
  readonly frequency?: string;
}

export function cursorReadout(view: WaveView): CursorReadout {
  const { cursorA, cursorB } = view;
  const readout: { a?: string; b?: string; delta?: string; frequency?: string } = {};
  if (cursorA !== undefined) readout.a = formatTime(cursorA);
  if (cursorB !== undefined) readout.b = formatTime(cursorB);
  if (cursorA !== undefined && cursorB !== undefined) {
    const delta = cursorB - cursorA;
    readout.delta = formatTime(delta);
    if (delta !== 0) readout.frequency = formatSi(1e12 / Math.abs(delta), 'Hz');
  }
  return readout;
}

/** What a key pressed in the plot does. */
export type WaveKey =
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'pan'; readonly pages: number }
  | { readonly kind: 'edge'; readonly direction: 1 | -1; readonly cursor: 'A' | 'B' }
  | { readonly kind: 'fit' }
  | { readonly kind: 'follow' }
  | { readonly kind: 'remove' }
  | { readonly kind: 'clearCursors' }
  | { readonly kind: 'select'; readonly step: 1 | -1 };

/**
 * The plot's keys: `+`/`=` and `-` zoom, ←/→ pan a tenth of the window (Shift: a whole one),
 * `[`/`]` move cursor A to the previous/next edge of the selected channel (`{`/`}` cursor B), Home fits, End follows `now`, ↑/↓ pick a
 * channel, Delete removes it, Escape clears the cursors. Undefined for other keys (they reach the
 * shortcuts).
 */
export function waveKey(key: string, shift: boolean): WaveKey | undefined {
  switch (key) {
    case '+':
    case '=':
      return { kind: 'zoom', factor: 2 };
    case '-':
      return { kind: 'zoom', factor: 0.5 };
    case 'ArrowLeft':
      return { kind: 'pan', pages: shift ? -1 : -0.1 };
    case 'ArrowRight':
      return { kind: 'pan', pages: shift ? 1 : 0.1 };
    case '[':
      return { kind: 'edge', direction: -1, cursor: 'A' };
    case ']':
      return { kind: 'edge', direction: 1, cursor: 'A' };
    // Shift+[ and Shift+] on most layouts.
    case '{':
      return { kind: 'edge', direction: -1, cursor: 'B' };
    case '}':
      return { kind: 'edge', direction: 1, cursor: 'B' };
    case 'Home':
      return { kind: 'fit' };
    case 'End':
      return { kind: 'follow' };
    case 'ArrowUp':
      return { kind: 'select', step: -1 };
    case 'ArrowDown':
      return { kind: 'select', step: 1 };
    case 'Delete':
    case 'Backspace':
      return { kind: 'remove' };
    case 'Escape':
      return { kind: 'clearCursors' };
    default:
      return undefined;
  }
}

/** Zoom factor of a wheel step: 2× per 500 px of scroll, smooth for touchpads. */
export const wheelFactor = (deltaY: number) => 2 ** (-deltaY / 500);

/** A named signal inside a Verilog module, as a reference can name it (HDL-4). */
export interface ModuleSignalReference {
  /** `A1/state` for an instance placed in the circuit, `state` in the module's own circuit. */
  readonly ref: string;
  /** `signal [1:0] in A1`, `signal` (one bit, inside the module itself). */
  readonly detail: string;
}

/**
 * The named signals a reference in `circuit` can name: those of the Verilog modules it places
 * (`A1/state`, by instance), or its own when it is a module — the module parts' views in the
 * design's `registry` (`hdl/<circuit id>`).
 */
export function moduleSignalReferences(
  circuit: Circuit,
  registry: ComponentRegistry,
): ModuleSignalReference[] {
  const out: ModuleSignalReference[] = [];
  const add = (circuitId: string, prefix: string, where: string) => {
    for (const { name, lsb, width } of registry.get(`hdl/${circuitId}`)?.signals?.list ?? []) {
      const range = width === 1 ? '' : ` [${lsb + width - 1}:${lsb}]`;
      out.push({ ref: `${prefix}${name}`, detail: `signal${range}${where}` });
    }
  };
  if (circuit.verilog) add(circuit.id, '', '');
  const instances = circuit.components
    .filter((c) => c.type.startsWith('sub/'))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  for (const part of instances)
    add(part.type.slice('sub/'.length), `${part.id}/`, ` in ${part.id}`);
  return out;
}

/**
 * References the Add signal box offers for `text`: named nets, buses, signals inside modules
 * (`inner`, from `moduleSignalReferences`) and part pins that start with it (case-insensitive),
 * names first, at most `limit`.
 */
export function referenceSuggestions(
  compiled: CompileResult,
  text: string,
  inner: readonly ModuleSignalReference[] = [],
  limit = 12,
): string[] {
  const prefix = text.trim().toLowerCase();
  const names = new Set<string>();
  for (const bus of compiled.buses) for (const name of bus.names) names.add(name);
  for (const net of compiled.nets) for (const name of net.names) names.add(name);
  for (const signal of inner) names.add(signal.ref);
  const pins: string[] = [];
  if (prefix !== '') {
    for (const net of compiled.nets)
      for (const pin of net.pins) pins.push(`${pin.component}.${pin.pin}`);
  }
  const matches = (ref: string) => ref.toLowerCase().startsWith(prefix);
  const named = [...names].filter(matches).sort();
  const pinMatches = pins
    .filter(matches)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return [...named, ...pinMatches].slice(0, limit);
}
