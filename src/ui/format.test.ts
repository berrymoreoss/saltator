import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit';
import { diagnosticSeverity, ms, ns, type PropDef } from '../core';
import { buildScene, MAX_SPEED, REAL_TIME, type SimStatus, selectionOf } from '../editor';
import { createDefaultRegistry } from '../library';
import { issueLocation } from './MessagesPanel';
import { formatProp } from './PropertiesPanel';
import { simulationSummary } from './SimControls';
import { diagnosticLocation, diagnosticWhen } from './SimulationPanel';
import { selectionSummary, statusHint } from './StatusBar';

const registry = createDefaultRegistry();

describe('formatProp', () => {
  const def = (type: PropDef['type'], extra: Partial<PropDef> = {}): PropDef => ({
    key: 'k',
    label: 'K',
    type,
    default: 0,
    ...extra,
  });

  it('formats times, booleans, enums and units', () => {
    expect(formatProp(def('time'), ns(1.5))).toBe('1.5 ns');
    expect(formatProp(def('boolean'), true)).toBe('Yes');
    expect(formatProp(def('enum', { options: [{ value: 'up', label: 'Pull-up' }] }), 'up')).toBe(
      'Pull-up',
    );
    expect(formatProp(def('number', { unit: 'Hz' }), 10)).toBe('10 Hz');
    expect(formatProp(def('integer'), undefined)).toBe('—');
  });

  it('summarizes memory images', () => {
    const image = def('image', { max: 2048, default: '' });
    expect(formatProp(image, '')).toBe('Erased (2048 bytes)');
    expect(formatProp(image, '0000:A9FF8D 07FC:0080')).toBe('4 of 2048 bytes programmed');
    expect(formatProp(image, '0800:00')).toBe('Invalid contents');
  });
});

describe('issueLocation', () => {
  it('names the pin, part, wire or point', () => {
    const base = { severity: 'warning', code: 'undriven-input', message: '' } as const;
    expect(issueLocation({ ...base, component: 'U1', pin: 'A' })).toBe('U1.A');
    expect(issueLocation({ ...base, component: 'U1' })).toBe('U1');
    expect(issueLocation({ ...base, wire: 'w3' })).toBe('wire w3');
    expect(issueLocation({ ...base, at: [4, 7] })).toBe('(4, 7)');
  });
});

describe('selectionSummary', () => {
  const scene = buildScene(
    new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('U1', 'prim/nand', { at: [10, 0] })
      .connect('SW1.Y', 'U1.A')
      .build(),
    registry,
  );

  it('describes the selection in one line', () => {
    expect(selectionSummary(selectionOf([]), scene)).toBe('Nothing selected');
    expect(selectionSummary(selectionOf(['U1']), scene)).toBe('U1 · NAND');
    expect(selectionSummary(selectionOf([], ['w1']), scene)).toBe('Wire w1 · net SW1.Y');
    expect(selectionSummary(selectionOf(['U1', 'SW1'], ['w1']), scene)).toBe('2 parts, 1 wire');
  });
});

describe('simulationSummary', () => {
  const status = (change: Partial<SimStatus>): SimStatus => ({
    state: 'running',
    time: ms(1250),
    speed: REAL_TIME,
    actual: 1e12,
    lagging: false,
    ...change,
  });

  it('shows the state and the simulated time', () => {
    expect(simulationSummary(status({ state: 'stopped', time: 0 }))).toBe('Stopped');
    expect(simulationSummary(status({}))).toBe('Running · 1.25 s');
    expect(simulationSummary(status({ state: 'paused', time: ns(12) }))).toBe('Paused · 12 ns');
    expect(simulationSummary(status({ state: 'halted' }))).toBe(
      'Halted · 1.25 s · oscillation — Reset to restart',
    );
    expect(simulationSummary(status({ state: 'stopped', error: 'boom' }))).toBe(
      "Can't simulate: boom",
    );
  });

  it('shows the speed reached when lagging or at Max', () => {
    expect(simulationSummary(status({ lagging: true, actual: 3.1e11 }))).toBe(
      'Running · 1.25 s · actual 310 ms/s',
    );
    expect(simulationSummary(status({ speed: MAX_SPEED, actual: 2e9 }))).toBe(
      'Running · 1.25 s · max 2 ms/s',
    );
  });
});

describe('statusHint', () => {
  it('tells how the Interact tool works, and that it needs a running simulation', () => {
    expect(statusHint('interact', 'idle', registry, true)).toMatch(/^Click switches/);
    expect(statusHint('interact', 'idle', registry, false)).toMatch(/^Run \(F5\)/);
  });
});

describe('runtime diagnostics', () => {
  const d = (change: object) => ({
    time: ns(12),
    lastTime: ns(12),
    count: 1,
    kind: 'floating-input',
    message: '',
    ...change,
  });

  it('says where, when and how bad', () => {
    expect(diagnosticLocation(d({ component: 'U1', pin: 'A' }))).toBe('U1.A');
    expect(diagnosticLocation(d({ component: 'U3' }))).toBe('U3');
    expect(diagnosticLocation(d({ net: 'U1.Y' }))).toBe('net U1.Y');
    expect(diagnosticWhen(d({}))).toBe('at 12 ns');
    expect(diagnosticWhen(d({ count: 40, lastTime: ns(1500) }))).toBe('12 ns … 1.5 µs ×40');
    expect(diagnosticSeverity(d({ kind: 'contention' }))).toBe('error');
    expect(diagnosticSeverity(d({ kind: 'oscillation' }))).toBe('error');
    expect(diagnosticSeverity(d({ kind: 'setup-violation' }))).toBe('error');
    expect(diagnosticSeverity(d({ kind: 'pulse-width-violation' }))).toBe('error');
    expect(diagnosticSeverity(d({}))).toBe('warning');
  });
});
