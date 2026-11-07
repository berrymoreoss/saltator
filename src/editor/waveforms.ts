/**
 * Drawing the waveform view (R13) on a Canvas2D context: a time ruler, one row per channel (or
 * per bit of an expanded bus), the cursors, the trigger and `now`. Layout is computed by pure
 * functions — ruler ticks, a row's segments at pixel resolution — so it is tested without a
 * canvas; `drawWaveforms` only paints them. Spec: docs/editor.md#waveforms.
 */
import { formatTime, Level, NO_DATA, type Recorder, type Time } from '../core';
import { type AnalyzerChannel, formatValue, type WaveView } from './analyzer';
import type { CanvasTheme } from './theme';

/** The part of `CanvasRenderingContext2D` the waveforms use (a recording fake in tests). */
export interface WaveCanvas {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  fill(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
  setLineDash(segments: number[]): void;
}

/** One row of the diagram: a channel, or one bit of an expanded vector. */
export interface WaveRow {
  readonly channel: AnalyzerChannel;
  /** The bit shown (expanded vectors); undefined: the channel itself. */
  readonly bit?: number;
  /** Top, in pixels below the ruler. */
  readonly y: number;
  readonly height: number;
}

export interface WaveformScene {
  readonly recorder: Recorder;
  readonly view: WaveView;
  readonly rows: readonly WaveRow[];
  /** Plot height in pixels, ruler included. */
  readonly height: number;
  /** Draw `now` (simulating). */
  readonly live: boolean;
  /**
   * Where the simulation is, when it isn't the record's end (after a rewind, R14b): the record
   * after it is the future a run replays, veiled.
   */
  readonly now?: Time;
  /** The trigger's instant, when it fired. */
  readonly trigger?: Time;
}

export const WAVE_RULER_HEIGHT = 20;
export const WAVE_ROW_HEIGHT = 24;

/** Ruler steps: 1, 2, 5 × 10^k ps. */
function niceStep(minimum: number): number {
  let step = 1;
  for (;;) {
    for (const m of [1, 2, 5]) if (step * m >= minimum) return step * m;
    step *= 10;
  }
}

export interface RulerTick {
  readonly time: Time;
  readonly x: number;
  /** Labelled (major) tick. */
  readonly major: boolean;
  readonly label?: string;
}

/** Ticks for the ruler: a labelled one every ≥ 80 px at a round step, four between them. */
export function rulerTicks(view: WaveView): RulerTick[] {
  const { start, scale, width } = view;
  if (width <= 0) return [];
  const major = Math.max(1, niceStep(scale * 80));
  const minor = major / 5;
  const ticks: RulerTick[] = [];
  const first = Math.ceil(start / minor) * minor;
  for (let t = first; t <= start + width * scale; t += minor) {
    const time = Math.round(t);
    const isMajor = Math.abs(time / major - Math.round(time / major)) < 1e-6;
    ticks.push({
      time,
      x: (time - start) / scale,
      major: isMajor,
      ...(isMajor && { label: formatTime(time) }),
    });
    if (ticks.length > 1000) break;
  }
  return ticks;
}

/**
 * A stretch of a row from `x0` to `x1` (pixels): a steady level (`value` its bit levels), many
 * changes too close to draw one by one (`dense`), or no data.
 */
export interface Segment {
  readonly x0: number;
  readonly x1: number;
  readonly kind: 'steady' | 'dense' | 'none';
  /** Bit levels during a steady stretch, bit 0 first. */
  readonly levels?: readonly Level[];
}

const sameLevels = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((l, i) => l === b[i]);

/**
 * A row's stretches across the view, one pixel column at a time: a column with one change
 * starts the next stretch after it (1 px precision), with two or more it is dense. Columns are
 * merged into the longest runs.
 */
export function rowSegments(
  recorder: Recorder,
  bits: readonly number[],
  view: WaveView,
): Segment[] {
  const { start, scale, width } = view;
  const columns = Math.ceil(width);
  const segments: Segment[] = [];
  const end = recorder.end;
  const first = recorder.start;
  let current: { x0: number; kind: Segment['kind']; levels: number[] } | undefined;
  const close = (x: number) => {
    if (!current) return;
    if (x > current.x0) {
      segments.push({
        x0: current.x0,
        x1: x,
        kind: current.kind,
        ...(current.kind === 'steady' && { levels: current.levels as Level[] }),
      });
    }
    current = undefined;
  };
  const open = (x: number, kind: Segment['kind'], levels: number[]) => {
    if (
      current &&
      current.kind === kind &&
      (kind !== 'steady' || sameLevels(current.levels, levels))
    ) {
      return;
    }
    close(x);
    current = { x0: x, kind, levels };
  };
  for (let c = 0; c < columns; c++) {
    const from = start + c * scale;
    const to = from + scale;
    if (from > end || to <= first) {
      open(c, 'none', []);
      continue;
    }
    const at = Math.max(from, first);
    // Changes in the column [from, to) (times are whole picoseconds): one starts the next
    // stretch after the column, two make it dense.
    const firstChange = recorder.nextChangeOf(bits, Math.ceil(at) - 1);
    const inside = firstChange !== undefined && firstChange < to && firstChange <= end;
    const second = inside ? recorder.nextChangeOf(bits, firstChange) : undefined;
    if (second !== undefined && second < to && second <= end) {
      open(c, 'dense', []);
      continue;
    }
    const levels = bits.map((bit) => recorder.level(bit, at) ?? NO_DATA);
    if (levels.some((l) => l === NO_DATA)) open(c, 'none', []);
    else open(c, 'steady', levels);
    if (!inside) continue;
    const after = bits.map((bit) => recorder.level(bit, firstChange) ?? NO_DATA);
    if (after.some((l) => l === NO_DATA)) open(c + 1, 'none', []);
    else open(c + 1, 'steady', after);
  }
  close(columns);
  return segments;
}

/** The theme's colors for the waveform view. */
export interface WaveformTheme {
  readonly background: string;
  readonly rowAlt: string;
  readonly selected: string;
  readonly grid: string;
  readonly text: string;
  readonly textDim: string;
  readonly l0: string;
  readonly l1: string;
  readonly x: string;
  readonly z: string;
  readonly bus: string;
  readonly cursorA: string;
  readonly cursorB: string;
  readonly trigger: string;
  readonly now: string;
  readonly hatch: string;
  /** Laid over the recorded future (after a rewind). */
  readonly future: string;
}

export function waveformTheme(theme: CanvasTheme): WaveformTheme {
  const dark = theme.name === 'dark';
  return {
    background: theme.background,
    rowAlt: dark ? 'rgba(255, 255, 255, 0.025)' : 'rgba(0, 0, 0, 0.025)',
    selected: theme.selectionFill,
    grid: dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.08)',
    text: theme.text,
    textDim: theme.pinText,
    l0: theme.levels.l0,
    l1: theme.levels.l1,
    x: theme.levels.x,
    z: theme.levels.z,
    bus: theme.bus,
    cursorA: theme.selection,
    cursorB: theme.warning,
    trigger: theme.error,
    now: theme.openPin,
    hatch: dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
    future: dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.6)',
  };
}

const levelY = (level: Level, top: number, height: number) => {
  const high = top + 4;
  const low = top + height - 4;
  return level === Level.L1 ? high : level === Level.L0 ? low : (high + low) / 2;
};

const levelColor = (theme: WaveformTheme, level: Level) =>
  level === Level.L1
    ? theme.l1
    : level === Level.L0
      ? theme.l0
      : level === Level.Z
        ? theme.z
        : theme.x;

/** Paints the scene; `ctx` is in CSS pixels (the caller scales it for HiDPI). */
export function drawWaveforms(ctx: WaveCanvas, scene: WaveformScene, theme: WaveformTheme): void {
  const { view, rows, height, recorder } = scene;
  const { width } = view;
  ctx.save();
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  // Rows' backgrounds, and where the record has no data.
  rows.forEach((row, i) => {
    const top = WAVE_RULER_HEIGHT + row.y;
    if (row.channel.index === view.selected && row.bit === undefined) {
      ctx.fillStyle = theme.selected;
      ctx.fillRect(0, top, width, row.height);
    } else if (i % 2 === 1) {
      ctx.fillStyle = theme.rowAlt;
      ctx.fillRect(0, top, width, row.height);
    }
  });
  const ticks = rulerTicks(view);
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const tick of ticks) {
    if (!tick.major) continue;
    const x = Math.round(tick.x) + 0.5;
    ctx.moveTo(x, WAVE_RULER_HEIGHT);
    ctx.lineTo(x, height);
  }
  ctx.stroke();

  for (const row of rows) drawRow(ctx, scene, row, theme);
  const now = scene.live ? (scene.now ?? recorder.end) : undefined;
  if (now !== undefined && now < recorder.end) {
    // The recorded future: what a run from now repeats, until it is acted on.
    const x0 = Math.max(0, (now - view.start) / view.scale);
    const x1 = Math.min(width, (recorder.end - view.start) / view.scale);
    if (x1 > x0) {
      ctx.fillStyle = theme.future;
      ctx.fillRect(x0, WAVE_RULER_HEIGHT, x1 - x0, height - WAVE_RULER_HEIGHT);
    }
  }
  drawRuler(ctx, view, ticks, theme);
  drawMarks(ctx, scene, theme, recorder);
  ctx.restore();
}

function drawRow(ctx: WaveCanvas, scene: WaveformScene, row: WaveRow, theme: WaveformTheme): void {
  const { channel } = row;
  if (channel.problem !== undefined) return;
  const top = WAVE_RULER_HEIGHT + row.y;
  const bits = row.bit === undefined ? channel.bits : [channel.bits[row.bit]!];
  const vector = row.bit === undefined && channel.vector;
  const segments = rowSegments(scene.recorder, bits, scene.view);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, scene.view.width, row.height);
  ctx.clip();
  if (vector) drawVector(ctx, segments, top, row.height, channel, theme);
  else drawBit(ctx, segments, top, row.height, theme);
  ctx.restore();
}

function drawBit(
  ctx: WaveCanvas,
  segments: readonly Segment[],
  top: number,
  height: number,
  theme: WaveformTheme,
): void {
  ctx.lineWidth = 1.5;
  let previous: number | undefined;
  for (const segment of segments) {
    if (segment.kind === 'none') {
      hatch(ctx, segment.x0, top, segment.x1 - segment.x0, height, theme);
      previous = undefined;
      continue;
    }
    if (segment.kind === 'dense') {
      ctx.fillStyle = theme.l1;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(segment.x0, top + 4, segment.x1 - segment.x0, height - 8);
      ctx.globalAlpha = 1;
      previous = undefined;
      continue;
    }
    const level = segment.levels![0]!;
    const y = levelY(level, top, height);
    if (level === Level.X) {
      ctx.fillStyle = theme.x;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(segment.x0, top + 4, segment.x1 - segment.x0, height - 8);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = levelColor(theme, level);
    ctx.beginPath();
    if (previous !== undefined) {
      ctx.moveTo(segment.x0, previous);
      ctx.lineTo(segment.x0, y);
    } else {
      ctx.moveTo(segment.x0, y);
    }
    ctx.lineTo(segment.x1, y);
    ctx.stroke();
    previous = y;
  }
}

function drawVector(
  ctx: WaveCanvas,
  segments: readonly Segment[],
  top: number,
  height: number,
  channel: AnalyzerChannel,
  theme: WaveformTheme,
): void {
  const high = top + 4;
  const low = top + height - 4;
  const mid = (high + low) / 2;
  ctx.lineWidth = 1.25;
  for (const segment of segments) {
    const w = segment.x1 - segment.x0;
    if (segment.kind === 'none') {
      hatch(ctx, segment.x0, top, w, height, theme);
      continue;
    }
    if (segment.kind === 'dense') {
      ctx.fillStyle = theme.bus;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(segment.x0, high, w, low - high);
      ctx.globalAlpha = 1;
      continue;
    }
    const levels = segment.levels!;
    const floating = levels.every((l) => l === Level.Z);
    const unknown = !floating && levels.some((l) => l !== Level.L0 && l !== Level.L1);
    const color = floating ? theme.z : unknown ? theme.x : theme.bus;
    ctx.strokeStyle = color;
    if (floating) {
      ctx.beginPath();
      ctx.moveTo(segment.x0, mid);
      ctx.lineTo(segment.x1, mid);
      ctx.stroke();
      continue;
    }
    // A hexagon: slanted ends where the value changes.
    const slant = Math.min(3, w / 2);
    ctx.beginPath();
    ctx.moveTo(segment.x0, mid);
    ctx.lineTo(segment.x0 + slant, high);
    ctx.lineTo(segment.x1 - slant, high);
    ctx.lineTo(segment.x1, mid);
    ctx.lineTo(segment.x1 - slant, low);
    ctx.lineTo(segment.x0 + slant, low);
    ctx.closePath();
    if (unknown) {
      ctx.fillStyle = theme.x;
      ctx.globalAlpha = 0.2;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.stroke();
    const text = formatValue(levels, channel.radix);
    if (ctx.measureText(text).width + 8 <= w) {
      ctx.fillStyle = unknown ? theme.x : theme.text;
      ctx.textAlign = 'center';
      ctx.fillText(text, (segment.x0 + segment.x1) / 2, mid);
    }
  }
}

function hatch(
  ctx: WaveCanvas,
  x: number,
  top: number,
  w: number,
  height: number,
  theme: WaveformTheme,
): void {
  if (w <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top, w, height);
  ctx.clip();
  ctx.strokeStyle = theme.hatch;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = Math.floor(x / 6) * 6 - height; d < x + w; d += 6) {
    ctx.moveTo(d, top + height);
    ctx.lineTo(d + height, top);
  }
  ctx.stroke();
  ctx.restore();
}

function drawRuler(
  ctx: WaveCanvas,
  view: WaveView,
  ticks: readonly RulerTick[],
  theme: WaveformTheme,
): void {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, view.width, WAVE_RULER_HEIGHT);
  ctx.strokeStyle = theme.textDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, WAVE_RULER_HEIGHT - 0.5);
  ctx.lineTo(view.width, WAVE_RULER_HEIGHT - 0.5);
  for (const tick of ticks) {
    const x = Math.round(tick.x) + 0.5;
    ctx.moveTo(x, WAVE_RULER_HEIGHT - (tick.major ? 7 : 3));
    ctx.lineTo(x, WAVE_RULER_HEIGHT);
  }
  ctx.stroke();
  ctx.fillStyle = theme.textDim;
  ctx.textAlign = 'left';
  for (const tick of ticks) {
    if (tick.label !== undefined) ctx.fillText(tick.label, Math.round(tick.x) + 3, 7);
  }
}

function drawMarks(
  ctx: WaveCanvas,
  scene: WaveformScene,
  theme: WaveformTheme,
  recorder: Recorder,
): void {
  const { view, height } = scene;
  const xOf = (t: Time) => (t - view.start) / view.scale;
  const line = (t: Time, color: string, label: string, dash: number[] = []) => {
    const x = Math.round(xOf(t)) + 0.5;
    if (x < 0 || x > view.width) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.setLineDash([]);
    if (label === '') return;
    ctx.fillStyle = color;
    ctx.fillRect(x - 6, 0, 12, 12);
    ctx.fillStyle = theme.background;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, 6);
  };
  if (scene.live) line(scene.now ?? recorder.end, theme.now, '', [2, 3]);
  if (scene.trigger !== undefined) line(scene.trigger, theme.trigger, 'T');
  if (view.cursorA !== undefined) line(view.cursorA, theme.cursorA, 'A');
  if (view.cursorB !== undefined) line(view.cursorB, theme.cursorB, 'B');
}
