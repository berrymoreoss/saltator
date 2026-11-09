/**
 * The open document around the editor's: its name, the file it came from or was saved to, and
 * the document as last saved — what "unsaved changes" are measured against. Pure: the file is
 * an opaque reference (a File System Access handle in the browser).
 */
import { type CircuitDocument, emptyDocument, sameDocument, serializeDocument } from '../circuit';

/** Where Save writes: anything with a file name (`FileSystemFileHandle` in the browser). */
export interface FileRef {
  readonly name: string;
}

export interface DocumentSession {
  /** Shown in the title; the file name without `.saltator.json`, or `Untitled`. */
  readonly name: string;
  /** The document as opened or last saved; the editor edits every circuit of it (R11a). */
  readonly document: CircuitDocument;
  /** The file Save writes to; none for a new document, an example or a downloaded file. */
  readonly file?: FileRef;
  /** The document as last opened or saved; none if it has never been saved anywhere. */
  readonly saved?: CircuitDocument;
}

/** The product's name: window title, About, file exports (ADR-0032). */
export const APP_NAME = 'Saltator';
export const UNTITLED = 'Untitled';
export const FILE_EXTENSION = '.saltator.json';

/** A new, empty document: nothing to lose yet. */
export function newSession(): DocumentSession {
  const document = emptyDocument();
  return { name: UNTITLED, document, saved: document };
}

/** A document opened from a file (`file` where the browser gives a handle to write back to). */
export function openedSession(
  name: string,
  document: CircuitDocument,
  file?: FileRef,
): DocumentSession {
  return { name, document, saved: document, ...(file && { file }) };
}

/**
 * An untitled copy of an example: unchanged, it is not worth a "Save changes?" question (the
 * example can be opened again); Save asks where to put it.
 */
export function exampleSession(title: string, document: CircuitDocument): DocumentSession {
  return { name: title, document, saved: document };
}

/** The session after `document` was written (to `file`, or downloaded when there is none). */
export function savedSession(
  _session: DocumentSession,
  document: CircuitDocument,
  name: string,
  file?: FileRef,
): DocumentSession {
  return { name, document, saved: document, ...(file && { file }) };
}

/**
 * True if `document` differs from what was last saved. Documents are immutable snapshots, so
 * undoing back to the saved state makes the document clean again; a value-equal document (a
 * prop changed and changed back) is clean too.
 */
export function hasUnsavedChanges(session: DocumentSession, document: CircuitDocument): boolean {
  return session.saved === undefined || !sameDocument(document, session.saved);
}

/** The file's text: `serializeDocument`. */
export function documentText(document: CircuitDocument): string {
  return serializeDocument(document);
}

// Characters Windows, macOS or Linux reject in file names, and control characters.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point
const INVALID_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** `Hello, LED` → `Hello, LED.saltator.json`; characters no file system accepts become `-`. */
export function fileNameOf(name: string): string {
  const safe = name.replace(INVALID_FILE_CHARS, '-').trim();
  return `${safe === '' ? UNTITLED : safe}${FILE_EXTENSION}`;
}

/** `adder.saltator.json` → `adder` (also `adder.json`); a name given by the user stays as it is. */
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

/** The browser tab title: `adder — Saltator`, with `• ` in front while there are unsaved changes. */
export function documentTitle(name: string, unsaved: boolean): string {
  return `${unsaved ? '• ' : ''}${name} — ${APP_NAME}`;
}
