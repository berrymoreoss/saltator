/**
 * Example circuits shipped as files in `examples/` at the repository root, bundled as text at
 * build time. They are ordinary saved documents: edit one in the app and save it over the file.
 * Titles and descriptions live here because the file format has no metadata; the
 * order is the gallery's order.
 */
import { type CircuitDocument, parseDocument } from '../circuit';

export interface ExampleFile {
  /** The file name without `.saltator.json`; also the `?example=` id. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export const EXAMPLE_FILES: readonly ExampleFile[] = [
  {
    id: 'hello-led',
    title: 'Hello, LED',
    description: 'A switch through a 74HC00 gate to an LED, and a 1 Hz clock blinking another.',
  },
  {
    id: 'half-adder',
    title: 'Half Adder',
    description: 'A + B with a 74HC86 (XOR → Sum) and a 74HC08 (AND → Carry).',
  },
  {
    id: 'net-labels',
    title: 'Net Labels',
    description:
      'Switches A and B reach a 74HC00 through labels, not wires; labels named GND tie its unused inputs.',
  },
  {
    id: 'data-bus',
    title: 'Data Bus',
    description:
      'A 74HC245 puts the DATA switches on bus D[0..7]; bus entries carry each bit to a 74HC574, LOAD latches it.',
  },
  {
    id: 'sr-latch',
    title: 'SR Latch',
    description:
      'Two cross-coupled 74HC00 NANDs remember a bit: SET and RESET buttons with pull-ups.',
  },
  {
    id: 'ring-oscillator',
    title: 'Ring Oscillator',
    description:
      'A NAND enable and two 74HC04 inverters in a ring: 54 ns period. Run at 10 ns/s to watch.',
  },
  {
    id: 'bcd-7-segment',
    title: 'BCD to 7-Segment',
    description:
      'A DIP switch sets a BCD digit; a 74HC4511 lights a common-cathode display (10–15 blank).',
  },
  {
    id: 'clock-module',
    title: 'Clock Module',
    description:
      'Ben Eater’s clock: a 555 oscillator, a debounced STEP button, a MANUAL switch, and HLT.',
  },
  {
    id: 'sap-1-register',
    title: 'SAP-1 A Register',
    description:
      'Ben Eater’s A register: two 74HC173s load an 8-bit bus and a 74HC245 puts them back on it. CLR first.',
  },
  {
    id: 'shift-register-leds',
    title: 'Shift Register LEDs',
    description:
      'A 74HC595 with both clocks tied and Q7S inverted into DS: the LEDs fill and empty by themselves. CLEAR first.',
  },
  {
    id: 'eeprom-7-segment',
    title: 'EEPROM 7-Segment Decoder',
    description:
      'An AT28C16 replaces the decoding logic: the ADDRESS switches pick a byte that lights a hex digit, 150 ns later.',
  },
  {
    id: 'ram-by-hand',
    title: 'RAM by Hand',
    description:
      'A 6116 written from switches: PROGRAM puts the DATA switches on the bus through a 74HC245, WRITE stores them at ADDRESS; the LEDs show the bus.',
  },
  {
    id: 'lcd-by-hand',
    title: 'LCD by Hand',
    description:
      'An HD44780 16×2 written from switches, 8-bit: DATA starts at 0x38 (function set) — press E, then 0x0E, 0x06; RS on for letters.',
  },
  {
    id: 'lcd-hello-world',
    title: 'LCD Hello, World',
    description:
      'A 74HC4040 steps an AT28C16 whose bytes a 74HC574 latches onto a 4-bit LCD: the data sheet’s initialization, then text. RESET first.',
  },
  {
    id: 'tft-color-bars',
    title: 'TFT Color Bars',
    description:
      'SMPTE color bars on an ST7789 240×320 in landscape: two 74HC4040s count SPI bits, an AT28C256 holds the rows, an AT28C64B D/CX and CS̅ for the initialization, a 74HC165 shifts the bytes out. RESET first; the picture takes 4 s of simulated time.',
  },
  {
    id: '6502-nop-sled',
    title: '6502 NOP Sled',
    description:
      'Ben Eater’s first 6502 step: a W65C02S whose data bus reads $EA (NOP) through resistors. After RESET it reads the vector $EAEA and counts up; the hex displays show the buses.',
  },
  {
    id: '6502-rom-ram',
    title: '6502 ROM and RAM',
    description:
      'A W65C02S runs a program from an AT28C256, its stack and data in a 62256, decoded by a 74HC00 as in Ben Eater’s 6502: it counts at $0010 and $0200 — watch the Memory tab. RESET first.',
  },
  {
    id: 'sap-1-program-counter',
    title: 'SAP-1 Program Counter',
    description:
      'Ben Eater’s program counter: a 74HC161 counts, jumps to the bus value and a 74HC245 puts it on a 4-bit bus. CLR first.',
  },
  {
    id: 'two-digit-counter',
    title: 'Two-Digit Counter',
    description:
      'Subcircuits: a 74HC163 Decade Counter inside a Counter Digit with its 74HC4511, placed twice and cascaded to count 00–99 at 10 Hz. RESET first.',
  },
  {
    id: 'verilog-address-decoder',
    title: 'Verilog Address Decoder',
    description:
      'A 6502 memory map written in Verilog instead of wired: A15–A12 and PHI2 switches select RAM, VIA or ROM; its benches test every region.',
  },
  {
    id: 'verilog-counter-traffic-light',
    title: 'Verilog Counter and Traffic Light',
    description:
      'Two Verilog modules on a 4 Hz clock: a decade counter on a hex display, its carry stepping a traffic light state machine. RST off to start.',
  },
];

// Not a JSON import: the text is kept as saved and parsed (migrated, validated) like any file.
const TEXTS = import.meta.glob<string>('../../examples/*.saltator.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** An example file's text, exactly as saved. */
export function exampleText(id: string): string {
  const text = TEXTS[`../../examples/${id}.saltator.json`];
  if (text === undefined) throw new Error(`no example file "${id}.saltator.json"`);
  return text;
}

/** An example file loaded like any saved document. */
export function exampleDocument(id: string): CircuitDocument {
  return parseDocument(exampleText(id));
}
