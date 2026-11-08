/**
 * A small 65C02 computer for scenario tests, benchmarks and the carry-over property (not a test
 * file itself): a W65C02S, an AT28C256 at $8000–$FFFF, a 62256 at $0000–$3FFF (mirrored at
 * $4000–$7FFF for writes) and a 74HC00 decoding them as Ben Eater's 6502 does — ROM CE̅ = NOT
 * A15; RAM CE̅ = NAND(PHI2, NOT A15), OE̅ = A14, WE̅ = RWB — a 1 MHz clock, pull-ups on RDY,
 * IRQB, NMIB, BE and SOB, and RESB on a test driver `R`.
 */
import { formatImage, type Netlist, NetlistBuilder } from '../../src/core';

/** Bytes at CPU addresses: `[address, bytes]` runs. */
export type Program = readonly (readonly [number, readonly number[]])[];

/** A ROM image for the AT28C256 from a program at CPU addresses ($8000–$FFFF). */
export function romImage(program: Program): string {
  const rom = new Uint8Array(0x8000).fill(0xff);
  for (const [address, bytes] of program) rom.set(bytes, address - 0x8000);
  return formatImage(rom);
}

/**
 * LDX #$FF / TXS / LDA #0 / STA $10; loop: INC $10 / JSR sub / LDA $10 / CMP #5 / BNE loop /
 * STA $0200 / BRA *; sub: PHA / PLA / RTS. Ends with 5 at $10 and $0200 and in A.
 */
export const COUNT_TO_FIVE: Program = [
  [0x8000, [0xa2, 0xff, 0x9a, 0xa9, 0x00, 0x85, 0x10]],
  [0x8007, [0xe6, 0x10, 0x20, 0x20, 0x80, 0xa5, 0x10, 0xc9, 0x05, 0xd0, 0xf5]],
  [0x8012, [0x8d, 0x00, 0x02, 0x80, 0xfe]],
  [0x8020, [0x48, 0x68, 0x60]],
  [0xfffc, [0x00, 0x80]],
];

export interface ComputerOptions {
  /** The ROM's bytes at CPU addresses, the reset vector included. */
  readonly rom: Program;
  readonly clock?: number;
  /** Extra parts and connections (an output port). */
  readonly extend?: (b: NetlistBuilder) => void;
}

export function computer({ rom, clock = 1e6, extend }: ComputerOptions): Netlist {
  const b = new NetlistBuilder()
    .add('U1', 'cpu/w65c02s')
    .add('U2', 'mem/at28c256', { contents: romImage(rom) })
    .add('U3', 'mem/62256')
    .add('U4', '74xx/74hc00')
    .add('X1', 'io/clock', { frequency: clock, duty: 50 })
    .add('R', 'test/driver')
    .add('VCC', 'io/vcc')
    .add('GND', 'io/gnd');
  b.net('PHI2', 'X1.Y', 'U1.PHI2', 'U4.2A');
  b.net('RESB', 'R.Y', 'U1.RESB');
  for (const pin of ['RDY', 'IRQB', 'NMIB', 'BE', 'SOB']) {
    b.add(`R_${pin}`, 'prim/pull', { direction: 'up' }).net(pin, `R_${pin}.Y`, `U1.${pin}`);
  }
  for (let i = 0; i < 15; i++) b.net(`A${i}`, `U1.A${i}`, `U2.A${i}`, `U3.A${i}`);
  b.net('A15', 'U1.A15', 'U4.1A', 'U4.1B');
  for (let i = 0; i < 8; i++) b.net(`D${i}`, `U1.D${i}`, `U2.IO${i}`, `U3.DQ${i}`);
  b.net('NOT_A15', 'U4.1Y', 'U2.CE', 'U4.2B');
  b.net('RAM_CE', 'U4.2Y', 'U3.CE');
  b.net('A14', 'U3.OE');
  b.net('RWB', 'U1.RWB', 'U3.WE');
  b.connect('GND.Y', 'U2.OE', 'U4.3A', 'U4.3B', 'U4.4A', 'U4.4B');
  b.connect('VCC.Y', 'U2.WE');
  extend?.(b);
  return b.build();
}
