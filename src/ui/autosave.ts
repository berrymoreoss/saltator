/**
 * Autosave and session restore: the open document — unsaved changes included — is written to the
 * browser's storage shortly after every change and when the page is hidden, and comes back as it
 * was after a reload or a closed tab (Q1 of the R07 plan). Each browser tab keeps its own
 * session; a new tab starts from the most recent one. The storage is behind `SessionStore`
 * (IndexedDB in the app, in memory in tests).
 */
import { type CircuitDocument, DocumentError, parseDocument } from '../circuit';
import {
  type Camera,
  type DebugSetup,
  type Editor,
  EMPTY_DEBUG_SETUP,
  parseDebugSetup,
} from '../editor';
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
  /** The id of the circuit open (R11a); the top when missing. */
  readonly open?: string;
  /** The instance of it open (R11b), by instance path; its first instance when missing. */
  readonly path?: string;
  /** The open circuit's camera. */
  readonly camera?: Camera;
  /** The debugger's breakpoints, watches and steps (R14): kept with the session, not the file. */
  readonly debug?: DebugSetup;
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
  readonly document: CircuitDocument;
  readonly open?: string;
  readonly path?: string;
  readonly camera?: Camera;
  readonly debug?: DebugSetup;
}

export function restoreSession(stored: StoredSession): RestoredSession | undefined {
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(stored.text);
  } catch (error) {
    if (error instanceof DocumentError) return undefined;
    throw error;
  }
  const session: DocumentSession = {
    name: stored.name,
    document,
    // With unsaved changes there is no saved document to compare against until the next Save.
    ...(!stored.unsaved && { saved: document }),
    ...(stored.file && { file: stored.file }),
  };
  const debug = parseDebugSetup(stored.debug);
  return {
    session,
    document,
    ...(stored.open !== undefined && { open: stored.open }),
    ...(typeof stored.path === 'string' && { path: stored.path }),
    ...(stored.camera && { camera: stored.camera }),
    ...(debug && { debug }),
  };
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
  /** How soon after a change it is written, ms. */
  readonly delay?: number;
  /** A write failed (storage full or blocked): reported once. */
  readonly onError?: (error: unknown) => void;
}

export const AUTOSAVE_DELAY = 500;

interface Written {
  readonly document: CircuitDocument;
  readonly open: string;
  readonly path: string | undefined;
  readonly session: DocumentSession;
  readonly camera: Camera;
  readonly debug: DebugSetup;
}

/**
 * Writes the open document to the store at most `delay` ms after a change (later changes in that
 * time ride along), on `flush`, and synchronously to `localStorage` on `flushOnUnload`.
 */
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
    // Only real changes count: selection clicks and pointer moves also notify these stores.
    let seen = this.#current();
    const onChange = () => {
      const now = this.#current();
      if (
        now.document === seen.document &&
        now.open === seen.open &&
        now.path === seen.path &&
        now.session === seen.session &&
        now.camera === seen.camera &&
        now.debug === seen.debug
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
      editor.debug.setup.subscribe(onChange),
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
    const record = this.#record();
    return record ? this.#put(record) : Promise.resolve();
  }

  /**
   * For `pagehide`: the page may be gone before an IndexedDB write finishes, so what changed is
   * also written synchronously to `storage` (without the file handle, which only IndexedDB can
   * keep); `recoverUnloadWrites` moves it into the store at the next start.
   */
  flushOnUnload(storage: KeyValueStorage | undefined): void {
    this.#cancel?.();
    this.#cancel = undefined;
    const record = this.#record();
    if (!record) return;
    const { file, ...rest } = record;
    try {
      storage?.setItem(
        UNLOAD_PREFIX + record.id,
        JSON.stringify({ ...rest, fileName: file?.name }),
      );
    } catch {
      // Full or blocked: the IndexedDB write below may still make it.
    }
    void this.#put(record);
  }

  #schedule(): void {
    // A pending write is not pushed back: every change is stored within `delay`.
    if (this.#cancel) return;
    this.#cancel = this.#options.schedule(() => {
      this.#cancel = undefined;
      void this.flush();
    }, this.#options.delay ?? AUTOSAVE_DELAY);
  }

  #current(): Written {
    const { editor, documents } = this.#options;
    const state = editor.state.get();
    return {
      document: state.document,
      open: state.circuit.id,
      path: state.path,
      session: documents.session.get(),
      camera: editor.view.get().camera,
      debug: editor.debug.setup.get(),
    };
  }

  /** The record to write, or undefined if nothing changed since the last one. */
  #record(): StoredSession | undefined {
    const now = this.#current();
    const last = this.#last;
    if (
      last &&
      now.document === last.document &&
      now.open === last.open &&
      now.path === last.path &&
      now.session === last.session &&
      now.debug === last.debug &&
      sameCamera(now.camera, last.camera)
    ) {
      return undefined;
    }
    this.#last = now;
    const { session, document, open, path, camera, debug } = now;
    return {
      id: this.#options.id,
      name: session.name,
      text: documentText(document),
      unsaved: hasUnsavedChanges(session, document),
      ...(open !== document.circuits[0]!.id && { open }),
      ...(path && { path }),
      camera,
      ...(debug !== EMPTY_DEBUG_SETUP && { debug }),
      updated: this.#options.now(),
      ...(session.file && { file: session.file }),
    };
  }

  async #put(record: StoredSession): Promise<void> {
    try {
      await this.#options.store.put(record);
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

const UNLOAD_PREFIX = 'saltator.unload.';

/** The parts of `localStorage` recovery needs: listing keys. */
export interface ListableStorage extends KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

/**
 * Moves sessions written by `flushOnUnload` into the store when they are newer than the stored
 * ones (the file handle is kept if the file name still matches). Run before restoring.
 */
export async function recoverUnloadWrites(
  store: SessionStore,
  storage: ListableStorage | undefined,
): Promise<void> {
  if (!storage) return;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(UNLOAD_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    try {
      const { fileName, ...pending } = JSON.parse(storage.getItem(key) ?? '') as StoredSession & {
        fileName?: string;
      };
      const current = await store.get(pending.id);
      if (!current || pending.updated > current.updated) {
        const file = current?.file?.name === fileName ? current?.file : undefined;
        await store.put({ ...pending, ...(file && { file }) });
      }
    } catch {
      // Unreadable: dropped.
    }
    storage.removeItem(key);
  }
}

/** Holds a named lock for the page's lifetime (Web Locks). */
export interface SessionLocks {
  /** True if the lock was free and is now held; false if another tab holds it. */
  hold(name: string): Promise<boolean>;
}

export const SESSION_KEY = 'saltator.session';

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

const lockName = (id: string) => `saltator.session.${id}`;

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
