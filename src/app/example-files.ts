/**
 * Example circuits shipped as files in `examples/` at the repository root, bundled as text at
 * build time. They are ordinary saved documents: edit one in the app and save it over the file.
 * Titles and descriptions live here because the file format (schema v1) has no metadata; the
 * order is the gallery's order.
 */
import { type CircuitDocument, parseDocument } from '../circuit';

export interface ExampleFile {
  /** The file name without `.logic.json`; also the `?example=` id. */
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
    id: 'sap-1-program-counter',
    title: 'SAP-1 Program Counter',
    description:
      'Ben Eater’s program counter: a 74HC161 counts, jumps to the bus value and a 74HC245 puts it on a 4-bit bus. CLR first.',
  },
];

// Not a JSON import: the text is kept as saved and parsed (migrated, validated) like any file.
const TEXTS = import.meta.glob<string>('../../examples/*.logic.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** An example file's text, exactly as saved. */
export function exampleText(id: string): string {
  const text = TEXTS[`../../examples/${id}.logic.json`];
  if (text === undefined) throw new Error(`no example file "${id}.logic.json"`);
  return text;
}

/** An example file loaded like any saved document. */
export function exampleDocument(id: string): CircuitDocument {
  return parseDocument(exampleText(id));
}
