/** Pure pieces of the Debug tab and of the run statistics (R14): terms, counts, rates. */
import { formatTime, Level } from '../core';
import type { DebugTerm, RunStats } from '../editor';
import { conditionId, conditionTerm, isValueCondition } from './condition-terms';

/** A term as the breakpoint dialog edits it. */
export interface DraftTerm {
  readonly signal: string;
  /** A condition id (`rise`, `level:1`, `equal`, …). */
  readonly condition: string;
  readonly value: string;
}

export function toDebugTerm(draft: DraftTerm): DebugTerm {
  const signal = draft.signal.trim();
  const { kind, level } = conditionTerm(draft.condition);
  if (kind === 'level') return { signal, kind, level: level ?? Level.L1 };
  if (isValueCondition(draft.condition)) return { signal, kind, value: draft.value.trim() };
  return { signal, kind };
}

export function draftOf(term: DebugTerm): DraftTerm {
  return {
    signal: term.signal,
    condition: conditionId(term.kind, term.level),
    value: term.value ?? '',
  };
}

/** `999`, `12.3k`, `1.23M`, `4.56G`: a count in a few digits. */
export function formatCount(n: number): string {
  const units: readonly [number, string][] = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e4, 'k'],
  ];
  for (const [size, unit] of units) {
    if (n < size) continue;
    const scaled = n / (unit === 'k' ? 1e3 : size);
    return `${Number(scaled.toPrecision(3))}${unit}`;
  }
  return String(Math.round(n));
}

/** `1 MHz`, `500 kHz`, `1.53 Hz`, `0.25 Hz`. */
export function formatFrequency(hz: number): string {
  if (!(hz > 0)) return '—';
  const units: readonly [number, string][] = [
    [1e9, 'GHz'],
    [1e6, 'MHz'],
    [1e3, 'kHz'],
  ];
  for (const [size, unit] of units) {
    if (hz >= size) return `${Number((hz / size).toPrecision(3))} ${unit}`;
  }
  return `${Number(hz.toPrecision(3))} Hz`;
}

/** `850 ms`, `12.3 s`: wall time. */
export function formatWall(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${Number((ms / 1000).toPrecision(3))} s`;
}

/** The rows of the statistics table: a name, since power-on, for the last run. */
export function statsRows(stats: RunStats): readonly (readonly [string, string, string])[] {
  const { total, last } = stats;
  const rate = (events: number, wall: number) =>
    wall > 0 ? `${formatCount((events * 1000) / wall)}/s` : '—';
  const speed = (time: number, wall: number) =>
    wall > 0 ? `${formatTime(Math.round((time * 1000) / wall))}/s` : '—';
  return [
    ['Simulated time', formatTime(total.time), formatTime(last.time)],
    ['Wall time running', formatWall(total.wall), formatWall(last.wall)],
    ['Events', formatCount(total.events), formatCount(last.events)],
    ['Delta cycles', formatCount(total.deltaCycles), formatCount(last.deltaCycles)],
    ['Evaluations', formatCount(total.evaluations), formatCount(last.evaluations)],
    ['Events per second', rate(total.events, total.wall), rate(last.events, last.wall)],
    ['Simulated per second', speed(total.time, total.wall), speed(last.time, last.wall)],
  ];
}
