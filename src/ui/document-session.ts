/**
 * The open document around the editor's circuit: its name, the file it came from or was saved
 * to, and the circuit as last saved — what "unsaved changes" are measured against. Pure: the
 * file is an opaque reference (a File System Access handle in the browser).
 */
import {
  type Circuit,
  type CircuitDocument,
  emptyDocument,
  sameCircuit,
  serializeDocument,
} from '../circuit';

/** Where Save writes: anything with a file name (`FileSystemFileHandle` in the browser). */
export interface FileRef {
  readonly name: string;
}

export interface DocumentSession {
  /** Shown in the title; the file name without `.logic.json`, or `Untitled`. */
  readonly name: string;
  /**
   * The document as opened or last saved. The editor edits its first circuit; the others (R11)
   * are written back unchanged.
   */
  readonly document: CircuitDocument;
  /** The file Save writes to; none for a new document, an example or a downloaded file. */
  readonly file?: FileRef;
  /** The circuit as last opened or saved; none if it has never been saved anywhere. */
  readonly saved?: Circuit;
}

export const UNTITLED = 'Untitled';
export const FILE_EXTENSION = '.logic.json';

/** A new, empty document: nothing to lose yet. */
export function newSession(): DocumentSession {
  const document = emptyDocument();
  return { name: UNTITLED, document, saved: document.circuits[0]! };
}

/** A document opened from a file (`file` where the browser gives a handle to write back to). */
export function openedSession(
  name: string,
  document: CircuitDocument,
  file?: FileRef,
): DocumentSession {
  return { name, document, saved: document.circuits[0]!, ...(file && { file }) };
}

/**
 * An untitled copy of an example: unchanged, it is not worth a "Save changes?" question (the
 * example can be opened again); Save asks where to put it.
 */
export function exampleSession(title: string, document: CircuitDocument): DocumentSession {
  return { name: title, document, saved: document.circuits[0]! };
}

/** The session after `circuit` was written (to `file`, or downloaded when there is none). */
export function savedSession(
  session: DocumentSession,
  circuit: Circuit,
  name: string,
  file?: FileRef,
): DocumentSession {
  return {
    name,
    document: documentOf(session, circuit),
    saved: circuit,
    ...(file && { file }),
  };
}

/**
 * True if `circuit` differs from what was last saved. Circuits are immutable snapshots, so undoing
 * back to the saved state makes the document clean again; a value-equal circuit (a prop changed
 * and changed back) is clean too.
 */
export function hasUnsavedChanges(session: DocumentSession, circuit: Circuit): boolean {
  return session.saved === undefined || !sameCircuit(circuit, session.saved);
}

/** The document to save: `circuit` in place of the first circuit, the others kept. */
export function documentOf(session: DocumentSession, circuit: Circuit): CircuitDocument {
  const [, ...others] = session.document.circuits;
  return { ...session.document, circuits: [circuit, ...others] };
}

/** The file's text: `serializeDocument` of `documentOf`. */
export function documentText(session: DocumentSession, circuit: Circuit): string {
  return serializeDocument(documentOf(session, circuit));
}

// Characters Windows, macOS or Linux reject in file names, and control characters.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point
const INVALID_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** `Hello, LED` → `Hello, LED.logic.json`; characters no file system accepts become `-`. */
export function fileNameOf(name: string): string {
  const safe = name.replace(INVALID_FILE_CHARS, '-').trim();
  return `${safe === '' ? UNTITLED : safe}${FILE_EXTENSION}`;
}

/** `adder.logic.json` → `adder` (also `adder.json`); a name given by the user stays as it is. */
export function nameOfFile(fileName: string): string {
  const lower = fileName.toLowerCase();
  const base = lower.endsWith(FILE_EXTENSION)
    ? fileName.slice(0, -FILE_EXTENSION.length)
    : lower.endsWith('.json')
      ? fileName.slice(0, -'.json'.length)
      : fileName;
  const name = base.trim();
  return name === '' ? UNTITLED : name;
}

/** The browser tab title: `adder — Logic`, with `• ` in front while there are unsaved changes. */
export function documentTitle(name: string, unsaved: boolean): string {
  return `${unsaved ? '• ' : ''}${name} — Logic`;
}
