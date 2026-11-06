/**
 * Clipboard format: copied parts and wires as a one-circuit document in the file format
 * (`serializeDocument`), so a copy survives the system clipboard, pastes into another tab, and
 * reads as text. Parsing reuses the document loader (validation, migrations). Pure.
 * Spec: docs/editor.md#copy-and-paste.
 */
import { type Circuit, parseDocument, SCHEMA_VERSION, serializeDocument } from '../circuit';

/** Name of the circuit inside clipboard text. */
export const CLIPBOARD_NAME = 'Clipboard';

export function fragmentText(fragment: Circuit): string {
  return serializeDocument({
    schemaVersion: SCHEMA_VERSION,
    circuits: [{ ...fragment, id: 'clipboard', name: CLIPBOARD_NAME }],
  });
}

/**
 * The parts and wires in clipboard text, or undefined if it isn't a document (any document's
 * first circuit pastes, so a saved file's text does too) or holds nothing.
 */
export function parseFragment(text: string): Circuit | undefined {
  if (!text.trimStart().startsWith('{')) return undefined;
  try {
    const circuit = parseDocument(text).circuits[0];
    if (!circuit || circuit.components.length + circuit.wires.length === 0) return undefined;
    return circuit;
  } catch {
    return undefined;
  }
}
