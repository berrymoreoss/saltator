import { describe, expect, it } from 'vitest';
import type { FileRef } from './document-session';
import type { FileAccess } from './files';
import { MemoryRecentStore, RECENT_LIMIT, RecentFiles } from './recent-files';

/** Handles are equal when they name the same path (as `isSameEntry` compares entries). */
const handle = (path: string): FileRef & { path: string } => ({
  name: path.split('/').at(-1)!,
  path,
});

const pathOf = (h: FileRef) => (h as FileRef & { path: string }).path;

function setup() {
  const store = new MemoryRecentStore();
  let time = 0;
  let id = 0;
  const recent = new RecentFiles({
    store,
    sameFile: async (a, b) => pathOf(a) === pathOf(b),
    now: () => ++time,
    newId: () => `r${++id}`,
  });
  const names = () => recent.list.get().map((f) => f.name);
  return { store, recent, names };
}

const failingRead = (name: string): FileAccess => ({
  kind: 'native',
  open: async () => undefined,
  write: async () => false,
  saveAs: async () => undefined,
  read: async () => Promise.reject(Object.assign(new Error('gone'), { name })),
});

describe('RecentFiles', () => {
  it('lists files newest first, once each, at most ten', async () => {
    const { recent, names, store } = setup();
    await recent.add('a.logic.json', handle('/x/a.logic.json'));
    await recent.add('b.logic.json', handle('/x/b.logic.json'));
    // The same file again (a new handle to it) moves to the top.
    await recent.add('a.logic.json', handle('/x/a.logic.json'));
    expect(names()).toEqual(['a.logic.json', 'b.logic.json']);
    expect(store.files.size).toBe(2);

    for (let i = 0; i < RECENT_LIMIT; i++) await recent.add(`f${i}`, handle(`/y/f${i}`));
    expect(names()).toHaveLength(RECENT_LIMIT);
    expect(names()[0]).toBe('f9');
    expect(store.files.size).toBe(RECENT_LIMIT);
  });

  it('loads the stored list, newest first', async () => {
    const { store } = setup();
    await store.put({ id: '1', name: 'old', handle: handle('/old'), used: 1 });
    await store.put({ id: '2', name: 'new', handle: handle('/new'), used: 5 });
    const recent = new RecentFiles({
      store,
      sameFile: async () => false,
      now: () => 9,
      newId: () => 'n',
    });
    await recent.load();
    expect(recent.list.get().map((f) => f.name)).toEqual(['new', 'old']);
  });

  it('remove and clear', async () => {
    const { recent, names, store } = setup();
    await recent.add('a', handle('/a'));
    await recent.add('b', handle('/b'));
    await recent.remove(recent.list.get()[0]!.id);
    expect(names()).toEqual(['a']);
    await recent.clear();
    expect(names()).toEqual([]);
    expect(store.files.size).toBe(0);
  });

  it('a file that is gone leaves the list with a clear message', async () => {
    const { recent, names } = setup();
    await recent.add('a.logic.json', handle('/a.logic.json'));
    const [file] = recent.list.get();
    await expect(recent.read(file!, failingRead('NotFoundError'))).rejects.toThrow(
      '“a.logic.json” was moved or deleted',
    );
    expect(names()).toEqual([]);

    await recent.add('b.logic.json', handle('/b.logic.json'));
    await expect(recent.read(recent.list.get()[0]!, failingRead('SecurityError'))).rejects.toThrow(
      'gone',
    );
    expect(names()).toEqual(['b.logic.json']);
  });
});
