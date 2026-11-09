/**
 * Browser-test helpers for files (R07). The File System Access pickers are native dialogs, so
 * they are replaced by stubs answering from a queue with real handles from the origin private
 * file system (OPFS): real `FileSystemFileHandle`s, which IndexedDB can keep and which survive a
 * reload like files on disk.
 */
import type { Page } from '@playwright/test';
import { canvas } from './support';

declare global {
  interface Window {
    __picks: { open: (string | null)[]; save: (string | null)[] };
    __pickers: number;
  }
}

/** Init script: pickers answer from `window.__picks` (`null` = the user cancels). */
export function stubFileSystemAccess() {
  const picks = { open: [] as (string | null)[], save: [] as (string | null)[] };
  const pick = async (queue: (string | null)[], create: boolean) => {
    window.__pickers++;
    const name = queue.shift();
    if (!name) throw new DOMException('The user aborted a request.', 'AbortError');
    const root = await navigator.storage.getDirectory();
    return root.getFileHandle(name, { create });
  };
  Object.assign(window, {
    __picks: picks,
    __pickers: 0,
    showOpenFilePicker: async () => [await pick(picks.open, false)],
    showSaveFilePicker: async () => pick(picks.save, true),
  });
}

/** Init script: no File System Access API, as in Firefox and Safari. */
export function hideFileSystemAccess() {
  for (const name of ['showOpenFilePicker', 'showSaveFilePicker']) {
    Object.defineProperty(window, name, { value: undefined, configurable: true });
  }
}

/** Queues the next picker answer. */
export async function pick(page: Page, kind: 'open' | 'save', name: string | null) {
  await page.evaluate((p) => window.__picks[p.kind].push(p.name), { kind, name });
}

export async function pickerCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__pickers);
}

/** A file's text in the private file system, or undefined. */
export async function readFile(page: Page, name: string): Promise<string | undefined> {
  return page.evaluate(async (n) => {
    const root = await navigator.storage.getDirectory();
    try {
      return await (await (await root.getFileHandle(n)).getFile()).text();
    } catch {
      return undefined;
    }
  }, name);
}

export async function writeFile(page: Page, name: string, text: string): Promise<void> {
  await page.evaluate(
    async ([n, t]) => {
      const root = await navigator.storage.getDirectory();
      const writable = await (await root.getFileHandle(n!, { create: true })).createWritable();
      await writable.write(t!);
      await writable.close();
    },
    [name, text],
  );
}

/** The autosaved sessions in IndexedDB (name and unsaved flag), newest first. */
export async function storedSessions(page: Page): Promise<{ name: string; unsaved: boolean }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        // The app has created the database before it rendered anything.
        const open = indexedDB.open('saltator');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction('sessions').objectStore('sessions').getAll();
          all.onsuccess = () => {
            db.close();
            const sessions = all.result as { name: string; unsaved: boolean; updated: number }[];
            resolve(
              sessions
                .sort((a, b) => b.updated - a.updated)
                .map(({ name, unsaved }) => ({ name, unsaved })),
            );
          };
        };
      }),
  );
}

export const documentName = (page: Page) => page.getByTestId('document-name');
export const unsavedDialog = (page: Page) => page.getByTestId('unsaved-dialog');
export const counts = (page: Page) => page.getByTestId('counts');

/** Hello, LED's size in the status bar. */
export const HELLO_COUNTS = '10 parts · 20 wires';

/** An edit from the keyboard: select everything and nudge it one cell right. */
export async function edit(page: Page) {
  await canvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ArrowRight');
}

/** The first part's x in a saved file's text. */
export function firstX(text: string | undefined): number {
  return JSON.parse(text ?? '{}').circuits[0].components[0].x;
}
