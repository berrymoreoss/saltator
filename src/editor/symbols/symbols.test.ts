import { describe, expect, it } from 'vitest';
import { type Circuit, emptyCircuit, type Rect } from '../../circuit';
import { type PropValue, Registry } from '../../core';
import { createDefaultRegistry } from '../../library';
import { DEV_PARTS } from '../dev-parts';
import { RecordingGraphics } from '../recording-graphics';
import { buildScene } from '../scene';
import { DRAWERS, drawPartBody, GATE_STYLES, type GateStyle } from '.';

const registry = new Registry([...createDefaultRegistry().list(), ...DEV_PARTS]);

function part(type: string, props: Record<string, PropValue> = {}) {
  const circuit: Circuit = {
    ...emptyCircuit(),
    components: [{ id: 'U1', type, x: 0, y: 0, rotation: 0, flip: false, props }],
  };
  return buildScene(circuit, registry).parts[0]!;
}

function draw(type: string, props: Record<string, PropValue>, style: GateStyle) {
  const g = new RecordingGraphics();
  drawPartBody(g, part(type, props), style, 'red');
  return g;
}

function within(points: readonly (readonly [number, number])[], b: Rect): boolean {
  const eps = 1e-9;
  return points.every(
    ([x, y]) =>
      x >= b.x - eps && x <= b.x + b.width + eps && y >= b.y - eps && y <= b.y + b.height + eps,
  );
}

const GATES = ['prim/and', 'prim/nand', 'prim/or', 'prim/nor', 'prim/xor', 'prim/xnor'];

describe('gate drawers', () => {
  it('draw every gate kind for 2–8 inputs inside the layout, in both styles', () => {
    for (const type of GATES) {
      for (let inputs = 2; inputs <= 8; inputs++) {
        for (const style of GATE_STYLES) {
          const p = part(type, { inputs });
          const g = draw(type, { inputs }, style);
          const where = `${type} ×${inputs} ${style}`;
          expect(g.strokes, where).toBeGreaterThan(0);
          expect(within(g.points, p.localBounds), where).toBe(true);
        }
      }
    }
  });

  it('marks inverting gates with a bubble at the output', () => {
    const plain = draw('prim/and', {}, 'ansi');
    const inverted = draw('prim/nand', {}, 'ansi');
    expect(inverted.strokes).toBe(plain.strokes + 1);
  });

  it('labels IEC gates with their qualifying symbol', () => {
    const qualifier = (type: string) => draw(type, {}, 'iec').texts.map((t) => t.text);
    expect(qualifier('prim/and')).toEqual(['&']);
    expect(qualifier('prim/or')).toEqual(['≥1']);
    expect(qualifier('prim/xnor')).toEqual(['=1']);
    expect(qualifier('prim/not')).toEqual(['1']);
  });

  it('has a drawer for every gate-like primitive kind', () => {
    for (const kind of ['gate-and', 'buffer', 'not', 'tristate-buffer', 'constant', 'vcc', 'gnd']) {
      expect(DRAWERS[kind], kind).toBeDefined();
    }
  });
});

describe('power drawers', () => {
  it('draw constants, pulls and rails inside the layout in both styles', () => {
    const cases: [string, Record<string, PropValue>][] = [
      ['prim/constant', { value: '0' }],
      ['prim/constant', { value: 'X' }],
      ['prim/pull', { direction: 'up' }],
      ['prim/pull', { direction: 'down' }],
      ['io/vcc', {}],
      ['io/gnd', {}],
      ['prim/buffer', {}],
      ['prim/not', {}],
      ['prim/tristate-buffer', {}],
    ];
    for (const [type, props] of cases) {
      for (const style of GATE_STYLES) {
        const g = draw(type, props, style);
        const where = `${type} ${JSON.stringify(props)} ${style}`;
        expect(g.strokes + g.fills, where).toBeGreaterThan(0);
        expect(within(g.points, part(type, props).localBounds), where).toBe(true);
      }
    }
  });

  it('shows the value of a constant', () => {
    expect(draw('prim/constant', { value: 'X' }, 'ansi').texts[0]?.text).toBe('X');
  });
});
