/**
 * File ▸ New, Open, Save, Save As and opening examples or dropped files: the document session
 * around the editor's document, kept in a store. Questions and failures go through injected
 * callbacks (the workbench shows them as dialogs), so every flow runs in Node tests.
 */
import { type CircuitDocument, DocumentError, parseDocument } from '../circuit';
import { type Camera, type Editor, EMPTY_SELECTION, Store } from '../editor';
import {
  type DocumentSession,
  documentText,
  exampleSession,
  fileNameOf,
  hasUnsavedChanges,
  nameOfFile,
  newSession,
  openedSession,
  savedSession,
} from './document-session';
import type { FileAccess, OpenedFile } from './files';

/** The answer to "Save changes to “name”?". */
export type UnsavedChoice = 'save' | 'discard' | 'cancel';

/** Something that went wrong with a file, for a message dialog. */
export interface FileProblem {
  readonly title: string;
  readonly message: string;
  /** One line per problem (a `DocumentError`'s list). */
  readonly details?: readonly string[];
}

export interface DocumentControllerOptions {
  readonly editor: Editor;
  readonly files: FileAccess;
  /** The document the editor shows at start-up (default: a new one). */
  readonly session?: DocumentSession;
  readonly askUnsaved: (name: string) => Promise<UnsavedChoice>;
  readonly report: (problem: FileProblem) => void;
}

export class DocumentController {
  readonly session: Store<DocumentSession>;
  readonly files: FileAccess;
  readonly #editor: Editor;
  readonly #askUnsaved: (name: string) => Promise<UnsavedChoice>;
  readonly #report: (problem: FileProblem) => void;
  // One file operation at a time: a second Save while a picker is open does nothing.
  #busy = false;

  constructor(options: DocumentControllerOptions) {
    this.#editor = options.editor;
    this.files = options.files;
    this.#askUnsaved = options.askUnsaved;
    this.#report = options.report;
    this.session = new Store(options.session ?? newSession());
  }

  /** True if the editor's document differs from what was last saved. */
  get unsaved(): boolean {
    return hasUnsavedChanges(this.session.get(), this.#editor.state.get().document);
  }

  /** File ▸ New. Resolves to false if nothing changed (cancelled). */
  newDocument(): Promise<boolean> {
    return this.#replace(async () => newSession());
  }

  /** File ▸ Open…: asks for a file, then loads it. */
  open(): Promise<boolean> {
    return this.#replace(async () => {
      const file = await this.files.open();
      return file && this.#load(file);
    });
  }

  /** Opens a file already read (dropped onto the window, picked from Open Recent). */
  openFile(file: OpenedFile | (() => Promise<OpenedFile | undefined>)): Promise<boolean> {
    return this.#replace(async () => {
      const opened = typeof file === 'function' ? await file() : file;
      return opened && this.#load(opened);
    });
  }

  /** Opens an untitled copy of an example. */
  openExample(title: string, document: () => CircuitDocument): Promise<boolean> {
    return this.#replace(async () => exampleSession(title, document()));
  }

  /** File ▸ Save: to the document's file, or Save As when it has none (or no permission). */
  save(): Promise<boolean> {
    return this.#exclusive(() => this.#save());
  }

  /** File ▸ Save As…. */
  saveAs(): Promise<boolean> {
    return this.#exclusive(() => this.#saveAs());
  }

  /**
   * Shows `session` in the editor without asking (start-up, a restored session). `document` is
   * the editor's when it differs from the session's saved one (restored unsaved changes); `open`
   * opens that circuit instead of the top; `camera` restores its view instead of zooming to fit.
   */
  show(
    session: DocumentSession,
    document: CircuitDocument = session.document,
    options: { readonly camera?: Camera; readonly open?: string } = {},
  ): void {
    const editor = this.#editor;
    editor.simulation.stop();
    editor.setDocument(document, {
      ...(options.open !== undefined && { open: options.open }),
      ...(options.camera ? { camera: options.camera } : { fit: true }),
    });
    editor.setSelection(EMPTY_SELECTION);
    this.session.set(session);
  }

  async #exclusive(action: () => Promise<boolean>): Promise<boolean> {
    if (this.#busy) return false;
    this.#busy = true;
    try {
      return await action();
    } catch (error) {
      this.#report({ title: 'File error', message: messageOf(error) });
      return false;
    } finally {
      this.#busy = false;
    }
  }

  /** Asks to save unsaved changes, then replaces the document with what `next` gives. */
  #replace(next: () => Promise<DocumentSession | undefined>): Promise<boolean> {
    return this.#exclusive(async () => {
      if (this.unsaved) {
        const choice = await this.#askUnsaved(this.session.get().name);
        if (choice === 'cancel') return false;
        if (choice === 'save' && !(await this.#save())) return false;
      }
      const session = await next();
      if (!session) return false;
      this.show(session);
      return true;
    });
  }

  /** A file's session, or undefined (and a message) if it doesn't load. */
  #load(file: OpenedFile): DocumentSession | undefined {
    try {
      return openedSession(nameOfFile(file.name), parseDocument(file.text), file.handle);
    } catch (error) {
      if (!(error instanceof DocumentError)) throw error;
      this.#report({
        title: 'Cannot open file',
        message: `“${file.name}” is not a circuit this app can open:`,
        details: error.problems,
      });
      return undefined;
    }
  }

  async #save(): Promise<boolean> {
    const session = this.session.get();
    if (session.file === undefined) return this.#saveAs();
    const { document } = this.#editor.state.get();
    if (!(await this.files.write(session.file, documentText(document)))) {
      return this.#saveAs();
    }
    this.session.set(savedSession(session, document, session.name, session.file));
    return true;
  }

  async #saveAs(): Promise<boolean> {
    const session = this.session.get();
    const { document } = this.#editor.state.get();
    const result = await this.files.saveAs(documentText(document), fileNameOf(session.name));
    if (!result) return false;
    this.session.set(savedSession(session, document, nameOfFile(result.name), result.handle));
    return true;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
