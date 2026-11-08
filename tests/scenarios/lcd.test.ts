/**
 * The HD44780 module with real chips around it: a 74HC574 holding the bus, the data sheet's
 * initializations through it, a latch clocked too close to E falling, a register left driving
 * the bus during a read, the 4-bit wiring with DB0–DB3 open.
 */
import { describe, expect, it } from 'vitest';
import {
  KernelDiagnosticKind,
  Level,
  ms,
  ns,
  type Simulator,
  TimingViolation,
  us,
} from '../../src/core';
import { hd44780Controller, hd44780Text } from '../../src/library';
import { set, simulate } from './support';

const DATA = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * A 74HC574 (U1) on the LCD's data bus, its D inputs and CP from drivers, OE from a driver; RS,
 * R/W̅, E from drivers. `fourBit`: only Q4–Q7 go to DB4–DB7, DB0–DB3 stay open.
 */
function lcdOnLatch(fourBit = false): Simulator {
  const sim = simulate((b) => {
    b.add('DS1', 'periph/hd44780').add('U1', '74xx/74hc574');
    b.add('G', 'io/gnd').add('V', 'io/vcc');
    b.connect('V.Y', 'DS1.A').connect('G.Y', 'DS1.K').connect('G.Y', 'DS1.V0');
    for (const pin of ['CP', 'OE', 'RS', 'RW', 'E']) b.add(pin, 'test/driver');
    b.connect('CP.Y', 'U1.CP').connect('OE.Y', 'U1.OE');
    b.connect('RS.Y', 'DS1.RS').connect('RW.Y', 'DS1.RW').connect('E.Y', 'DS1.E');
    for (const i of DATA) {
      b.add(`S${i}`, 'test/driver').connect(`S${i}.Y`, `U1.D${i}`);
      if (!fourBit || i >= 4) b.net(`DB${i}`, `U1.Q${i}`, `DS1.DB${i}`);
    }
    return b;
  });
  for (const pin of ['CP', 'RS', 'RW', 'E']) set(sim, pin, 0);
  set(sim, 'OE', 0);
  for (const i of DATA) set(sim, `S${i}`, 0);
  sim.runFor(ms(20));
  return sim;
}

/** Puts `byte` into the latch: D, then a CP pulse. */
function latch(sim: Simulator, byte: number) {
  for (const i of DATA) set(sim, `S${i}`, (byte >> i) & 1 ? 1 : 0);
  sim.runFor(ns(20));
  set(sim, 'CP', 1);
  sim.runFor(ns(30));
  set(sim, 'CP', 0);
}

/** A write: the byte latched `lead` before E falls, E HIGH for 300 ns. */
function write(sim: Simulator, rs: 0 | 1, byte: number, lead = ns(400)) {
  set(sim, 'RS', rs);
  set(sim, 'RW', 0);
  if (lead >= ns(300)) {
    latch(sim, byte);
    sim.runFor(lead - ns(300) - ns(30));
    set(sim, 'E', 1);
    sim.runFor(ns(300));
  } else {
    sim.runFor(ns(100));
    set(sim, 'E', 1);
    sim.runFor(ns(300) - lead - ns(50));
    latch(sim, byte); // CP rises `lead` before E falls
    sim.runFor(lead - ns(30));
  }
  set(sim, 'E', 0);
  sim.runFor(us(60));
}

const text = (sim: Simulator) => hd44780Text(hd44780Controller(sim.stateOf('DS1'))!, '16x2', 'A00');

describe('HD44780 behind a 74HC574', () => {
  it('prints through the latch in 8-bit mode, with no diagnostics', () => {
    const sim = lcdOnLatch();
    for (const byte of [0x38, 0x0c, 0x06]) write(sim, 0, byte);
    for (const ch of 'Latched') write(sim, 1, ch.charCodeAt(0));
    expect(text(sim)[0]).toBe('Latched         ');
    expect(sim.diagnostics.entries).toEqual([]);
  });

  it('reports data latched less than tDSW before E falls (the 574 adds its delay)', () => {
    const sim = lcdOnLatch();
    for (const byte of [0x38, 0x0c, 0x06]) write(sim, 0, byte);
    write(sim, 1, 0x41, ns(80)); // CP 80 ns before: Q settles a tpd later, inside tDSW
    const late = sim.diagnostics.entries.filter((d) => d.kind === TimingViolation.SETUP);
    // 0x06 (the entry mode still in the latch) to 0x41: DB0, DB1, DB2, DB6 change late.
    expect(late.map((d) => `${d.component}.${d.pin}`)).toEqual([
      'DS1.DB0',
      'DS1.DB1',
      'DS1.DB2',
      'DS1.DB6',
    ]);
    expect(text(sim)[0]![0]).toBe('?');
  });

  it('fights the 574 when a read starts with its outputs still enabled', () => {
    const sim = lcdOnLatch();
    latch(sim, 0xff);
    set(sim, 'RW', 1);
    sim.runFor(ns(100));
    set(sim, 'E', 1);
    sim.runFor(ns(300));
    const fights = sim.diagnostics.entries.filter(
      (d) => d.kind === KernelDiagnosticKind.CONTENTION,
    );
    expect(fights.length).toBeGreaterThan(0);
    // With OE HIGH the 574 lets go and the busy flag reads clean.
    set(sim, 'E', 0);
    sim.runFor(ns(100));
    set(sim, 'OE', 1);
    sim.runFor(ns(100));
    set(sim, 'E', 1);
    sim.runFor(ns(300));
    expect(DATA.map((i) => sim.level(`DB${7 - i}`)).join('')).toBe('00000000');
  });

  it('holds X, not a 5 ns ring, when a read drives the net E is on (a wiring mistake)', () => {
    // DB0 on the clock that drives E: the read fights the clock, so E turns X. Releasing the
    // bus then would hand E back to the clock and start the read again, every tDHR.
    const sim = simulate((b) =>
      b
        .add('DS1', 'periph/hd44780')
        .add('X1', 'io/clock', { frequency: 1e5 })
        .add('V', 'io/vcc')
        .connect('X1.Y', 'DS1.E', 'DS1.DB0')
        .connect('V.Y', 'DS1.RW'),
    );
    let changes = 0;
    sim.onNetChange(() => changes++);
    sim.runFor(ms(1));
    expect(changes).toBeLessThan(100);
    expect(sim.level('X1.Y')).toBe(Level.X); // the clock and the read's X: stuck, reported
    expect(sim.diagnostics.entries.map((d) => d.kind)).toContain('uncertain-enable');
  });

  it('works in 4-bit mode with DB0–DB3 open: the pull-ups, no floating inputs', () => {
    const sim = lcdOnLatch(true);
    const nibble = (rs: 0 | 1, n: number, wait = us(60)) => {
      write(sim, rs, n << 4);
      sim.runFor(wait);
    };
    nibble(0, 0x3, ms(4.2));
    nibble(0, 0x3, us(110));
    nibble(0, 0x3, us(110));
    nibble(0, 0x2);
    for (const byte of [0x28, 0x0c, 0x01, 0x06]) {
      nibble(0, byte >> 4);
      nibble(0, byte & 0xf, ms(2));
    }
    for (const ch of '4-bit') {
      nibble(1, ch.charCodeAt(0) >> 4);
      nibble(1, ch.charCodeAt(0) & 0xf);
    }
    expect(text(sim)[0]).toBe('4-bit           ');
    expect(sim.diagnostics.entries).toEqual([]);
  });
});
