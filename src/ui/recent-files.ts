/**
 * File ▸ Open Recent: the last files opened or saved, by their File System Access handles (so
 * Chromium only). Kept in a `RecentStore` (IndexedDB in the app, memory in tests); the list for
 * the menu is a `Store`.
 */
import { Store } from '../editor';
import type { FileRef } from './document-session';
import type { FileAccess, OpenedFile } from './files';

export interface RecentFile {
  readonly id: string;
  readonly name: string;
  readonly handle: FileRef;
  /** When it was last opened or saved (ms since the epoch): the list is newest first. */
  readonly used: number;
}

export interface RecentStore {
  list(): Promise<RecentFile[]>;
  put(file: RecentFile): Promise<void>;
  delete(id: string): Promise<void>;
}

export const RECENT_LIMIT = 10;

export class MemoryRecentStore implements RecentStore {
  readonly files = new Map<string, RecentFile>();
  async list() {
    return [...this.files.values()];
  }
  async put(file: RecentFile) {
    this.files.set(file.id, file);
  }
  async delete(id: string) {
    this.files.delete(id);
  }
}

export interface RecentFilesOptions {
  readonly store: RecentStore;
  /** True if two handles are the same file (`FileSystemHandle.isSameEntry`). */
  readonly sameFile: (a: FileRef, b: FileRef) => Promise<boolean>;
  readonly now: () => number;
  readonly newId: () => string;
}

export class RecentFiles {
  /** Newest first, at most `RECENT_LIMIT`. */
  readonly list = new Store<readonly RecentFile[]>([]);
  readonly #options: RecentFilesOptions;
  // Changes run one after another: `add` reads the list it then writes.
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: RecentFilesOptions) {
    this.#options = options;
  }

  /** Reads the stored list. */
  load(): Promise<void> {
    return this.#serial(async () => {
      const files = await this.#options.store.list();
      this.list.set(newestFirst(files).slice(0, RECENT_LIMIT));
    });
  }

  /** Puts a file at the top (once: the same file opened again moves up). */
  add(name: string, handle: FileRef): Promise<void> {
    return this.#serial(async () => {
      const { store, sameFile, now, newId } = this.#options;
      const current = this.list.get();
      let previous: RecentFile | undefined;
      for (const file of current) {
        if (file.handle === handle || (await sameFile(file.handle, handle))) {
          previous = file;
          break;
        }
      }
      const entry: RecentFile = { id: previous?.id ?? newId(), name, handle, used: now() };
      const list = [entry, ...current.filter((f) => f !== previous)];
      this.list.set(list.slice(0, RECENT_LIMIT));
      await store.put(entry);
      for (const dropped of list.slice(RECENT_LIMIT)) await store.delete(dropped.id);
    });
  }

  remove(id: string): Promise<void> {
    return this.#serial(async () => {
      this.list.set(this.list.get().filter((f) => f.id !== id));
      await this.#options.store.delete(id);
    });
  }

  /** Clears the list. */
  clear(): Promise<void> {
    return this.#serial(async () => {
      const ids = this.list.get().map((f) => f.id);
      this.list.set([]);
      for (const id of ids) await this.#options.store.delete(id);
    });
  }

  /**
   * Reads a recent file for opening; `undefined` if permission is refused. A file that is gone
   * leaves the list, and the error says so.
   */
  async read(file: RecentFile, files: FileAccess): Promise<OpenedFile | undefined> {
    try {
      return await files.read(file.handle);
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFoundError') {
        await this.remove(file.id);
        throw new Error(`“${file.name}” was moved or deleted; it is removed from Open Recent.`);
      }
      throw error;
    }
  }

  #serial(action: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(action);
    this.#queue = next.catch(() => undefined);
    return next;
  }
}

function newestFirst(files: readonly RecentFile[]): RecentFile[] {
  return [...files].sort((a, b) => b.used - a.used);
}
