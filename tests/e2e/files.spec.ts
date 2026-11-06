import { expect, test } from '@playwright/test';
import {
  counts,
  documentName,
  edit,
  firstX,
  HELLO_COUNTS,
  hideFileSystemAccess,
  pick,
  pickerCount,
  readFile,
  stubFileSystemAccess,
  unsavedDialog,
  writeFile,
} from './file-system';
import { menu, openApp, watchErrors } from './support';

// Files (R07): Save/Open through the File System Access API (stubbed pickers over the private
// file system: the real pickers are native dialogs), the download/file-input fallback, "Save
// changes?", broken files and drops.

test.describe('with the File System Access API', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(stubFileSystemAccess);
  });

  test('Save writes a file, Save again needs no picker, Open reads it back', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page);
    await expect(page).toHaveTitle('Hello, LED — Logic');
    await expect(documentName(page)).toHaveText('Hello, LED');

    await edit(page);
    await expect(page).toHaveTitle('• Hello, LED — Logic');
    await expect(documentName(page)).toHaveText('•Hello, LED');

    await pick(page, 'save', 'hello.logic.json');
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page).toHaveTitle('hello — Logic');
    expect(firstX(await readFile(page, 'hello.logic.json'))).toBe(1);

    // Saved state reached again by undo: clean; redo: unsaved.
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(page).toHaveTitle('• hello — Logic');
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect(page).toHaveTitle('hello — Logic');

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page).toHaveTitle('hello — Logic');
    expect(await pickerCount(page)).toBe(1);
    expect(firstX(await readFile(page, 'hello.logic.json'))).toBe(2);

    await menu(page, 'File', 'New Circuit');
    await expect(page).toHaveTitle('Untitled — Logic');
    await expect(counts(page)).toHaveText('0 parts · 0 wires');

    await pick(page, 'open', 'hello.logic.json');
    await page.keyboard.press('ControlOrMeta+O');
    await expect(page).toHaveTitle('hello — Logic');
    await expect(counts(page)).toHaveText(HELLO_COUNTS);
    // Opening isn't an edit: nothing to undo.
    await expect(page.getByRole('button', { name: /^Undo/ })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('replacing unsaved changes asks first: Cancel, Save, Don’t Save', async ({ page }) => {
    await openApp(page);
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
    await expect(counts(page)).toHaveText(HELLO_COUNTS);

    // Save (the default button) saves first, then the new circuit opens.
    await pick(page, 'save', 'kept.logic.json');
    await menu(page, 'File', 'New Circuit');
    await expect(
      unsavedDialog(page).getByRole('button', { name: 'Save', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveTitle('Untitled — Logic');
    expect(await readFile(page, 'kept.logic.json')).toContain('"SW1"');

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
    await openApp(page);
    await writeFile(
      page,
      'broken.logic.json',
      '{"schemaVersion": 1, "circuits": [{"id": "main", "name": "Main", "components": [{"id": "U1", "type": "prim/nand", "x": 1.5, "y": 0}], "wires": []}]}',
    );
    await pick(page, 'open', 'broken.logic.json');
    await menu(page, 'File', 'Open…');
    const dialog = page.getByTestId('file-problem-dialog');
    await expect(dialog).toContainText('“broken.logic.json” is not a circuit this app can open');
    await expect(dialog).toContainText('circuits[0].components[0].x');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveTitle('Hello, LED — Logic');
    await expect(counts(page)).toHaveText(HELLO_COUNTS);
  });

  test('a .logic.json file dropped onto the window opens', async ({ page }) => {
    await openApp(page);
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
    await expect(counts(page)).toHaveText('1 parts · 0 wires');
  });

  test('Open Recent lists saved and opened files, survives a reload, can be cleared', async ({
    page,
  }) => {
    await openApp(page);
    await pick(page, 'save', 'first.logic.json');
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page).toHaveTitle('first — Logic');
    await pick(page, 'save', 'second.logic.json');
    await page.keyboard.press('ControlOrMeta+Shift+S');
    await expect(page).toHaveTitle('second — Logic');

    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open Recent' }).click();
    const items = page.locator('.submenu [role="menuitem"]');
    await expect(items).toHaveText([/second\.logic\.json/, /first\.logic\.json/, /Clear Recent/]);
    await page.keyboard.press('Escape');

    await menu(page, 'File', 'New Circuit');
    await page.reload();
    await expect(page).toHaveTitle('Untitled — Logic');
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open Recent' }).click();
    await page.getByRole('menuitem', { name: 'first.logic.json' }).click();
    await expect(page).toHaveTitle('first — Logic');
    await expect(counts(page)).toHaveText(HELLO_COUNTS);
    expect(await pickerCount(page)).toBe(0);

    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open Recent' }).click();
    await expect(items.first()).toHaveText(/first\.logic\.json/);
    await page.getByRole('menuitem', { name: 'Clear Recent Files' }).click();
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open Recent' }).click();
    await expect(items).toHaveText([/No Recent Files/]);
  });
});

test.describe('without the File System Access API (Firefox, Safari)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(hideFileSystemAccess);
  });

  test('Save downloads the file; Open reads a chosen file', async ({ page }) => {
    await openApp(page);
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
    await expect(counts(page)).toHaveText(HELLO_COUNTS);
    // No file handles, no Open Recent.
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Open…' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Open Recent' })).toHaveCount(0);
  });
});
