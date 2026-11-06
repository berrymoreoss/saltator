/**
 * The browser side of autosave: IndexedDB (database `logic`) and Web Locks. Thin on purpose —
 * the logic is in `autosave.ts`, tested in Node with a memory store; this file is covered by the
 * browser tests.
 */
import type { SessionLocks, SessionStore, StoredSession } from './autosave';
import type { RecentFile, RecentStore } from './recent-files';

export const DATABASE = 'logic';
// 1: sessions (autosave); 2: recent (Open Recent).
const VERSION = 2;
const SESSIONS = 'sessions';
const RECENT = 'recent';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Opens (and creates or upgrades) the app's database; rejects after `timeout` ms if blocked. */
export function openDatabase(name = DATABASE, timeout = 3000): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IndexedDB did not open in time')), timeout);
    const open = indexedDB.open(name, VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        db.createObjectStore(SESSIONS, { keyPath: 'id' }).createIndex('updated', 'updated');
      }
      if (!db.objectStoreNames.contains(RECENT)) db.createObjectStore(RECENT, { keyPath: 'id' });
    };
    open.onsuccess = () => {
      clearTimeout(timer);
      resolve(open.result);
    };
    open.onerror = () => {
      clearTimeout(timer);
      reject(open.error);
    };
  });
}

export class IndexedDbSessionStore implements SessionStore {
  readonly #db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.#db = db;
  }

  async get(id: string): Promise<StoredSession | undefined> {
    const store = this.#db.transaction(SESSIONS).objectStore(SESSIONS);
    return (await request(store.get(id))) as StoredSession | undefined;
  }

  async latest(): Promise<StoredSession | undefined> {
    const index = this.#db.transaction(SESSIONS).objectStore(SESSIONS).index('updated');
    const cursor = await request(index.openCursor(null, 'prev'));
    return cursor?.value as StoredSession | undefined;
  }

  async put(session: StoredSession): Promise<void> {
    const transaction = this.#db.transaction(SESSIONS, 'readwrite');
    transaction.objectStore(SESSIONS).put(session);
    await done(transaction);
  }

  async prune(keep: number): Promise<void> {
    const transaction = this.#db.transaction(SESSIONS, 'readwrite');
    const cursors = transaction.objectStore(SESSIONS).index('updated').openCursor(null, 'prev');
    let seen = 0;
    cursors.onsuccess = () => {
      const cursor = cursors.result;
      if (!cursor) return;
      if (++seen > keep) cursor.delete();
      cursor.continue();
    };
    await done(transaction);
  }
}

export class IndexedDbRecentStore implements RecentStore {
  readonly #db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.#db = db;
  }

  async list(): Promise<RecentFile[]> {
    const store = this.#db.transaction(RECENT).objectStore(RECENT);
    return (await request(store.getAll())) as RecentFile[];
  }

  async put(file: RecentFile): Promise<void> {
    const transaction = this.#db.transaction(RECENT, 'readwrite');
    transaction.objectStore(RECENT).put(file);
    await done(transaction);
  }

  async delete(id: string): Promise<void> {
    const transaction = this.#db.transaction(RECENT, 'readwrite');
    transaction.objectStore(RECENT).delete(id);
    await done(transaction);
  }
}

/** `FileSystemHandle.isSameEntry` (Chromium). */
export async function sameFileHandle(a: unknown, b: unknown): Promise<boolean> {
  const handle = a as { isSameEntry?: (other: unknown) => Promise<boolean> };
  return (await handle.isSameEntry?.(b)) ?? false;
}

/** Web Locks, where the browser has them: a lock is held until the page closes. */
export function browserLocks(): SessionLocks | undefined {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return undefined;
  return {
    hold: (name) =>
      new Promise<boolean>((resolve) => {
        locks
          .request(name, { ifAvailable: true }, (lock) => {
            resolve(lock !== null);
            // Keep it: the callback's promise never settles.
            return lock ? new Promise<never>(() => {}) : undefined;
          })
          .catch(() => resolve(false));
      }),
  };
}
