import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  compileCircuit,
  compileDesign,
  documentRegistry,
  emptyVerilogCircuit,
  SCHEMA_VERSION,
} from '../circuit';
import { ms, ns, us } from '../core';
import type { AnalyzerChannel, WaveView } from '../editor';
import { createDefaultRegistry, fromYosys } from '../library';
import { YOSYS_FIXTURES } from '../library/hdl/fixtures';
import {
  cursorReadout,
  moduleSignalReferences,
  referenceSuggestions,
  rowAt,
  rowKey,
  waveKey,
  waveRows,
  wheelFactor,
} from './waveforms-view';

const channel = (index: number, label: string, bits: number): AnalyzerChannel => ({
  index,
  probe: { ref: label },
  label,
  reference: label,
  vector: bits > 1,
  radix: 'hex',
  bits: Array.from({ length: bits }, (_, i) => index * 10 + i),
  bitLabels: Array.from({ length: bits }, (_, i) => `${label}${i}`),
});

const view = (extra: Partial<WaveView> = {}): WaveView => ({
  start: 0,
  scale: 1000,
  width: 1000,
  mode: 'free',
  ...extra,
});

describe('waveRows', () => {
  it('lists the channels, and an expanded vector’s bits most significant first', () => {
    const channels = [channel(0, 'CLK', 1), channel(1, 'D', 3), channel(2, 'Q', 2)];
    const rows = waveRows(channels, new Set([rowKey(channels[1]!)]), 20);
    expect(rows.map((r) => [r.channel.label, r.bit, r.y])).toEqual([
      ['CLK', undefined, 0],
      ['D', undefined, 20],
      ['D', 2, 40],
      ['D', 1, 60],
      ['D', 0, 80],
      ['Q', undefined, 100],
    ]);
    expect(rowAt(rows, 45, 0)?.bit).toBe(2);
    expect(rowAt(rows, 5, 40)?.bit).toBe(2);
    expect(rowAt(rows, 500, 0)).toBeUndefined();
  });
});

describe('cursorReadout', () => {
  it('reads the cursors, their distance and the frequency it makes', () => {
    expect(cursorReadout(view())).toEqual({});
    expect(cursorReadout(view({ cursorA: us(1.5) }))).toEqual({ a: '1.5 µs' });
    expect(cursorReadout(view({ cursorA: us(1.5), cursorB: us(4) }))).toEqual({
      a: '1.5 µs',
      b: '4 µs',
      delta: '2.5 µs',
      frequency: '400 kHz',
    });
    expect(cursorReadout(view({ cursorA: ms(2), cursorB: ms(1) }))).toMatchObject({
      delta: '-1 ms',
      frequency: '1 kHz',
    });
    expect(cursorReadout(view({ cursorA: ns(5), cursorB: ns(5) })).frequency).toBeUndefined();
  });
});

describe('waveKey', () => {
  it('maps the plot’s keys and leaves the rest to the shortcuts', () => {
    expect(waveKey('+', false)).toEqual({ kind: 'zoom', factor: 2 });
    expect(waveKey('=', false)).toEqual({ kind: 'zoom', factor: 2 });
    expect(waveKey('-', false)).toEqual({ kind: 'zoom', factor: 0.5 });
    expect(waveKey('ArrowLeft', false)).toEqual({ kind: 'pan', pages: -0.1 });
    expect(waveKey('ArrowRight', true)).toEqual({ kind: 'pan', pages: 1 });
    expect(waveKey(']', false)).toEqual({ kind: 'edge', direction: 1, cursor: 'A' });
    expect(waveKey('[', false)).toEqual({ kind: 'edge', direction: -1, cursor: 'A' });
    expect(waveKey('}', true)).toEqual({ kind: 'edge', direction: 1, cursor: 'B' });
    expect(waveKey('{', true)).toEqual({ kind: 'edge', direction: -1, cursor: 'B' });
    expect(waveKey('Home', false)).toEqual({ kind: 'fit' });
    expect(waveKey('End', false)).toEqual({ kind: 'follow' });
    expect(waveKey('ArrowDown', false)).toEqual({ kind: 'select', step: 1 });
    expect(waveKey('Delete', false)).toEqual({ kind: 'remove' });
    expect(waveKey('Escape', false)).toEqual({ kind: 'clearCursors' });
    expect(waveKey('b', false)).toBeUndefined();
    expect(waveKey('F5', false)).toBeUndefined();
  });

  it('zooms twice per 500 px of wheel', () => {
    expect(wheelFactor(-500)).toBe(2);
    expect(wheelFactor(500)).toBe(0.5);
    expect(wheelFactor(0)).toBe(1);
  });
});

describe('referenceSuggestions', () => {
  it('offers named nets, buses and pins that start with what was typed', () => {
    const registry = createDefaultRegistry();
    const circuit = new CircuitBuilder(registry)
      .add('X1', 'io/clock', { at: [0, 0] })
      .add('NL1', 'net/label', { at: [10, 1], props: { name: 'CLK' } })
      .add('U2', 'prim/not', { at: [20, 0] })
      .add('U10', 'prim/not', { at: [30, 0] })
      .connect('X1.Y', 'NL1.N')
      .build();
    const compiled = compileCircuit(circuit, registry);
    expect(referenceSuggestions(compiled, '')).toEqual(['CLK']);
    expect(referenceSuggestions(compiled, 'c')).toEqual(['CLK']);
    expect(referenceSuggestions(compiled, 'u')).toEqual(['U2.A', 'U2.Y', 'U10.A', 'U10.Y']);
    expect(referenceSuggestions(compiled, 'u', [], 2)).toHaveLength(2);
    expect(referenceSuggestions(compiled, 'zz')).toEqual([]);
  });

  it('offers the signals inside the Verilog modules a circuit places, and a module its own', () => {
    const registry = createDefaultRegistry();
    const { module } = fromYosys(YOSYS_FIXTURES.clocks);
    const clocks: Circuit = { ...emptyVerilogCircuit('clocks', 'Clocks'), verilog: { module } };
    const draft: CircuitDocument = { schemaVersion: SCHEMA_VERSION, circuits: [clocks] };
    const docRegistry = documentRegistry(draft, registry);
    const main = new CircuitBuilder(docRegistry)
      .add('A2', 'sub/clocks', { at: [0, 0] })
      .add('A1', 'sub/clocks', { at: [0, 30] })
      .build();
    const design = compileDesign({ ...draft, circuits: [main, clocks] }, registry);
    const inner = moduleSignalReferences(main, design.registry);
    expect(inner.slice(0, 3)).toEqual([
      { ref: 'A1/div', detail: 'signal in A1' },
      { ref: 'A1/rip', detail: 'signal [3:0] in A1' },
      { ref: 'A1/ten', detail: 'signal in A1' },
    ]);
    expect(inner).toHaveLength(6);
    expect(moduleSignalReferences(clocks, design.registry).map((s) => s.ref)).toEqual([
      'div',
      'rip',
      'ten',
    ]);
    const compiled = design.circuits.get('main')!;
    expect(referenceSuggestions(compiled, 'a1/r', inner)).toEqual(['A1/rip']);
  });
});
