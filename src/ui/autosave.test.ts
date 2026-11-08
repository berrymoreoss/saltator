import { describe, expect, it } from 'vitest';
import { type CircuitDocument, emptyDocument, parseDocument, serializeDocument } from '../circuit';
import { ns } from '../core';
import { Editor } from '../editor';
import { createDefaultRegistry } from '../library';
import {
  Autosave,
  claimSessionId,
  MemorySessionStore,
  recoverUnloadWrites,
  restoreSession,
  type SessionLocks,
  type StoredSession,
  sessionToRestore,
} from './autosave';
import { DocumentController } from './document-controller';
import { openedSession } from './document-session';
import type { FileAccess } from './files';

const registry = createDefaultRegistry();

function nandDocument(x = 0): CircuitDocument {
  const document = emptyDocument();
  return {
    ...document,
    circuits: [
      {
        ...document.circuits[0]!,
        components: [{ id: 'U1', type: 'prim/nand', x, y: 0, rotation: 0, flip: false, props: {} }],
      },
    ],
  };
}

const noFiles: FileAccess = {
  kind: 'fallback',
  open: async () => undefined,
  read: async () => undefined,
  write: async () => false,
  saveAs: async () => undefined,
};

/** Timers under the test's control. */
class Timers {
  time = 0;
  #queue: { at: number; callback: () => void }[] = [];
  schedule = (callback: () => void, ms: number) => {
    const entry = { at: this.time + ms, callback };
    this.#queue.push(entry);
    return () => {
      this.#queue = this.#queue.filter((e) => e !== entry);
    };
  };
  advance(ms: number) {
    this.time += ms;
    const due = this.#queue.filter((e) => e.at <= this.time);
    this.#queue = this.#queue.filter((e) => e.at > this.time);
    for (const e of due) e.callback();
  }
}

class ListStorage {
  readonly data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

/** Moves U1 and flushes: the stored record. */
async function autosaved(
  autosave: Autosave,
  moveU1: (x: number) => void,
  store: MemorySessionStore,
): Promise<StoredSession> {
  moveU1(3);
  await autosave.flush();
  return (await store.get('tab-1'))!;
}

/** Lets pending promise callbacks (the store's writes) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(id = 'tab-1') {
  const editor = new Editor(registry);
  const documents = new DocumentController({
    editor,
    files: noFiles,
    askUnsaved: async () => 'discard',
    report: () => {},
  });
  const store = new MemorySessionStore();
  const timers = new Timers();
  const puts: StoredSession[] = [];
  const put = store.put.bind(store);
  store.put = async (s) => {
    puts.push(s);
    await put(s);
  };
  const autosave = new Autosave({
    store,
    id,
    editor,
    documents,
    now: () => 1_000_000 + timers.time,
    schedule: timers.schedule,
  });
  const moveU1 = (x: number) => {
    const circuit = editor.state.get().circuit;
    editor.edit('Move', {
      ...circuit,
      components: circuit.components.map((c) => (c.id === 'U1' ? { ...c, x } : c)),
    });
  };
  return { editor, documents, store, timers, puts, autosave, moveU1 };
}

describe('Autosave', () => {
  it('writes within half a second of a change; later changes in that time ride along', async () => {
    const { documents, timers, puts, autosave, moveU1 } = setup();
    documents.show(openedSession('adder', nandDocument(), { name: 'adder.logic.json' }));
    autosave.start({ stored: true });
    moveU1(1);
    timers.advance(300);
    moveU1(2);
    timers.advance(199);
    expect(puts).toHaveLength(0);
    timers.advance(1);
    await settle();
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({
      id: 'tab-1',
      name: 'adder',
      unsaved: true,
      file: { name: 'adder.logic.json' },
      updated: 1_000_500,
    });
    expect(parseDocument(puts[0]!.text).circuits[0]!.components[0]!.x).toBe(2);
  });

  it('on unload, writes synchronously to localStorage; the next start moves it into the store', async () => {
    const { documents, store, puts, autosave, moveU1 } = setup();
    documents.show(openedSession('adder', nandDocument(), { name: 'adder.logic.json' }));
    autosave.start({ stored: true });
    await autosaved(autosave, moveU1, store); // x = 3 in the store
    const local = new ListStorage();
    moveU1(7);
    autosave.flushOnUnload(local);
    const key = 'logic.unload.tab-1';
    expect(JSON.parse(local.getItem(key)!)).toMatchObject({
      name: 'adder',
      fileName: 'adder.logic.json',
    });
    expect(JSON.parse(local.getItem(key)!).file).toBeUndefined();
    autosave.flushOnUnload(local); // nothing new
    expect(puts.at(-1)!.text).toContain('"x": 7');

    // Say the IndexedDB write didn't make it (the store still has x = 3): the newer local copy
    // wins, keeping the stored handle.
    const handle = { name: 'adder.logic.json' };
    await store.put({ ...puts[0]!, file: handle, updated: 1 });
    await recoverUnloadWrites(store, local);
    const recovered = await store.get('tab-1');
    expect(parseDocument(recovered!.text).circuits[0]!.components[0]!.x).toBe(7);
    expect(recovered!.file).toBe(handle);
    expect(local.length).toBe(0);
  });

  it('recovery keeps a newer stored session and drops unreadable entries', async () => {
    const store = new MemorySessionStore();
    const local = new ListStorage();
    const newer: StoredSession = { id: 'a', name: 'kept', text: '{}', unsaved: false, updated: 9 };
    await store.put(newer);
    local.setItem('logic.unload.a', JSON.stringify({ ...newer, name: 'older', updated: 5 }));
    local.setItem('logic.unload.b', 'not json');
    local.setItem('logic.settings.v1', '{}');
    await recoverUnloadWrites(store, local);
    expect((await store.get('a'))!.name).toBe('kept');
    expect([...local.data.keys()]).toEqual(['logic.settings.v1']);
  });

  it('a selection change is not a change; a camera move is (the view comes back too)', async () => {
    const { editor, documents, timers, puts, autosave } = setup();
    documents.show(openedSession('adder', nandDocument()));
    autosave.start({ stored: true });
    editor.selectAll();
    timers.advance(1000);
    await settle();
    expect(puts).toHaveLength(0);

    editor.setCamera({ x: 3, y: 4, scale: 32 });
    timers.advance(400);
    editor.selectAll(); // doesn't push the pending write back
    timers.advance(100);
    await settle();
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ unsaved: false, camera: { x: 3, y: 4, scale: 32 } });
  });

  it('flush writes at once, and only what changed', async () => {
    const { documents, puts, autosave, moveU1 } = setup();
    documents.show(openedSession('adder', nandDocument()));
    autosave.start({ stored: true });
    await autosave.flush();
    expect(puts).toHaveLength(0);
    moveU1(2);
    await autosave.flush();
    expect(puts).toHaveLength(1);
    await autosave.flush();
    expect(puts).toHaveLength(1);
  });

  it('a session not yet stored for this tab is written right away', async () => {
    const { documents, timers, puts, autosave } = setup();
    documents.show(openedSession('copy', nandDocument()));
    autosave.start();
    timers.advance(500);
    await settle();
    expect(puts.map((p) => p.name)).toEqual(['copy']);
  });

  it('a save (new name, clean) and New are changes too; stop ends the watching', async () => {
    const { documents, timers, puts, autosave, moveU1 } = setup();
    documents.show(openedSession('a', nandDocument()));
    const stop = autosave.start({ stored: true });
    await documents.newDocument();
    timers.advance(500);
    await settle();
    expect(puts.map((p) => [p.name, p.unsaved])).toEqual([['Untitled', false]]);
    stop();
    moveU1(3);
    timers.advance(500);
    await settle();
    expect(puts).toHaveLength(1);
  });

  it('keeps the debug setup with the session; New starts without one', async () => {
    const { editor, documents, store, autosave } = setup();
    documents.show(openedSession('adder', nandDocument()));
    autosave.start({ stored: true });
    expect(editor.debug.addWatch('U1.Y')).toBeUndefined();
    editor.debug.setRunFor(ns(250));
    await autosave.flush();
    const written = (await store.get('tab-1'))!;
    expect(written.debug).toMatchObject({
      watches: [{ kind: 'signal', signal: 'U1.Y' }],
      runFor: ns(250),
    });
    const restored = restoreSession(written)!;
    expect(restored.debug).toEqual(editor.debug.setup.get());
    await documents.newDocument();
    expect(editor.debug.setup.get().watches).toEqual([]);
    await autosave.flush();
    expect((await store.get('tab-1'))!.debug).toBeUndefined();
  });

  it('a failing store is reported once and retried with the next change', async () => {
    const editor = new Editor(registry);
    const documents = new DocumentController({
      editor,
      files: noFiles,
      askUnsaved: async () => 'discard',
      report: () => {},
    });
    const errors: unknown[] = [];
    let fail = true;
    const store = new MemorySessionStore();
    const put = store.put.bind(store);
    store.put = async (s) => {
      if (fail) throw new Error('QuotaExceededError');
      await put(s);
    };
    const autosave = new Autosave({
      store,
      id: 't',
      editor,
      documents,
      now: () => 0,
      schedule: (callback) => {
        callback();
        return () => {};
      },
      onError: (e) => errors.push(e),
    });
    autosave.start();
    await settle();
    editor.edit('Place', nandDocument().circuits[0]!);
    await settle();
    expect(errors).toHaveLength(1);
    fail = false;
    await autosave.flush();
    expect(store.sessions.get('t')?.unsaved).toBe(true);
  });
});

describe('restoring a session', () => {
  const stored = (patch: Partial<StoredSession> = {}): StoredSession => ({
    id: 'a',
    name: 'adder',
    text: serializeDocument(nandDocument(4)),
    unsaved: false,
    updated: 1,
    ...patch,
  });

  it('comes back with its name, file, view and unsaved state', () => {
    const clean = restoreSession(
      stored({ file: { name: 'adder.logic.json' }, camera: { x: 1, y: 2, scale: 8 } }),
    )!;
    expect(clean.session).toMatchObject({ name: 'adder', file: { name: 'adder.logic.json' } });
    expect(clean.session.saved).toBe(clean.circuit);
    expect(clean.circuit.components[0]!.x).toBe(4);
    expect(clean.camera).toEqual({ x: 1, y: 2, scale: 8 });

    const unsaved = restoreSession(stored({ unsaved: true }))!;
    expect(unsaved.session.saved).toBeUndefined();
  });

  it('a session stored before buses (schema v1) comes back unchanged', () => {
    const text = serializeDocument(nandDocument(4)).replace(
      '"schemaVersion": 4',
      '"schemaVersion": 1',
    );
    expect(text).toContain('"schemaVersion": 1');
    const restored = restoreSession(stored({ text }))!;
    expect(restored.circuit).toEqual(nandDocument(4).circuits[0]);
  });

  it('a session that no longer loads is skipped', () => {
    expect(restoreSession(stored({ text: '{"schemaVersion": 99}' }))).toBeUndefined();
  });

  it('this tab’s session first, else the most recent one', async () => {
    const store = new MemorySessionStore();
    expect(await sessionToRestore(store, 'mine', 'mine')).toBeUndefined();
    await store.put(stored({ id: 'other', name: 'other', updated: 5 }));
    await store.put(stored({ id: 'old', name: 'old', updated: 2 }));
    expect(await sessionToRestore(store, 'new', undefined)).toMatchObject({
      stored: false,
      session: { name: 'other' },
    });
    await store.put(stored({ id: 'mine', name: 'mine', updated: 3 }));
    expect(await sessionToRestore(store, 'mine', 'mine')).toMatchObject({
      stored: true,
      session: { name: 'mine' },
    });
    // A duplicated tab restores from the session it was copied from, into its own id.
    expect(await sessionToRestore(store, 'copy', 'mine')).toMatchObject({
      stored: false,
      session: { name: 'mine' },
    });
    await store.prune(2);
    expect([...store.sessions.keys()].sort()).toEqual(['mine', 'other']);
  });
});

describe('claimSessionId', () => {
  class Storage {
    readonly data = new Map<string, string>();
    getItem(key: string) {
      return this.data.get(key) ?? null;
    }
    setItem(key: string, value: string) {
      this.data.set(key, value);
    }
  }
  const locks = (held: Set<string>): SessionLocks => ({
    hold: async (name) => {
      if (held.has(name)) return false;
      held.add(name);
      return true;
    },
  });
  let n = 0;
  const newId = () => `id${++n}`;

  it('a new tab gets a new id; a reload keeps it', async () => {
    const storage = new Storage();
    const held = new Set<string>();
    const first = await claimSessionId(storage, locks(held), newId);
    expect(first.restoreFrom).toBeUndefined();
    expect(storage.getItem('logic.session')).toBe(first.id);
    held.clear(); // the page reloaded: its locks are gone
    expect(await claimSessionId(storage, locks(held), newId)).toEqual({
      id: first.id,
      restoreFrom: first.id,
    });
  });

  it('a duplicated tab (same sessionStorage, lock taken) gets its own id', async () => {
    const storage = new Storage();
    const held = new Set<string>();
    const original = await claimSessionId(storage, locks(held), newId);
    const copy = new Storage();
    copy.setItem('logic.session', original.id);
    const duplicate = await claimSessionId(copy, locks(held), newId);
    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.restoreFrom).toBe(original.id);
    expect(copy.getItem('logic.session')).toBe(duplicate.id);
  });

  it('works without locks or storage', async () => {
    expect((await claimSessionId(undefined, undefined, newId)).id).toMatch(/^id/);
  });
});
