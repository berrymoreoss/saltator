import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit';
import { ns, type PropDef } from '../core';
import { buildScene, selectionOf } from '../editor';
import { createDefaultRegistry } from '../library';
import { issueLocation } from './MessagesPanel';
import { formatProp } from './PropertiesPanel';
import { selectionSummary } from './StatusBar';

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
