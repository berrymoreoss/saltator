import { describe, expect, it } from 'vitest';
import { Level, NetlistBuilder, ns, Recorder, Simulator, us } from '../core';
import { createDefaultRegistry } from '../library';
import type { AnalyzerChannel, WaveView } from './analyzer';
import { DARK_CANVAS, LIGHT_CANVAS } from './theme';
import {
  drawWaveforms,
  rowSegments,
  rulerTicks,
  WAVE_ROW_HEIGHT,
  type WaveCanvas,
  waveformTheme,
} from './waveforms';

const registry = createDefaultRegistry();

/** X1 at 1 MHz and X2 at 500 kHz recorded for `until`; channels 0 and 1. */
function recorded(until = us(4)) {
  const netlist = new NetlistBuilder()
    .add('X1', 'io/clock', { frequency: 1e6 })
    .add('X2', 'io/clock', { frequency: 5e5 })
    .build();
  const sim = new Simulator(netlist, registry);
  const recorder = new Recorder();
  const x1 = recorder.addChannel();
  const x2 = recorder.addChannel();
  recorder.attach(
    sim,
    new Map([
      [x1, sim.pinNet('X1', 'Y')],
      [x2, sim.pinNet('X2', 'Y')],
    ]),
  );
  sim.runUntil(until);
  return { sim, recorder, x1, x2 };
}

const view = (start: number, scale: number, width: number): WaveView => ({
  start,
  scale,
  width,
  mode: 'free',
});

const channel = (index: number, bits: number[], extra: Partial<AnalyzerChannel> = {}) =>
  ({
    index,
    probe: { ref: `C${index}` },
    label: `C${index}`,
    reference: `C${index}`,
    vector: bits.length > 1,
    radix: 'hex',
    bits,
    bitLabels: bits.map((b) => `b${b}`),
    ...extra,
  }) as AnalyzerChannel;

describe('rulerTicks', () => {
  it('labels a round step at least 80 px apart, with four ticks between', () => {
    const ticks = rulerTicks(view(0, ns(1), 400)); // 1 ns a pixel: 100 ns steps
    const labels = ticks.filter((t) => t.major).map((t) => [t.label, t.x]);
    expect(labels).toEqual([
      ['0 ps', 0],
      ['100 ns', 100],
      ['200 ns', 200],
      ['300 ns', 300],
      ['400 ns', 400],
    ]);
    expect(
      ticks
        .filter((t) => !t.major)
        .slice(0, 2)
        .map((t) => t.x),
    ).toEqual([20, 40]);
    expect(rulerTicks(view(ns(150), 2000, 400)).find((t) => t.major)?.label).toBe('200 ns');
    expect(
      rulerTicks(view(0, 0.1, 400))
        .filter((t) => t.major)
        .map((t) => t.label),
    ).toEqual(['0 ps', '10 ps', '20 ps', '30 ps', '40 ps']);
    expect(rulerTicks(view(0, 1, 0))).toEqual([]);
  });
});

describe('rowSegments', () => {
  it('draws a slow signal as steady stretches with changes at the right pixel', () => {
    const { recorder, x1 } = recorded();
    // 10 ns a pixel: X1 changes every 50 px.
    const segments = rowSegments(recorder, [x1], view(0, ns(10), 160));
    expect(segments.map((s) => [s.x0, s.x1, s.kind, s.levels?.[0]])).toEqual([
      [0, 50, 'steady', Level.L0],
      [50, 100, 'steady', Level.L1],
      [100, 150, 'steady', Level.L0],
      [150, 160, 'steady', Level.L1],
    ]);
  });

  it('draws a change inside a pixel column from the next column, and many as dense', () => {
    const { recorder, x1 } = recorded();
    // 3 ns a pixel: the edge at 500 ns lies inside column 166.
    expect(rowSegments(recorder, [x1], view(0, 3000, 200)).map((s) => s.x1)[0]).toBe(167);
    // 1 µs a pixel: two edges in every column (one at its start).
    const dense = rowSegments(recorder, [x1], view(0, us(1), 4));
    expect(dense.map((s) => [s.x0, s.x1, s.kind])).toEqual([[0, 4, 'dense']]);
  });

  it('marks where the record has no data, before its start and after its end', () => {
    const { recorder, x1 } = recorded(us(1));
    const segments = rowSegments(recorder, [x1], view(ns(900), ns(100), 4));
    // X1 falls at 1 µs, the record's end: that column still shows it.
    expect(segments.map((s) => [s.x0, s.x1, s.kind, s.levels?.[0]])).toEqual([
      [0, 1, 'steady', Level.L1],
      [1, 2, 'steady', Level.L0],
      [2, 4, 'none', undefined],
    ]);
    expect(rowSegments(recorder, [99], view(0, ns(100), 2))[0]!.kind).toBe('none');
  });

  it('gives a vector its bit levels per stretch, changing when any bit does', () => {
    const { recorder, x1, x2 } = recorded();
    const segments = rowSegments(recorder, [x1, x2], view(0, ns(10), 200));
    expect(segments.map((s) => [s.x0, s.levels?.join('')])).toEqual([
      [0, '00'],
      [50, '10'],
      [100, '01'],
      [150, '11'],
    ]);
  });
});

/** A context that records what is drawn. */
function recordingCanvas() {
  const texts: string[] = [];
  let calls = 0;
  const ctx: WaveCanvas = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'middle',
    globalAlpha: 1,
    save: () => calls++,
    restore: () => calls++,
    beginPath: () => calls++,
    moveTo: () => calls++,
    lineTo: () => calls++,
    closePath: () => calls++,
    stroke: () => calls++,
    fill: () => calls++,
    rect: () => calls++,
    clip: () => calls++,
    fillRect: () => calls++,
    fillText: (text: string) => {
      texts.push(text);
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
    setLineDash: () => calls++,
  };
  return { ctx, texts, calls: () => calls };
}

describe('drawWaveforms', () => {
  it('draws the ruler, rows with their values, the cursors and the trigger', () => {
    const { recorder, x1, x2 } = recorded();
    const { ctx, texts, calls } = recordingCanvas();
    const rows = [
      { channel: channel(0, [x1]), y: 0, height: WAVE_ROW_HEIGHT },
      { channel: channel(1, [x1, x2]), y: WAVE_ROW_HEIGHT, height: WAVE_ROW_HEIGHT },
      { channel: channel(1, [x1, x2]), bit: 1, y: 2 * WAVE_ROW_HEIGHT, height: WAVE_ROW_HEIGHT },
      {
        channel: channel(2, [x1], { problem: 'no part U9' }),
        y: 3 * WAVE_ROW_HEIGHT,
        height: WAVE_ROW_HEIGHT,
      },
    ];
    for (const theme of [DARK_CANVAS, LIGHT_CANVAS]) {
      drawWaveforms(
        ctx,
        {
          recorder,
          view: { ...view(0, ns(10), 400), cursorA: ns(500), cursorB: ns(1500), selected: 0 },
          rows,
          height: 4 * WAVE_ROW_HEIGHT + 20,
          live: true,
          trigger: us(2),
        },
        waveformTheme(theme),
      );
    }
    expect(texts).toEqual(
      expect.arrayContaining(['0 ps', '1 µs', '0x0', '0x1', '0x2', 'A', 'B', 'T']),
    );
    expect(calls()).toBeGreaterThan(100);
  });
});
