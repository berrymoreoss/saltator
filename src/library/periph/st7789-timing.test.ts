import { describe, expect, it } from 'vitest';
import { ms, ns, type Time, us } from '../../core';
import { Bench } from '../../core/testing';
import { st7789, st7789Controller } from './st7789';
import { Cmd, PIXEL_UNCERTAIN, PIXEL_X, St7789Diagnostic, Unknown } from './st7789-controller';
import { FRAME_UNCERTAIN, st7789Frame } from './st7789-frame';
import { SETTLE, TftBench } from './st7789-test-helpers';

/**
 * COLMOD 55h with the parameter's last bit (a 1) sent with SDA changing `setup` before SCL rises
 * and again `hold` after it; the other bits at safe margins.
 */
function lastBit(tft: TftBench, setup: Time, hold: Time): TftBench {
  const b = tft.bench;
  tft
    .select()
    .bits(0, Cmd.COLMOD)
    .bits(1, 0x55 >> 1, 7);
  b.set({ SDA: 0, DC: 1 });
  b.run(ns(50) - setup);
  b.set({ SDA: 1 });
  b.run(setup);
  b.set({ SCL: 1 });
  b.run(hold);
  b.set({ SDA: 0 });
  b.run(ns(50) - hold);
  b.set({ SCL: 0 });
  return tft.deselect();
}

/** A command byte whose D/CX changes to 0 `setup` before the 8th SCL rise, back `hold` after. */
function dcOnEighth(tft: TftBench, setup: Time, hold: Time): TftBench {
  const b = tft.bench;
  tft.select().bits(1, Cmd.INVON >> 1, 7);
  b.set({ SDA: 1 });
  b.run(ns(50) - setup);
  b.set({ DC: 0 });
  b.run(setup);
  b.set({ SCL: 1 });
  b.run(hold);
  b.set({ DC: 1 });
  b.run(ns(50) - hold);
  b.set({ SCL: 0 });
  return tft.deselect();
}

describe('ST7789 serial timing (Table 6)', () => {
  it('tSDS 10 ns, tSDH 10 ns: inside is silent, outside is reported and the bit unknown', () => {
    const ok = lastBit(new TftBench(), ns(10), ns(10));
    expect(ok.diagnostics()).toEqual([]);
    expect([ok.controller.colmod, ok.controller.unknown & Unknown.COLMOD]).toEqual([0x55, 0]);

    const late = lastBit(new TftBench(), ns(9), ns(20));
    expect(late.diagnostics()).toEqual(['setup-violation SDA']);
    expect(late.controller.unknown & Unknown.COLMOD).toBe(Unknown.COLMOD);

    const early = lastBit(new TftBench(), ns(20), ns(9));
    expect(early.diagnostics()).toEqual(['hold-violation SDA']);
    expect(early.controller.unknown & Unknown.COLMOD).toBe(Unknown.COLMOD);
  });

  it('tDCS/tDCH apply on the 8th edge only; outside them the byte may be either', () => {
    const ok = dcOnEighth(new TftBench(), ns(10), ns(10));
    expect(ok.diagnostics()).toEqual([]);
    expect(ok.controller.inversion).toBe(1);

    const late = dcOnEighth(new TftBench(), ns(9), ns(20));
    expect(late.diagnostics()).toEqual(['setup-violation DC', `${St7789Diagnostic.UNCERTAIN} DC`]);
    expect(late.controller.unknown).not.toBe(0);
  });

  it('tSHW, tSLW 15 ns and tSCYCW 66 ns: a short clock loses the bit phase', () => {
    /** The kinds reported (counts and the CS hold a short HIGH phase also breaks dropped). */
    const run = (low: Time, high: Time) => {
      const tft = new TftBench();
      tft.clock = { low, high };
      tft.command(Cmd.INVON);
      return tft
        .diagnostics()
        .map((d) => d.replace(/ ×\d+$/, ''))
        .filter((d) => d !== 'hold-violation CS');
    };
    expect(run(ns(52), ns(15))).toEqual([]);
    expect(run(ns(52), ns(14))).toEqual([
      'pulse-width-violation SCL',
      `${St7789Diagnostic.UNCERTAIN} SCL`,
    ]);
    expect(run(ns(15), ns(51))).toEqual([]);
    expect(run(ns(14), ns(52))[0]).toBe('pulse-width-violation SCL');
    expect(run(ns(33), ns(33))).toEqual([]);
    expect(run(ns(32), ns(33))[0]).toBe('cycle-violation SCL');
  });

  it('tCSS 15 ns before the first edge, tCSH 15 ns after the last, tCHW 40 ns HIGH', () => {
    const select = (setup: Time, hold: Time, high: Time) => {
      const tft = new TftBench();
      const b = tft.bench;
      b.set({ CS: 0, SDA: 0, DC: 0 });
      b.run(setup);
      for (let i = 7; i >= 0; i--) {
        if (i < 7) {
          b.set({ SDA: (Cmd.INVON >> i) & 1 ? 1 : 0 });
          b.run(ns(50));
        }
        b.set({ SCL: 1 });
        b.run(i === 0 ? hold : ns(50));
        b.set({ SCL: 0 });
      }
      b.set({ CS: 1 });
      b.run(high);
      b.set({ CS: 0 });
      b.run(ns(100));
      b.set({ CS: 1 });
      b.run(ns(100));
      return tft.diagnostics();
    };
    expect(select(ns(15), ns(15), ns(40))).toEqual([]);
    expect(select(ns(14), ns(15), ns(40))[0]).toBe('setup-violation CS');
    expect(select(ns(15), ns(14), ns(40))).toEqual(['hold-violation CS']);
    expect(select(ns(15), ns(15), ns(39))[0]).toBe('pulse-width-violation CS');
  });
});

describe('ST7789 reset pulse (Table 9)', () => {
  const pulse = (width: Time) => {
    const tft = new TftBench();
    tft.command(Cmd.INVON).reset(width);
    return tft;
  };

  it('resets with 10 µs', () => {
    const tft = pulse(us(10));
    expect([tft.controller.inversion, tft.controller.unknown]).toEqual([0, 0]);
    expect(tft.diagnostics()).toEqual([]);
  });

  it('rejects a spike under 5 µs, with a warning', () => {
    const tft = pulse(us(4.9));
    expect(tft.controller.inversion).toBe(1);
    expect(tft.diagnostics()).toEqual([`${St7789Diagnostic.RESET_REJECTED} RES`]);
  });

  it('may or may not reset between 5 and 10 µs: reported, what differs unknown', () => {
    const tft = pulse(us(9));
    expect(tft.diagnostics()).toEqual(['pulse-width-violation RES']);
    expect(tft.controller.inversion).toBe(0);
    expect(tft.controller.unknown & Unknown.INVERSION).toBe(Unknown.INVERSION);
    expect(tft.controller.unknown & Unknown.IDLE).toBe(0); // the same either way
  });
});

describe('ST7789 waits (Table 9 Note 7, SWRESET, SLPIN, SLPOUT): an uncertain outcome (Q5)', () => {
  it('no command for 5 ms after RESX rises', () => {
    const early = new TftBench().reset(ms(1), ms(4.9)).command(Cmd.INVON);
    expect(early.diagnostics()).toEqual([St7789Diagnostic.WAIT]);
    expect(early.controller.inversion).toBe(1);
    expect(early.controller.unknown).toBe(Unknown.INVERSION);
    const ok = new TftBench().reset(ms(1), ms(5)).command(Cmd.INVON);
    expect(ok.diagnostics()).toEqual([]);
  });

  it('no SLPOUT for 120 ms after RESX rises (and after power-on)', () => {
    const early = new TftBench().reset(ms(1), ms(119)).command(Cmd.SLPOUT);
    expect(early.diagnostics()).toEqual([St7789Diagnostic.WAIT]);
    expect(early.controller.unknown & Unknown.SLEEP).toBe(Unknown.SLEEP);
    expect(new TftBench().reset(ms(1), ms(120)).command(Cmd.SLPOUT).diagnostics()).toEqual([]);
    expect(new TftBench({}, ms(119)).command(Cmd.SLPOUT).diagnostics()).toEqual([
      St7789Diagnostic.WAIT,
    ]);
  });

  it('5 ms after SLPOUT before the next command, 120 ms before SLPIN', () => {
    const tft = new TftBench().command(Cmd.SLPOUT, [], ms(4.9)).command(Cmd.DISPON);
    expect(tft.diagnostics()).toEqual([St7789Diagnostic.WAIT]);
    const ok = new TftBench().command(Cmd.SLPOUT, [], ms(5)).command(Cmd.DISPON);
    ok.run(ms(110)).command(Cmd.SLPIN);
    expect(ok.diagnostics()).toEqual([St7789Diagnostic.WAIT]); // 115 ms < 120
    const late = new TftBench().command(Cmd.SLPOUT, [], ms(120)).command(Cmd.SLPIN);
    expect(late.diagnostics()).toEqual([]);
  });

  it('5 ms after SWRESET; in sleep-in 120 ms before SLPOUT', () => {
    const tft = new TftBench().command(Cmd.SWRESET, [], ms(5)).command(Cmd.INVON);
    expect(tft.diagnostics()).toEqual([]);
    tft.command(Cmd.SWRESET, [], ms(119)).command(Cmd.SLPOUT);
    expect(tft.diagnostics()).toEqual([St7789Diagnostic.WAIT]);
  });

  it('the MSP2008 vendor initialization (no wait after SLPOUT) shows its picture under the veil', () => {
    const tft = new TftBench();
    tft.reset(ms(20), ms(20));
    tft.command(Cmd.MADCTL, [0x00]).command(Cmd.COLMOD, [0x05]).command(Cmd.INVON);
    tft.command(Cmd.SLPOUT).command(Cmd.DISPON); // "//Delay (120);" commented out
    tft.command(Cmd.CASET, [0, 0, 0, 3]).command(Cmd.RASET, [0, 0, 0, 0]);
    tft.command(Cmd.RAMWR, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const kinds = tft.diagnostics();
    expect(kinds[0]).toMatch(/^wait-violation ×\d+$/);
    const frame = st7789Frame(tft.controller, '240x320');
    expect(frame.pixels[0]).toBe(0xffffff | FRAME_UNCERTAIN);
    expect(tft.controller.gram[0]! & PIXEL_UNCERTAIN).toBe(PIXEL_UNCERTAIN);

    // Sent again in time, the modes are known; rewritten in time, so are the pixels.
    tft.run(SETTLE).command(Cmd.SLPOUT, [], ms(5)).command(Cmd.DISPON);
    tft.command(Cmd.CASET, [0, 0, 0, 3]).command(Cmd.RASET, [0, 0, 0, 0]);
    tft.command(Cmd.RAMWR, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(st7789Frame(tft.controller, '240x320').pixels[0]).toBe(0xffffff);
  });
});

describe('ST7789 unknown inputs', () => {
  it('SDA unknown in pixel data: the pixel is unknown', () => {
    const tft = new TftBench().command(Cmd.COLMOD, [0x55]);
    tft.command(Cmd.CASET, [0, 0, 0, 0]).command(Cmd.RASET, [0, 0, 0, 0]);
    tft.select().bits(0, Cmd.RAMWR).bits(1, 0xff);
    tft.bench.set({ SDA: 'X' });
    tft.run(ns(50));
    tft.bench.set({ SCL: 1 });
    tft.run(ns(50));
    tft.bench.set({ SCL: 0 });
    tft.bits(1, 0xff, 7).deselect();
    expect(tft.controller.gram[0]).toBe(PIXEL_X);
  });

  it('a command byte with an unknown bit between commands without parameters: both may run', () => {
    const tft = new TftBench().command(Cmd.SLPOUT, [], SETTLE);
    tft.select().bits(0, Cmd.DISPOFF >> 1, 7);
    tft.bench.set({ SDA: 'X' });
    tft.run(ns(50)).bench.set({ SCL: 1 });
    tft.run(ns(50)).bench.set({ SCL: 0 });
    tft.deselect();
    expect(tft.controller.unknown).toBe(Unknown.DISPLAY); // DISPOFF or DISPON
  });

  it('a command byte with an unknown bit among commands with parameters: lost until the next', () => {
    const tft = new TftBench().command(Cmd.COLMOD, [0x55]);
    tft.command(Cmd.CASET, [0, 0, 0, 0]).command(Cmd.RASET, [0, 0, 0, 0]);
    tft.command(Cmd.RAMWR, [0xff, 0xff]);
    tft.select().bits(0, Cmd.CASET >> 1, 7);
    tft.bench.set({ SDA: 'X' });
    tft.run(ns(50)).bench.set({ SCL: 1 });
    tft.run(ns(50)).bench.set({ SCL: 0 });
    tft.bits(1, 0x00).deselect(); // CASET or RASET: a parameter of which?
    const c = tft.controller;
    expect(c.unknown & Unknown.COLUMNS).toBe(Unknown.COLUMNS);
    expect(c.gram[0]! & PIXEL_UNCERTAIN).toBe(PIXEL_UNCERTAIN); // anything may have been written
    tft.command(Cmd.INVON);
    expect(c.unknown & Unknown.INVERSION).toBe(0);
  });

  it('SCL unknown while selected: the bit phase is lost until CS rises', () => {
    const tft = new TftBench().select();
    tft.bench.set({ SCL: 'X' });
    tft.run(ns(50)).bench.set({ SCL: 0 });
    tft.bits(0, Cmd.INVON).deselect();
    expect(tft.diagnostics()).toEqual([`${St7789Diagnostic.UNCERTAIN} SCL`]);
    expect(tft.controller.unknown & Unknown.INVERSION).toBe(Unknown.INVERSION);
    tft.command(Cmd.INVOFF);
    expect([tft.controller.inversion, tft.controller.unknown & Unknown.INVERSION]).toEqual([0, 0]);
  });

  it('CS unknown when SCL rises: lost; known HIGH again: found', () => {
    const tft = new TftBench();
    tft.bench.set({ CS: 'X' });
    tft.run(ns(100)).bench.set({ SCL: 1 });
    tft.run(ns(100)).bench.set({ SCL: 0 });
    expect(tft.diagnostics()).toEqual([`${St7789Diagnostic.UNCERTAIN} SCL`]);
    tft.bench.set({ CS: 1 });
    tft.run(ns(100)).command(Cmd.INVON);
    expect([tft.controller.inversion, tft.controller.unknown & Unknown.INVERSION]).toEqual([1, 0]);
  });

  it('a CS glitch between bytes is harmless (a memory output window at a byte boundary)', () => {
    const tft = new TftBench().select().bits(0, Cmd.INVON);
    tft.bench.set({ CS: 'X' });
    tft.run(ns(100)).bench.set({ CS: 0 });
    tft.run(ns(100)).bits(0, Cmd.IDMON).deselect();
    expect(tft.diagnostics()).toEqual([]);
    expect([tft.controller.inversion, tft.controller.idle, tft.controller.unknown]).toEqual([
      1, 1, 0,
    ]);
  });

  it('a CS glitch in the middle of a byte loses the bit phase', () => {
    const tft = new TftBench().select().bits(0, Cmd.INVON >> 4, 4);
    tft.bench.set({ CS: 'X' });
    tft.run(ns(100)).bench.set({ CS: 0 });
    tft.run(ns(100));
    expect(tft.diagnostics()).toEqual([`${St7789Diagnostic.UNCERTAIN} CS`]);
  });

  it('says nothing of a CS never known yet (the power-on transient) but counts it as lost', () => {
    const b = new Bench(st7789, {});
    b.set({ SCL: 0, SDA: 0, DC: 0, CS: 'X', RES: 1, BLK: 1 });
    b.run(ns(100));
    b.set({ SCL: 1 });
    b.run(ns(100));
    b.set({ SCL: 0 });
    b.run(ns(100));
    expect(b.diagnostics).toEqual([]);
    expect(st7789Controller(b.sim.stateOf('DUT'))!.unknown).not.toBe(0);
  });

  it('RES unknown: the controller may be resetting', () => {
    const tft = new TftBench().command(Cmd.INVON);
    tft.bench.set({ RES: 'X' });
    tft.run(us(20));
    expect(tft.diagnostics()).toEqual([`${St7789Diagnostic.UNCERTAIN} RES`]);
    expect(tft.controller.unknown & Unknown.INVERSION).toBe(Unknown.INVERSION);
  });
});
