/**
 * Test helpers for the ST7789 module (used by the `periph` tests only): a bench that sends
 * bytes the way an SPI master in mode 0 does — SDA set while SCL is LOW, sampled on the rise —
 * with the data sheet's margins unless told otherwise.
 */
import { ms, ns, type Time } from '../../core';
import { Bench } from '../../core/testing';
import { type St7789Props, st7789, st7789Controller } from './st7789';
import { Cmd, type Controller, createController, receiveByte } from './st7789-controller';
import { GRAM_WIDTH } from './st7789-panels';

/** One SCL period's halves: LOW (SDA and DC change here), then HIGH. */
export interface Clock {
  readonly low: Time;
  readonly high: Time;
}

/** Comfortable margins over tSCYCW 66, tSLW/tSHW 15, tSDS/tSDH 10 ns. */
export const SAFE_CLOCK: Clock = { low: ns(50), high: ns(50) };

/** Past the 5 ms after a reset or SWRESET and the 120 ms before SLPOUT. */
export const SETTLE = ms(130);

export class TftBench {
  readonly bench: Bench;
  clock: Clock = SAFE_CLOCK;

  /**
   * A module at power-on with RES HIGH, CS HIGH, SCL LOW, the backlight on; `wait` runs past
   * it. (No reset pulse: the registers start at their power-on defaults.)
   */
  constructor(props: Partial<St7789Props> = {}, wait: Time = ms(1)) {
    this.bench = new Bench(st7789, props);
    this.bench.set({ SCL: 0, SDA: 0, DC: 0, CS: 1, RES: 1, BLK: 1 });
    this.bench.run(wait);
  }

  get controller(): Controller {
    return st7789Controller(this.bench.sim.stateOf('DUT'))!;
  }

  /** Diagnostics so far as `kind pin ×count` (the pin and count only where there are). */
  diagnostics(): string[] {
    return this.bench.diagnostics.map(
      (d) =>
        `${d.kind}${d.pin === undefined ? '' : ` ${d.pin}`}${d.count > 1 ? ` ×${d.count}` : ''}`,
    );
  }

  run(dt: Time): this {
    this.bench.run(dt);
    return this;
  }

  /** A RES LOW pulse of `width`, then `after`. */
  reset(width: Time = ms(1), after: Time = SETTLE): this {
    this.bench.set({ RES: 0 });
    this.bench.run(width);
    this.bench.set({ RES: 1 });
    return this.run(after);
  }

  select(): this {
    this.bench.set({ CS: 0 });
    return this.run(this.clock.low);
  }

  deselect(): this {
    this.bench.set({ CS: 1 });
    return this.run(this.clock.high);
  }

  /** `count` bits of `value` (MSB first) with DC at `dc`, CS as it is. */
  bits(dc: 0 | 1, value: number, count = 8): this {
    for (let i = count - 1; i >= 0; i--) {
      this.bench.set({ SDA: (value >> i) & 1 ? 1 : 0, DC: dc });
      this.bench.run(this.clock.low);
      this.bench.set({ SCL: 1 });
      this.bench.run(this.clock.high);
      this.bench.set({ SCL: 0 });
    }
    return this;
  }

  /** One byte in its own CS frame. */
  byte(dc: 0 | 1, value: number): this {
    return this.select().bits(dc, value).deselect();
  }

  /** A command and its parameters in one CS frame, then `wait`. */
  command(code: number, params: readonly number[] = [], wait: Time = 0): this {
    this.select().bits(0, code);
    for (const p of params) this.bits(1, p);
    this.deselect();
    return wait > 0 ? this.run(wait) : this;
  }

  /** Data bytes (memory data or parameters) in one CS frame. */
  data(bytes: readonly number[]): this {
    this.select();
    for (const b of bytes) this.bits(1, b);
    return this.deselect();
  }
}

/** A controller fed bytes directly (no serial interface), and the warnings it gave. */
export class Fed {
  readonly c: Controller = createController();
  readonly warnings: string[] = [];

  command(code: number, ...params: number[]): this {
    receiveByte(this.c, 0, 0, code, (kind) => this.warnings.push(kind));
    return this.data(...params);
  }

  data(...bytes: number[]): this {
    for (const b of bytes) receiveByte(this.c, 0, 1, b, (kind) => this.warnings.push(kind));
    return this;
  }

  window(xs: number, xe: number, ys: number, ye: number): this {
    return this.command(Cmd.CASET, xs >> 8, xs & 0xff, xe >> 8, xe & 0xff).command(
      Cmd.RASET,
      ys >> 8,
      ys & 0xff,
      ye >> 8,
      ye & 0xff,
    );
  }

  /** 16-bit pixels after RAMWR. */
  pixels565(...words: number[]): this {
    this.command(Cmd.RAMWR);
    for (const w of words) this.data(w >> 8, w & 0xff);
    return this;
  }

  at(x: number, y: number): number {
    return this.c.gram[y * GRAM_WIDTH + x]!;
  }
}
