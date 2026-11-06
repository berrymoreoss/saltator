import { describe, expect, it } from 'vitest';
import { kinds, levels, set, simulate } from './support';

describe('floating inputs', () => {
  it('an unconnected gate input is reported and reads as X', () => {
    const sim = simulate((b) =>
      b.add('B', 'test/driver').add('U1', 'prim/nand').net('b', 'B.Y', 'U1.B').net('y', 'U1.Y'),
    );
    set(sim, 'B', 1);
    sim.settle();
    expect(levels(sim, 'y')).toBe('X');
    expect(sim.diagnostics.entries.map((d) => [d.kind, d.component, d.pin, d.message])).toEqual([
      [
        'floating-input',
        'U1',
        'A',
        'floating input: U1.A is unconnected, which nothing drives (reads as X)',
      ],
    ]);
  });

  it('a controlling value on the other input still decides the output', () => {
    const sim = simulate((b) =>
      b.add('B', 'test/driver').add('U1', 'prim/nand').net('b', 'B.Y', 'U1.B').net('y', 'U1.Y'),
    );
    set(sim, 'B', 0);
    sim.settle();
    expect(levels(sim, 'y')).toBe('1');
    expect(kinds(sim)).toEqual(['floating-input']); // still a wiring mistake
  });

  it('a pull resistor fixes it', () => {
    const sim = simulate((b) =>
      b
        .add('B', 'test/driver')
        .add('R1', 'prim/pull', { direction: 'up' })
        .add('U1', 'prim/nand')
        .net('a', 'R1.Y', 'U1.A')
        .net('b', 'B.Y', 'U1.B')
        .net('y', 'U1.Y'),
    );
    set(sim, 'B', 1);
    sim.settle();
    expect(levels(sim, 'a', 'y')).toBe('10');
    expect(kinds(sim)).toEqual([]);
  });

  it('outputs that nothing reads are not reported', () => {
    const sim = simulate((b) =>
      b.add('K', 'prim/constant').add('U1', 'prim/not').connect('K.Y', 'U1.A'),
    );
    sim.settle();
    expect(kinds(sim)).toEqual([]);
  });
});
