/**
 * The program of the LCD Hello, World example: the bytes its AT28C16 holds, one per clock step.
 * A 74HC574 latches each byte into the LCD's 4-bit bus — bits 0–3 on DB4–DB7, bit 4 on RS, bit 5
 * on E — so a nibble takes three steps (data, E HIGH, E LOW with the data held), and E never
 * changes in the same step as the data. The waits are counted in steps of the fastest clock the
 * program is written for: run the sequencer faster and the LCD reports instructions sent while
 * it was busy. Not a test file: the example's generator and its test share it.
 */
import { ms, type Time, us } from '../../src/core';

export const RS_BIT = 0x10;
export const E_BIT = 0x20;
/** The clock the waits are counted for: 10 kHz, 100 µs a step. */
export const MAX_STEP_HZ = 10_000;
/** The AT28C16's size: the 74HC4040's Q11 stops the clock when the counter gets there. */
export const PROGRAM_BYTES = 2048;

export const LINE_1 = 'Hello, world!';
export const LINE_2 = 'Test before fab';

/** The program, padded with idle bytes (E LOW) to the EEPROM's size. */
export function helloProgram(): number[] {
  const bytes: number[] = [];
  const wait = (t: Time) => {
    const steps = Math.ceil((t * MAX_STEP_HZ) / 1e12);
    for (let i = 0; i < steps; i++) bytes.push(0);
  };
  const nibble = (rs: 0 | 1, n: number) => {
    const b = (rs ? RS_BIT : 0) | (n & 0xf);
    bytes.push(b, b | E_BIT, b);
  };
  const byte = (rs: 0 | 1, value: number) => {
    nibble(rs, value >> 4);
    nibble(rs, value & 0xf);
  };
  const text = (s: string) => {
    for (const ch of s) byte(1, ch.charCodeAt(0));
  };
  // Initializing by instruction, 4-bit (HD44780U data sheet, Figure 24).
  wait(ms(20)); // more than 15 ms after VCC rises
  nibble(0, 0x3);
  wait(ms(4.1));
  nibble(0, 0x3);
  wait(us(100));
  nibble(0, 0x3);
  wait(us(100));
  nibble(0, 0x2); // 4-bit from here on
  byte(0, 0x28); // function set: 4-bit, 2 lines, 5 × 8 dots
  byte(0, 0x08); // display off
  byte(0, 0x01); // clear display: 1.52 ms at 270 kHz, 2.16 ms at 190 kHz
  wait(ms(2.2));
  byte(0, 0x06); // entry mode: increment, no shift
  byte(0, 0x0f); // display on, cursor on, blinking
  text(LINE_1);
  byte(0, 0xc0); // DDRAM address 0x40: line 2
  text(LINE_2);
  // Two steps between E falling and rising again: 200 µs at 10 kHz, past every 37 µs (52.6 µs at
  // 190 kHz) instruction; the waits above cover the rest.
  if (bytes.length > PROGRAM_BYTES) throw new Error(`program of ${bytes.length} bytes`);
  while (bytes.length < PROGRAM_BYTES) bytes.push(0);
  return bytes;
}
