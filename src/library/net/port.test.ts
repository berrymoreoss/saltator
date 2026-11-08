import { describe, expect, it } from 'vitest';
import { pinsOf, resolveProps, symbolOf } from '../../core';
import { netLabelWidth } from './label';
import { FIRST_PORT_NAME, port, portWidth } from './port';

describe('net/port', () => {
  it('is schematic-only, an input on the left by default, with one pin joining its net', () => {
    expect(port.schematicOnly).toBe(true);
    const props = resolveProps(port);
    expect(props).toEqual({ name: FIRST_PORT_NAME, direction: 'in', side: 'auto' });
    expect(port.port!(props)).toEqual({ name: FIRST_PORT_NAME, direction: 'in', side: 'auto' });
    expect(pinsOf(port, resolveProps(port, { name: 'CLK' }))).toEqual([
      { name: 'N', dir: 'nc', net: 'CLK', description: 'the input CLK' },
    ]);
  });

  it('declares its direction and side for the instance symbol', () => {
    const props = resolveProps(port, { name: 'CO', direction: 'out', side: 'bottom' });
    expect(port.port!(props)).toEqual({ name: 'CO', direction: 'out', side: 'bottom' });
    expect(pinsOf(port, props)[0]!.description).toBe('the output CO');
    expect(() => resolveProps(port, { direction: 'up' }, 'P1')).toThrow('P1');
    expect(() => resolveProps(port, { side: 'middle' }, 'P1')).toThrow('P1');
  });

  it('is a bus port when named like a bus: its pin sits on the bus layer', () => {
    const props = resolveProps(port, { name: 'Q[0..3]', direction: 'bidir' });
    expect(pinsOf(port, props)).toEqual([
      {
        name: 'N',
        dir: 'nc',
        net: 'Q[0..3]',
        bus: true,
        description: 'the bidirectional bus Q[0..3]',
      },
    ]);
  });

  it('refuses names a net label refuses', () => {
    expect(() => resolveProps(port, { name: 'A B' }, 'P1')).toThrow('P1: prop "name" must be');
  });

  it('is a centered flag with room for a point at both ends, whatever its direction', () => {
    expect(portWidth('A')).toBe(2);
    expect(portWidth('CLK')).toBe(3);
    expect(portWidth('D[0..7]')).toBe(5);
    expect(netLabelWidth('D[0..7]')).toBe(4);
    for (const direction of ['in', 'out', 'bidir']) {
      expect(symbolOf(port, resolveProps(port, { name: 'CLK', direction }))).toEqual({
        kind: 'port',
        width: portWidth('CLK'),
        height: 1,
        centered: true,
        pins: { N: { side: 'left', offset: 0 } },
      });
    }
  });

  it('continues names like a net label, keeping direction and side', () => {
    const props = resolveProps(port, { name: 'D0', direction: 'out', side: 'right' });
    expect(port.nextProps!(props)).toEqual({ name: 'D1', direction: 'out', side: 'right' });
  });
});
