import { describe, expect, it } from 'vitest';
import { defineComponent, type PinDef, resolveProps } from '../core';
import type { ComponentInstance } from './document';
import { dipBodyWidth, partLayout, placementOf, placePins } from './layout';
import { testDip as hc00, testRegistry } from './test-parts';

const registry = testRegistry();

function dip(count: number, pins: PinDef[]) {
  return defineComponent<Record<string, never>, undefined>({
    type: 'test/dip',
    name: 'DIP',
    title: 'Test DIP',
    package: { kind: 'dip', pins: count },
    pins,
    create: () => ({}),
  });
}

const pinMap = (layout: { pins: readonly { name: string; at: readonly number[] }[] }) =>
  Object.fromEntries(layout.pins.map((p) => [p.name, p.at]));

function layoutOf(type: string, raw: Record<string, unknown> = {}) {
  const definition = registry.get(type)!;
  return partLayout(definition, resolveProps(definition, raw));
}

describe('DIP layout', () => {
  it('numbers pins like the datasheet drawing: down the left, up the right', () => {
    const layout = partLayout(hc00, {});
    const at = pinMap(layout);
    const right = dipBodyWidth(14) + 2;
    expect(at['1A']).toEqual([0, 1]); // pin 1, top-left
    expect(at.GND).toEqual([0, 7]); // pin 7, bottom-left
    expect(at['3Y']).toEqual([right, 7]); // pin 8, bottom-right
    expect(at.VCC).toEqual([right, 1]); // pin 14, top-right
    expect(layout.pins.map((p) => p.name)[0]).toBe('VCC'); // definition order kept
    expect(layout.pins.find((p) => p.name === '1Y')!.side).toBe('left');
    expect(layout.pins.find((p) => p.name === '4Y')!.side).toBe('right');
    expect(layout.body).toEqual({ x: 1, y: 0, width: 4, height: 8 });
  });

  it('uses a wider body for wide packages', () => {
    expect(dipBodyWidth(20)).toBe(4);
    expect(dipBodyWidth(24)).toBe(6);
    const pins = Array.from(
      { length: 28 },
      (_, i): PinDef => ({
        name: `P${i + 1}`,
        number: i + 1,
        dir: 'in',
      }),
    );
    const at = pinMap(partLayout(dip(28, pins), {}));
    expect(at.P14).toEqual([0, 14]);
    expect(at.P15).toEqual([8, 14]);
    expect(at.P28).toEqual([8, 1]);
  });

  it('rejects inconsistent package definitions', () => {
    const a: PinDef = { name: 'A', number: 1, dir: 'in' };
    expect(() => partLayout(dip(3, [a]), {})).toThrow('test/dip: a DIP needs an even pin count');
    expect(() => partLayout(dip(4, [a]), {})).toThrow('DIP-4 package but 1 pins defined');
    expect(() => partLayout(dip(2, [a, { name: 'B', dir: 'in' }]), {})).toThrow(
      'test/dip: pin "B" needs a unique number 1…2, got undefined',
    );
    expect(() => partLayout(dip(2, [a, { ...a, name: 'B' }]), {})).toThrow(
      'pin "B" needs a unique number 1…2, got 1',
    );
    expect(() => partLayout(dip(2, [a, { name: 'B', number: 3, dir: 'in' }]), {})).toThrow('got 3');
  });
});

describe('box layout', () => {
  it('puts inputs left and outputs right, centering the shorter side', () => {
    expect(pinMap(layoutOf('test/and'))).toEqual({ A: [0, 1], B: [0, 2], Y: [5, 1] });
    expect(pinMap(layoutOf('test/and', { inputs: 3 }))).toEqual({
      A: [0, 1],
      B: [0, 2],
      C: [0, 3],
      Y: [5, 2],
    });
    expect(pinMap(layoutOf('test/bus'))).toEqual({ A: [0, 1], EN: [0, 2], Y: [5, 1], D: [5, 2] });
    expect(layoutOf('test/and', { inputs: 4 }).body).toEqual({ x: 1, y: 0, width: 3, height: 5 });
  });

  it('handles parts without inputs', () => {
    const layout = layoutOf('test/high');
    expect(pinMap(layout)).toEqual({ Y: [5, 1] });
    expect(layout.pins[0]!.side).toBe('right');
    expect(layout.body).toEqual({ x: 1, y: 0, width: 3, height: 2 });
  });

  it('puts power and unconnected pins at the bottom', () => {
    const part = defineComponent<Record<string, never>, undefined>({
      type: 'test/box',
      name: 'BOX',
      title: 'Box',
      pins: [
        { name: 'A', dir: 'in' },
        { name: 'VCC', dir: 'power' },
        { name: 'GND', dir: 'power' },
        { name: 'NC', dir: 'nc' },
        { name: 'D', dir: 'bidir' },
      ],
      create: () => ({}),
    });
    const layout = partLayout(part, {});
    expect(pinMap(layout)).toEqual({ A: [0, 1], VCC: [2, 3], GND: [3, 3], NC: [4, 3], D: [6, 1] });
    expect(layout.pins.map((p) => p.side)).toEqual(['left', 'bottom', 'bottom', 'bottom', 'right']);
    expect(layout.body.width).toBe(4);
  });
});

describe('placePins', () => {
  const instance = (patch: Partial<ComponentInstance>): ComponentInstance => ({
    id: 'U1',
    type: 'test/and',
    x: 10,
    y: 20,
    rotation: 0,
    flip: false,
    props: {},
    ...patch,
  });
  const layout = layoutOf('test/and');
  const placed = (patch: Partial<ComponentInstance>) =>
    placePins(layout, placementOf(instance(patch)));

  it('translates, rotates and mirrors pins with their sides', () => {
    expect(placed({})).toEqual([
      { name: 'A', at: [10, 21], side: 'left' },
      { name: 'B', at: [10, 22], side: 'left' },
      { name: 'Y', at: [15, 21], side: 'right' },
    ]);
    expect(placed({ rotation: 90 })).toEqual([
      { name: 'A', at: [9, 20], side: 'top' },
      { name: 'B', at: [8, 20], side: 'top' },
      { name: 'Y', at: [9, 25], side: 'bottom' },
    ]);
    expect(placed({ flip: true })).toEqual([
      { name: 'A', at: [10, 21], side: 'right' },
      { name: 'B', at: [10, 22], side: 'right' },
      { name: 'Y', at: [5, 21], side: 'left' },
    ]);
  });
});
