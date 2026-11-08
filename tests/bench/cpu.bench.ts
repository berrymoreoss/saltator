/**
 * A W65C02S computer (ROM, RAM, 74HC00 decoding; `tests/scenarios/computer-6502.ts`) running
 * its program loop at 1 MHz: events/s and how much simulated time a second of wall time buys
 * (1.0 would be real time). R20's BE6502 runs at this clock. Results are recorded in the plan of
 * the branch that changed them.
 */
import { describe, test } from 'vitest';
import { Drive, ns, Simulator, us } from '../../src/core';
import { COUNT_TO_FIVE, computer } from '../scenarios/computer-6502';
import { scenarioRegistry } from '../scenarios/support';

describe('cpu', () => {
  test('W65C02S computer at 1 MHz: 100 µs of its program loop', async ({ bench }) => {
    // A program that never ends: the counting loop with its compare removed (BNE always taken).
    const rom = COUNT_TO_FIVE.map(([address, bytes]): [number, number[]] =>
      address === 0x8007
        ? [address, [...bytes.slice(0, 7), 0xc9, 0x00, 0xd0, 0xf5]]
        : [address, [...bytes]],
    );
    const sim = new Simulator(computer({ rom }), scenarioRegistry());
    sim.action('R', Drive.STRONG_0);
    sim.runUntil(us(5) + ns(310));
    sim.action('R', Drive.STRONG_1);
    sim.runUntil(us(50));
    const span = us(100);
    const step = () => {
      sim.runUntil(sim.now + span);
    };
    const before = sim.stats.events;
    step();
    const events = sim.stats.events - before;
    const result = await bench('W65C02S computer, 100 µs at 1 MHz', step).run();
    const perSecond = result.throughput.mean * events;
    const realTime = (result.throughput.mean * span) / 1e12;
    console.log(
      `W65C02S computer: ${events} events per 100 cycles, ${(perSecond / 1e6).toFixed(2)}M events/s, ${(realTime * 100).toFixed(1)} % of real time at 1 MHz`,
    );
  });
});
