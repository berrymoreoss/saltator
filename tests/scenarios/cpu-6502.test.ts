/**
 * A W65C02S running programs from an AT28C256 with a 62256 for its stack and data, decoded by a
 * 74HC00 as Ben Eater's 6502 is (`computer-6502.ts`): the data sheets' timing end to end, a
 * program's results in RAM and in the registers, and a CPU lost on uninitialized RAM that a
 * reset brings back.
 */
import { describe, expect, it } from 'vitest';
import { type CpuView, Drive, type MemoryView, ns, Simulator, us } from '../../src/core';
import { w65c02s } from '../../src/library';
import { COUNT_TO_FIVE, computer, type Program } from './computer-6502';
import { kinds, scenarioRegistry } from './support';

/** Powers on with RESB LOW, releases it after a few cycles off the clock's edges (1 and 4 MHz). */
function start(sim: Simulator): Simulator {
  sim.action('R', Drive.STRONG_0);
  sim.runUntil(us(5) + ns(310));
  sim.action('R', Drive.STRONG_1);
  return sim;
}

const cpu = (sim: Simulator): CpuView => w65c02s.cpu!.view(sim.stateOf('U1'));
const ram = (sim: Simulator): MemoryView =>
  scenarioRegistry().get('mem/62256')!.memory!.view(sim.stateOf('U3'));

describe('a W65C02S computer (ROM, RAM, 74HC00 decoding)', () => {
  it('runs a program: subroutine, stack, loop; results in RAM and registers', () => {
    const sim = start(new Simulator(computer({ rom: COUNT_TO_FIVE }), scenarioRegistry()));
    sim.runUntil(us(300));
    const cells = ram(sim);
    expect([
      cells.data[0x10],
      cells.unknown[0x10],
      cells.data[0x200],
      cells.unknown[0x200],
    ]).toEqual([5, 0, 5, 0]);
    const view = cpu(sim);
    expect([view.mode, view.values[0], view.unknown[0], view.values[3]]).toEqual([
      'running',
      5,
      0,
      0xff,
    ]);
    expect(view.values[4]! >= 0x8015 && view.values[4]! <= 0x8017).toBe(true); // BRA *
    // The stack: JSR pushed the return address at $01FF/$01FE.
    expect([cells.data[0x1ff], cells.data[0x1fe]]).toEqual([0x80, 0x0b]);
    expect(kinds(sim)).toEqual([]);
  });

  it('runs at 4 MHz too, within every data sheet limit', () => {
    const sim = start(
      new Simulator(computer({ rom: COUNT_TO_FIVE, clock: 4e6 }), scenarioRegistry()),
    );
    sim.runUntil(us(100));
    expect(ram(sim).data[0x200]).toBe(5);
    expect(kinds(sim)).toEqual([]);
  });

  it('is lost when it jumps into uninitialized RAM; a reset brings it back', () => {
    const rom: Program = [
      [0x8000, [0x4c, 0x00, 0x03]], // JMP $0300
      [0xfffc, [0x00, 0x80]],
    ];
    const sim = start(new Simulator(computer({ rom }), scenarioRegistry()));
    sim.runUntil(us(30));
    expect(cpu(sim).mode).toBe('unknown');
    const lost = sim.diagnostics.entries.filter((d) => d.kind === 'cpu-lost');
    expect(lost.map((d) => d.message)).toEqual([
      'U1 fetched an opcode with unknown bits at 0x0300: its state is unknown until RESB',
    ]);
    expect(sim.level('A0')).toBe(2); // X
    sim.action('R', Drive.STRONG_0);
    sim.runUntil(us(35) + ns(250));
    sim.action('R', Drive.STRONG_1);
    sim.runUntil(us(46));
    expect(cpu(sim).mode).toBe('running');
  });
});
