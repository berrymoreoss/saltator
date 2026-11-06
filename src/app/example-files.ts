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
