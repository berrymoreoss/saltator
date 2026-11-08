/**
 * Clipboard format: copied parts and wires as a document in the file format
 * (`serializeDocument`), so a copy survives the system clipboard, pastes into another tab, and
 * reads as text. Its first circuit is the fragment; the circuits its subcircuit instances place
 * follow (R11a, `fragmentDocument`), so instances paste into another document. Parsing reuses
 * the document loader (validation, migrations). Pure. Spec: docs/editor.md#copy-and-paste.
 */
import { type CircuitDocument, parseDocument, serializeDocument } from '../circuit';

/** Name of the fragment's circuit inside clipboard text. */
export const CLIPBOARD_NAME = 'Clipboard';

/** Clipboard text of a clipboard document (`fragmentDocument`): the fragment first. */
export function fragmentText(clipboard: CircuitDocument): string {
  const [fragment, ...carried] = clipboard.circuits;
  return serializeDocument({
    ...clipboard,
    circuits: [{ ...fragment!, name: CLIPBOARD_NAME }, ...carried],
  });
}

/**
 * The clipboard document in clipboard text — the fragment first, the circuits it needs after —
 * or undefined if it isn't a document (any document pastes its first circuit, so a saved file's
 * text does too) or its first circuit holds nothing.
 */
export function parseFragment(text: string): CircuitDocument | undefined {
  if (!text.trimStart().startsWith('{')) return undefined;
  try {
    const document = parseDocument(text);
    const fragment = document.circuits[0];
    if (!fragment || fragment.components.length + fragment.wires.length === 0) return undefined;
    return document;
  } catch {
    return undefined;
  }
}
