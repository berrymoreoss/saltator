/**
 * Autosave and session restore: the open document — unsaved changes included — is written to the
 * browser's storage shortly after every change and when the page is hidden, and comes back as it
 * was after a reload or a closed tab (Q1 of the R07 plan). Each browser tab keeps its own
 * session; a new tab starts from the most recent one. The storage is behind `SessionStore`
 * (IndexedDB in the app, in memory in tests).
 */
import { type Circuit, DocumentError, parseDocument } from '../circuit';
import type { Camera, Editor } from '../editor';
import type { DocumentController } from './document-controller';
import {
  type DocumentSession,
  documentText,
  type FileRef,
  hasUnsavedChanges,
} from './document-session';
import type { KeyValueStorage } from './settings';

/** One tab's document as autosaved. */
export interface StoredSession {
  readonly id: string;
  readonly name: string;
  /** The editor's document in the file format (migrated like a file when restored). */
  readonly text: string;
  /** It had unsaved changes: restored, it still has them. */
  readonly unsaved: boolean;
  /** The file Save writes to (a File System Access handle, kept by IndexedDB). */
  readonly file?: FileRef;
  readonly camera?: Camera;
  /** When it was written (ms since the epoch). */
  readonly updated: number;
}

export interface SessionStore {
  get(id: string): Promise<StoredSession | undefined>;
  /** The most recently updated session. */
  latest(): Promise<StoredSession | undefined>;
  put(session: StoredSession): Promise<void>;
  /** Deletes all but the `keep` most recently updated sessions. */
  prune(keep: number): Promise<void>;
}

/** Sessions kept in storage: older ones are deleted at start-up. */
export const KEPT_SESSIONS = 10;

/** A `SessionStore` in memory (tests). */
export class MemorySessionStore implements SessionStore {
  readonly sessions = new Map<string, StoredSession>();

  async get(id: string) {
    return this.sessions.get(id);
  }
  async latest() {
    return this.#newestFirst()[0];
  }
  async put(session: StoredSession) {
    this.sessions.set(session.id, session);
  }
  async prune(keep: number) {
    for (const old of this.#newestFirst().slice(keep)) this.sessions.delete(old.id);
  }
  #newestFirst(): StoredSession[] {
    return [...this.sessions.values()].sort((a, b) => b.updated - a.updated);
  }
}

/** A stored session ready to show; `undefined` if its text no longer loads. */
export interface RestoredSession {
  readonly session: DocumentSession;
  readonly circuit: Circuit;
  readonly camera?: Camera;
}

export function restoreSession(stored: StoredSession): RestoredSession | undefined {
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(stored.text);
  } catch (error) {
    if (error instanceof DocumentError) return undefined;
    throw error;
  }
  const circuit = document.circuits[0]!;
  const session: DocumentSession = {
    name: stored.name,
    document,
    // With unsaved changes there is no saved circuit to compare against until the next Save.
    ...(!stored.unsaved && { saved: circuit }),
    ...(stored.file && { file: stored.file }),
  };
  return { session, circuit, ...(stored.camera && { camera: stored.camera }) };
}

export interface AutosaveOptions {
  readonly store: SessionStore;
  /** This tab's session id. */
  readonly id: string;
  readonly editor: Editor;
  readonly documents: DocumentController;
  /** Wall clock for `updated` (ms since the epoch). */
  readonly now: () => number;
  /** Runs `callback` after `ms`; returns a cancel function. */
  readonly schedule: (callback: () => void, ms: number) => () => void;
  /** Debounce after a change, ms. */
  readonly delay?: number;
  /** A write failed (storage full or blocked): reported once. */
  readonly onError?: (error: unknown) => void;
}

export const AUTOSAVE_DELAY = 500;

interface Written {
  readonly circuit: Circuit;
  readonly session: DocumentSession;
  readonly camera: Camera;
}

/** Writes the open document to the store after changes (debounced) and on `flush`. */
export class Autosave {
  readonly #options: AutosaveOptions;
  #cancel: (() => void) | undefined;
  #last: Written | undefined;
  #failed = false;

  constructor(options: AutosaveOptions) {
    this.#options = options;
  }

  /**
   * Starts watching the document; returns the stop function. `stored`: what is showing is already
   * this tab's stored session (restored from it), so nothing is written until it changes;
   * otherwise it is written right away (a first launch, or a copy of another tab's session).
   */
  start({ stored = false }: { readonly stored?: boolean } = {}): () => void {
    const { editor, documents } = this.#options;
    if (stored) this.#last = this.#current();
    else this.#schedule();
    // Only real changes (re)start the debounce: selection clicks and pointer moves also notify
    // these stores and must not keep pushing a pending write back.
    let seen = this.#current();
    const onChange = () => {
      const now = this.#current();
      if (
        now.circuit === seen.circuit &&
        now.session === seen.session &&
        now.camera === seen.camera
      ) {
        return;
      }
      seen = now;
      this.#schedule();
    };
    const unsubscribe = [
      editor.state.subscribe(onChange),
      documents.session.subscribe(onChange),
      editor.view.subscribe(onChange),
    ];
    return () => {
      for (const u of unsubscribe) u();
      this.#cancel?.();
      this.#cancel = undefined;
    };
  }

  /** Writes now if the document or the view changed since the last write (the page is hidden). */
  flush(): Promise<void> {
    this.#cancel?.();
    this.#cancel = undefined;
    return this.#write();
  }

  #schedule(): void {
    this.#cancel?.();
    this.#cancel = this.#options.schedule(() => {
      this.#cancel = undefined;
      void this.#write();
    }, this.#options.delay ?? AUTOSAVE_DELAY);
  }

  #current(): Written {
    const { editor, documents } = this.#options;
    return {
      circuit: editor.state.get().circuit,
      session: documents.session.get(),
      camera: editor.view.get().camera,
    };
  }

  async #write(): Promise<void> {
    const now = this.#current();
    const last = this.#last;
    if (
      last &&
      now.circuit === last.circuit &&
      now.session === last.session &&
      sameCamera(now.camera, last.camera)
    ) {
      return;
    }
    this.#last = now;
    const { session, circuit, camera } = now;
    const stored: StoredSession = {
      id: this.#options.id,
      name: session.name,
      text: documentText(session, circuit),
      unsaved: hasUnsavedChanges(session, circuit),
      camera,
      updated: this.#options.now(),
      ...(session.file && { file: session.file }),
    };
    try {
      await this.#options.store.put(stored);
    } catch (error) {
      this.#last = undefined; // try again with the next change
      if (!this.#failed) this.#options.onError?.(error);
      this.#failed = true;
    }
  }
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale;
}

/** Holds a named lock for the page's lifetime (Web Locks). */
export interface SessionLocks {
  /** True if the lock was free and is now held; false if another tab holds it. */
  hold(name: string): Promise<boolean>;
}

export const SESSION_KEY = 'logic.session';

/**
 * This tab's session id, kept in `sessionStorage` so a reload finds it. A duplicated tab copies
 * `sessionStorage`; the lock tells it apart, and it gets a new id restoring from the old one
 * (`restoreFrom`). A new tab gets a new id and nothing to restore from (it takes the latest).
 */
export async function claimSessionId(
  storage: KeyValueStorage | undefined,
  locks: SessionLocks | undefined,
  newId: () => string,
): Promise<{ readonly id: string; readonly restoreFrom?: string }> {
  const previous = storage?.getItem(SESSION_KEY) ?? undefined;
  if (previous && (!locks || (await locks.hold(lockName(previous))))) {
    return { id: previous, restoreFrom: previous };
  }
  const id = newId();
  await locks?.hold(lockName(id));
  storage?.setItem(SESSION_KEY, id);
  return { id, ...(previous && { restoreFrom: previous }) };
}

const lockName = (id: string) => `logic.session.${id}`;

/**
 * What to show at start-up: the session `restoreFrom` names, else the most recent one; `stored`
 * says whether it is already this tab's (`id`). `undefined` when there is nothing (first launch)
 * or it no longer loads.
 */
export async function sessionToRestore(
  store: SessionStore,
  id: string,
  restoreFrom: string | undefined,
): Promise<(RestoredSession & { readonly stored: boolean }) | undefined> {
  const stored = (restoreFrom && (await store.get(restoreFrom))) || (await store.latest());
  const restored = stored && restoreSession(stored);
  return restored && { ...restored, stored: stored.id === id };
}
