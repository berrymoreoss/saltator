/**
 * Test helpers for the HD44780 module (used by the `periph` tests only): a bench that runs bus
 * cycles the way a CPU port does, with the data sheet's margins unless told otherwise.
 */
import { levelChar, ms, ns, type Time, us } from '../../core';
import { Bench, type BenchValues } from '../../core/testing';
import { type Hd44780Props, hd44780, hd44780Controller } from './hd44780';
import { type Controller, Iface } from './hd44780-controller';
import { hd44780Text } from './hd44780-frame';
import type { Hd44780Size } from './hd44780-modules';

/** One bus cycle's timing: set-up before `E` rises, `E` HIGH, hold after `E` falls, then LOW. */
export interface Cycle {
  readonly setup: Time;
  readonly high: Time;
  readonly hold: Time;
  readonly low: Time;
}

/** Comfortable margins over tAS 40, PWEH 230, tAH/tH 10, tcycE 500 ns. */
export const SAFE: Cycle = { setup: ns(100), high: ns(300), hold: ns(50), low: ns(100) };

const DB = [0, 1, 2, 3, 4, 5, 6, 7];

/** `DB0`…`DB7` driven with `byte`, or released. */
export function busValues(byte: number | 'Z', pins = DB): BenchValues {
  return Object.fromEntries(
    pins.map((i) => [`DB${i}`, byte === 'Z' ? 'Z' : (byte >> i) & 1 ? 1 : 0] as const),
  );
}

export class LcdBench {
  readonly bench: Bench;
  readonly size: Hd44780Size;

  /** A module at power-on with RS, R/W̅, E LOW and the bus released; `wait` runs past it. */
  constructor(props: Partial<Hd44780Props> = {}, wait: Time = ms(20)) {
    this.bench = new Bench(hd44780, props);
    this.size = props.size ?? '16x2';
    this.bench.set({ RS: 0, RW: 0, E: 0, V0: 0, A: 1, K: 0, ...busValues('Z') });
    this.bench.run(wait);
  }

  get controller(): Controller {
    return hd44780Controller(this.bench.sim.stateOf('DUT'))!;
  }

  get text(): string[] {
    return hd44780Text(this.controller, this.size, 'A00');
  }

  get fourBit(): boolean {
    return this.controller.iface !== Iface.EIGHT;
  }

  run(dt: Time): this {
    this.bench.run(dt);
    return this;
  }

  /** One write cycle: RS, R/W̅ = 0 and the bus, `E` pulsed; the bus stays driven. */
  write(rs: 0 | 1, byte: number, cycle: Cycle = SAFE, pins = DB): this {
    const b = this.bench;
    b.set({ RS: rs, RW: 0, ...busValues(byte, pins) });
    b.run(cycle.setup);
    b.set({ E: 1 });
    b.run(cycle.high);
    b.set({ E: 0 });
    b.run(cycle.hold);
    b.run(cycle.low);
    return this;
  }

  /** An instruction (8-bit), then `wait` (default: past any 37 µs instruction). */
  command(byte: number, wait: Time = us(60)): this {
    return this.write(0, byte).run(wait);
  }

  /** Data bytes (8-bit), each followed by `wait`. */
  data(bytes: string | readonly number[], wait: Time = us(60)): this {
    const list = typeof bytes === 'string' ? [...bytes].map((ch) => ch.charCodeAt(0)) : bytes;
    for (const byte of list) this.write(1, byte).run(wait);
    return this;
  }

  /** A 4-bit transfer of `nibble` on DB7–DB4 (DB3–DB0 released: the pull-ups hold them HIGH). */
  nibble(rs: 0 | 1, nibble: number, cycle: Cycle = SAFE): this {
    this.bench.set(busValues('Z', [0, 1, 2, 3]));
    return this.write(rs, nibble << 4, cycle, [4, 5, 6, 7]);
  }

  /** A byte in 4-bit mode: high nibble, then low, then `wait`. */
  byte4(rs: 0 | 1, byte: number, wait: Time = us(60)): this {
    return this.nibble(rs, byte >> 4)
      .nibble(rs, byte & 0xf)
      .run(wait);
  }

  /** The bus as text, DB7 first: `10100101`, `X` for unknown bits. */
  busText(): string {
    return DB.map((i) => levelChar(this.bench.get(`DB${7 - i}`))).join('');
  }

  /** One read cycle (bus released): the bus sampled just before `E` falls, DB7 first. */
  read(rs: 0 | 1, cycle: Cycle = SAFE): string {
    const b = this.bench;
    b.set({ RS: rs, RW: 1, ...busValues('Z') });
    b.run(cycle.setup);
    b.set({ E: 1 });
    b.run(cycle.high);
    const text = this.busText();
    b.set({ E: 0 });
    b.run(cycle.hold);
    b.run(cycle.low);
    b.set({ RW: 0 });
    b.run(cycle.setup);
    return text;
  }

  /** A read as a byte; throws unless every bit is known. */
  readByte(rs: 0 | 1, cycle: Cycle = SAFE): number {
    const text = this.read(rs, cycle);
    if (!/^[01]{8}$/.test(text)) throw new Error(`bus read ${text}`);
    return Number.parseInt(text, 2);
  }

  /** Ben Eater's 8-bit initialization: 8-bit, 2 lines, 5 × 8; display on, cursor on; increment. */
  initEightBit(): this {
    return this.command(0x38).command(0x0e).command(0x06);
  }

  /**
   * The data sheet's 4-bit initialization (Figure 24) with its waits, then 2 lines, display on,
   * clear, increment.
   */
  initFourBit(): this {
    this.nibble(0, 0x3).run(ms(4.2));
    this.nibble(0, 0x3).run(us(110));
    this.nibble(0, 0x3).run(us(110));
    this.nibble(0, 0x2).run(us(60));
    return this.byte4(0, 0x28).byte4(0, 0x08).byte4(0, 0x01, ms(2)).byte4(0, 0x06).byte4(0, 0x0c);
  }

  diagnostics(): string[] {
    return this.bench.diagnostics.map((d) => `${d.kind}: ${d.message}`);
  }
}
