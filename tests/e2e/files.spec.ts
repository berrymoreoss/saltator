import { expect, type Page, test } from '@playwright/test';
import { canvas, menu, watchErrors } from './support';

// Files (R07): Save/Open through the File System Access API (stubbed in memory: the real pickers
// are native dialogs), the download/file-input fallback, "Save changes?", broken files and drops.

declare global {
  interface Window {
    __disk: Record<string, string>;
    __picks: { open: (string | null)[]; save: (string | null)[] };
    __pickers: number;
  }
}

/** An in-memory file system behind `showOpenFilePicker` / `showSaveFilePicker`. */
function stubFileSystemAccess() {
  const disk: Record<string, string> = {};
  const picks = { open: [] as (string | null)[], save: [] as (string | null)[] };
  const handle = (name: string) => ({
    kind: 'file',
    name,
    getFile: async () => new File([disk[name] ?? ''], name),
    createWritable: async () => {
      let written = '';
      return {
        write: async (data: string) => {
          written += data;
        },
        close: async () => {
          disk[name] = written;
        },
      };
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  });
  const pick = (queue: (string | null)[]) => {
    window.__pickers++;
    const name = queue.shift();
    if (!name) throw new DOMException('The user aborted a request.', 'AbortError');
    return handle(name);
  };
  Object.assign(window, {
    __disk: disk,
    __picks: picks,
    __pickers: 0,
    showOpenFilePicker: async () => [pick(picks.open)],
    showSaveFilePicker: async () => pick(picks.save),
  });
}

/** Hides the File System Access API, as in Firefox and Safari. */
function hideFileSystemAccess() {
  for (const name of ['showOpenFilePicker', 'showSaveFilePicker']) {
    Object.defineProperty(window, name, { value: undefined, configurable: true });
  }
}

const documentName = (page: Page) => page.getByTestId('document-name');
const unsavedDialog = (page: Page) => page.getByTestId('unsaved-dialog');

/** An edit from the keyboard: select everything and nudge it one cell right. */
async function edit(page: Page) {
  await canvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ArrowRight');
}

async function disk(page: Page, name: string): Promise<string | undefined> {
  return page.evaluate((n) => window.__disk[n], name);
}

async function pick(page: Page, kind: 'open' | 'save', name: string | null) {
  await page.evaluate((p) => window.__picks[p.kind].push(p.name), { kind, name });
}

const HELLO_COUNTS = '10 parts · 20 wires';

test.describe('with the File System Access API', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(stubFileSystemAccess);
  });

  test('Save writes a file, Save again needs no picker, Open reads it back', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page).toHaveTitle('Hello, LED — Logic');
    await expect(documentName(page)).toHaveText('Hello, LED');

    await edit(page);
    await expect(page).toHaveTitle('• Hello, LED — Logic');
    await expect(documentName(page)).toHaveText('•Hello, LED');

    await pick(page, 'save', 'hello.logic.json');
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page).toHaveTitle('hello — Logic');
    const first = JSON.parse((await disk(page, 'hello.logic.json'))!);
    expect(first.circuits[0].components[0]).toMatchObject({ id: 'SW1', x: 1 });

    // Saved state reached again by undo: clean; redo: unsaved.
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(page).toHaveTitle('• hello — Logic');
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect(page).toHaveTitle('hello — Logic');

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page).toHaveTitle('hello — Logic');
    expect(await page.evaluate(() => window.__pickers)).toBe(1);
    const second = JSON.parse((await disk(page, 'hello.logic.json'))!);
    expect(second.circuits[0].components[0]).toMatchObject({ id: 'SW1', x: 2 });

    await menu(page, 'File', 'New Circuit');
    await expect(page).toHaveTitle('Untitled — Logic');
    await expect(page.getByTestId('counts')).toHaveText('0 parts · 0 wires');

    await pick(page, 'open', 'hello.logic.json');
    await page.keyboard.press('ControlOrMeta+O');
    await expect(page).toHaveTitle('hello — Logic');
    await expect(page.getByTestId('counts')).toHaveText(HELLO_COUNTS);
    // Opening isn't an edit: nothing to undo.
    await expect(page.getByRole('button', { name: /^Undo/ })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('replacing unsaved changes asks first: Cancel, Save, Don’t Save', async ({ page }) => {
    await page.goto('/');
    await edit(page);

    await menu(page, 'File', 'New Circuit');
    await expect(unsavedDialog(page)).toContainText('Save changes to “Hello, LED”');
    await unsavedDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(unsavedDialog(page)).toBeHidden();
    await expect(page).toHaveTitle('• Hello, LED — Logic');

    // Escape cancels too; the shortcut asks as well.
    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(unsavedDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(unsavedDialog(page)).toBeHidden();
    await expect(page.getByTestId('counts')).toHaveText(HELLO_COUNTS);

    // Save (the default button) saves first, then the new circuit opens.
    await pick(page, 'save', 'kept.logic.json');
    await menu(page, 'File', 'New Circuit');
    await expect(
      unsavedDialog(page).getByRole('button', { name: 'Save', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveTitle('Untitled — Logic');
    expect(await disk(page, 'kept.logic.json')).toContain('"SW1"');

    // Don't Save drops the changes.
    await menu(page, 'File', 'Examples');
    await page.getByRole('menuitem', { name: 'Hello, LED' }).click();
    await edit(page);
    await menu(page, 'File', 'New Circuit');
    await unsavedDialog(page).getByRole('button', { name: 'Don’t Save' }).click();
    await expect(page).toHaveTitle('Untitled — Logic');
  });

  test('a file that does not load shows its problems and leaves the circuit alone', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.__disk['broken.logic.json'] =
        '{"schemaVersion": 1, "circuits": [{"id": "main", "name": "Main", "components": [{"id": "U1", "type": "prim/nand", "x": 1.5, "y": 0}], "wires": []}]}';
    });
    await pick(page, 'open', 'broken.logic.json');
    await menu(page, 'File', 'Open…');
    const dialog = page.getByTestId('file-problem-dialog');
    await expect(dialog).toContainText('“broken.logic.json” is not a circuit this app can open');
    await expect(dialog).toContainText('circuits[0].components[0].x');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveTitle('Hello, LED — Logic');
    await expect(page.getByTestId('counts')).toHaveText(HELLO_COUNTS);
  });

  test('a .logic.json file dropped onto the window opens', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const text =
        '{"schemaVersion": 1, "circuits": [{"id": "main", "name": "Main", "components": [{"id": "U1", "type": "prim/nand", "x": 0, "y": 0}], "wires": []}]}';
      const data = new DataTransfer();
      data.items.add(new File([text], 'dropped.logic.json', { type: 'application/json' }));
      document
        .querySelector('.workbench')!
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }),
        );
    });
    await expect(page).toHaveTitle('dropped — Logic');
    await expect(page.getByTestId('counts')).toHaveText('1 parts · 0 wires');
  });
});

test.describe('without the File System Access API (Firefox, Safari)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(hideFileSystemAccess);
  });

  test('Save downloads the file; Open reads a chosen file', async ({ page }) => {
    await page.goto('/');
    await edit(page);

    const download = page.waitForEvent('download');
    await page.keyboard.press('ControlOrMeta+S');
    const file = await download;
    expect(file.suggestedFilename()).toBe('Hello, LED.logic.json');
    // E2E specs are typed without Node: read the stream's chunks as text, keep the file by path.
    let saved = '';
    for await (const chunk of await file.createReadStream()) saved += String(chunk);
    expect(JSON.parse(saved).circuits[0].components[0]).toMatchObject({ id: 'SW1', x: 1 });
    await expect(page).toHaveTitle('Hello, LED — Logic');
    const path = test.info().outputPath('mine.logic.json');
    await file.saveAs(path);

    await menu(page, 'File', 'New Circuit');
    await expect(page).toHaveTitle('Untitled — Logic');

    const chooser = page.waitForEvent('filechooser');
    await menu(page, 'File', 'Open…');
    await (await chooser).setFiles(path);
    await expect(page).toHaveTitle('mine — Logic');
    await expect(page.getByTestId('counts')).toHaveText(HELLO_COUNTS);
  });
});
