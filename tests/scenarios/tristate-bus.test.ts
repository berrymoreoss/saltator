import { describe, expect, it } from 'vitest';
import { Drive } from '../../src/core';
import { kinds, levels, set, simulate } from './support';

/** Two tri-state buffers on one bus, an optional pull-down, and a gate reading the bus. */
const bus = (pullDown: boolean) =>
  simulate((b) => {
    b.add('DA', 'test/driver')
      .add('EA', 'test/driver')
      .add('DB', 'test/driver')
      .add('EB', 'test/driver')
      .add('UA', 'prim/tristate-buffer')
      .add('UB', 'prim/tristate-buffer')
      .add('RD', 'prim/buffer')
      .net('da', 'DA.Y', 'UA.A')
      .net('ea', 'EA.Y', 'UA.EN')
      .net('db', 'DB.Y', 'UB.A')
      .net('eb', 'EB.Y', 'UB.EN')
      .net('BUS', 'UA.Y', 'UB.Y', 'RD.A')
      .net('out', 'RD.Y');
    if (pullDown) b.add('R1', 'prim/pull', { direction: 'down' }).net('BUS', 'R1.Y'); // same name joins the net
    return b;
  });

const idle = (sim: ReturnType<typeof bus>) => {
  set(sim, 'DA', 1);
  set(sim, 'DB', 0);
  set(sim, 'EA', 0);
  set(sim, 'EB', 0);
  sim.settle();
};

describe('tri-state bus with a pull-down', () => {
  it('idle bus reads weak 0', () => {
    const sim = bus(true);
    idle(sim);
    expect(levels(sim, 'BUS', 'out')).toBe('00');
    expect(sim.drives[sim.netIndex('BUS')]).toBe(Drive.WEAK_0);
    expect(kinds(sim)).toEqual([]);
  });

  it('one enabled driver puts its value on the bus', () => {
    const sim = bus(true);
    idle(sim);
    set(sim, 'EA', 1);
    sim.settle();
    expect(levels(sim, 'BUS', 'out')).toBe('11');
    expect(sim.drives[sim.netIndex('BUS')]).toBe(Drive.STRONG_1);
    set(sim, 'EA', 0);
    set(sim, 'EB', 1);
    sim.settle();
    expect(levels(sim, 'BUS', 'out')).toBe('00');
    expect(sim.drives[sim.netIndex('BUS')]).toBe(Drive.STRONG_0);
    expect(kinds(sim)).toEqual([]);
  });

  it('two drivers with opposite values: X and a contention diagnostic', () => {
    const sim = bus(true);
    idle(sim);
    set(sim, 'EA', 1);
    set(sim, 'EB', 1);
    sim.settle();
    expect(levels(sim, 'BUS', 'out')).toBe('XX');
    expect(kinds(sim)).toEqual(['contention']);
    expect(sim.diagnostics.entries[0]?.message).toBe(
      'bus contention on net "BUS": UA.Y drives strong 1, UB.Y drives strong 0, R1.Y drives weak 0',
    );
  });

  it('two drivers agreeing is fine', () => {
    const sim = bus(true);
    idle(sim);
    set(sim, 'DB', 1);
    set(sim, 'EA', 1);
    set(sim, 'EB', 1);
    sim.settle();
    expect(levels(sim, 'BUS')).toBe('1');
    expect(kinds(sim)).toEqual([]);
  });
});

describe('tri-state bus without a pull', () => {
  it('idle bus floats: the reader gets X and a floating-input diagnostic', () => {
    const sim = bus(false);
    idle(sim);
    expect(levels(sim, 'BUS', 'out')).toBe('ZX');
    expect(kinds(sim)).toEqual(['floating-input']);
    expect(sim.diagnostics.entries[0]?.message).toBe(
      'floating input: RD.A reads net "BUS", which nothing drives (reads as X)',
    );
  });
});
