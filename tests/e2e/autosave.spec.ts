import { expect, test } from '@playwright/test';
import {
  counts,
  documentName,
  edit,
  firstX,
  HELLO_COUNTS,
  pick,
  pickerCount,
  readFile,
  storedSessions,
  stubFileSystemAccess,
} from './file-system';
import { menu, openApp, watchErrors } from './support';

// Autosave and session restore (R07, Q1): a reload or a reopened tab shows the circuit as it was,
// unsaved changes, file and view included.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(stubFileSystemAccess);
});

test('a reload brings back the unsaved circuit, its name and the view', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page);
  await edit(page);
  await page.keyboard.press('=');
  const zoom = await page.getByTestId('zoom').textContent();
  await expect.poll(() => storedSessions(page)).toEqual([{ name: 'Hello, LED', unsaved: true }]);

  await page.reload();
  await expect(page).toHaveTitle('• Hello, LED — Logic');
  await expect(documentName(page)).toHaveText('•Hello, LED');
  await expect(counts(page)).toHaveText(HELLO_COUNTS);
  await expect(page.getByTestId('zoom')).toHaveText(zoom!);
  // The history starts empty; the switch moved one cell is there.
  await expect(page.getByRole('button', { name: /^Undo/ })).toBeDisabled();
  await pick(page, 'save', 'restored.logic.json');
  await page.keyboard.press('ControlOrMeta+S');
  await expect(page).toHaveTitle('restored — Logic');
  expect(firstX(await readFile(page, 'restored.logic.json'))).toBe(1);
  expect(errors).toEqual([]);
});

test('a saved file stays the document’s file across a reload: Save needs no picker', async ({
  page,
}) => {
  await openApp(page);
  await pick(page, 'save', 'hello.logic.json');
  await page.keyboard.press('ControlOrMeta+S');
  await expect(page).toHaveTitle('hello — Logic');
  await expect.poll(() => storedSessions(page)).toEqual([{ name: 'hello', unsaved: false }]);

  await page.reload();
  await expect(page).toHaveTitle('hello — Logic');
  await edit(page);
  await expect(page).toHaveTitle('• hello — Logic');
  await page.keyboard.press('ControlOrMeta+S');
  await expect(page).toHaveTitle('hello — Logic');
  expect(await pickerCount(page)).toBe(0);
  expect(firstX(await readFile(page, 'hello.logic.json'))).toBe(1);
});

test('a new tab starts from the latest session; each tab then keeps its own', async ({
  page,
  context,
}) => {
  await openApp(page);
  await edit(page);
  await expect.poll(() => storedSessions(page)).toEqual([{ name: 'Hello, LED', unsaved: true }]);

  const second = await context.newPage();
  await second.addInitScript(stubFileSystemAccess);
  await openApp(second);
  await expect(second).toHaveTitle('• Hello, LED — Logic');
  await menu(second, 'File', 'New Circuit');
  await second.getByTestId('unsaved-dialog').getByRole('button', { name: 'Don’t Save' }).click();
  await expect(second).toHaveTitle('Untitled — Logic');
  await expect
    .poll(() => storedSessions(second))
    .toEqual([
      { name: 'Untitled', unsaved: false },
      { name: 'Hello, LED', unsaved: true },
    ]);

  // The first tab reloads its own session, not the newer one of the second tab.
  await page.reload();
  await expect(page).toHaveTitle('• Hello, LED — Logic');
  await second.reload();
  await expect(second).toHaveTitle('Untitled — Logic');
});

test('?example= opens the example instead of the restored session', async ({ page }) => {
  await openApp(page);
  await edit(page);
  await expect.poll(() => storedSessions(page)).toEqual([{ name: 'Hello, LED', unsaved: true }]);
  await openApp(page, '/?gallery');
  await expect(page).toHaveTitle('Symbol Gallery — Logic');
});

test('a reload right after an edit keeps it (written synchronously on unload)', async ({
  page,
}) => {
  await openApp(page);
  await expect.poll(() => storedSessions(page)).toEqual([{ name: 'Hello, LED', unsaved: false }]);
  await edit(page);
  await page.reload();
  await expect(page).toHaveTitle('• Hello, LED — Logic');
  await pick(page, 'save', 'quick.logic.json');
  await page.keyboard.press('ControlOrMeta+S');
  await expect(page).toHaveTitle('quick — Logic');
  expect(firstX(await readFile(page, 'quick.logic.json'))).toBe(1);
});
