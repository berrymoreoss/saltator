import { expect, type Page, test } from '@playwright/test';
import ramByHand from '../../examples/ram-by-hand.saltator.json' with { type: 'json' };
import { pick, stubFileSystemAccess, writeFile } from './file-system';
import { canvas, menu, openExample, watchErrors } from './support';

// R15b in the browser: the Tests tab runs a circuit's test benches in a sandbox — RAM by Hand's
// memory loaded before power-on passing in the app (M2) — shows failures at their lines, stops
// a runaway bench, keeps a script from the app's storage and the network, and Insert Image…
// writes a memory load that runs.

const tab = (page: Page) => page.getByTestId('tests-panel');
const code = (page: Page) => tab(page).locator('.cm-content');
const results = (page: Page) => page.getByTestId('test-results');
const benches = (page: Page) => results(page).getByTestId('bench-row');
const status = (page: Page) => page.getByTestId('tests-status');

async function openTests(page: Page) {
  await page.getByRole('tab', { name: /^Tests/ }).click();
  await expect(code(page)).toBeVisible();
}

/** Replaces the whole script by typing it in (as a paste would). */
async function replaceScript(page: Page, script: string) {
  await code(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(script);
}

test('RAM by Hand: its benches pass in the Tests tab, a memory loaded before power-on', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openExample(page, 'ram-by-hand', 'RAM by Hand', ramByHand);
  await openTests(page);
  await expect(page.getByTestId('tests-title')).toHaveText('Main · 2 benches');
  await expect(benches(page)).toHaveCount(2); // listed before any run
  await code(page).click();
  await page.keyboard.press('ControlOrMeta+Enter'); // Run Tests, from inside the editor
  await expect(benches(page).and(page.locator('[data-state="pass"]'))).toHaveCount(2);
  await expect(results(page)).toContainText('reads what was loaded before power-on');
  await expect(page.getByRole('tab', { name: /^Tests/ })).toContainText('✓ 2');
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a failure shows its line; a click goes there and to the signal; undo brings it back', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openExample(page, 'ram-by-hand', 'RAM by Hand', ramByHand);
  await openTests(page);
  // Expect 0x56 where the RAM holds 0x55.
  await code(page).locator('.cm-line', { hasText: '| 0x55' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('6');
  await expect(page.getByTestId('document-name')).toHaveText(/^•/);
  await tab(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(benches(page).and(page.locator('[data-state="fail"]'))).toHaveCount(1);
  const failure = results(page).getByTestId('result-line').first();
  await expect(failure).toHaveText('line 8 at 2 µs: D[0..7] is 0x55, expected 0x56');
  await expect(page.getByRole('tab', { name: /^Tests/ })).toContainText('✗ 1');
  await expect(tab(page).locator('.cm-lintRange-error')).toHaveCount(1);

  await code(page).locator('.cm-line').first().click(); // the cursor elsewhere
  await failure.click();
  await expect(tab(page).locator('.cm-activeLine')).toHaveText(/1\s+\|\s+0x56/);
  await expect(page.getByTestId('selection-summary')).toHaveText('24 parts'); // the labels of D0…D7

  // Leave the editor; Edit ▸ Undo takes the edit back (one step for the typing).
  await canvas(page).click({ position: { x: 5, y: 5 } });
  await menu(page, 'Edit', /^Undo Edit Test Script/);
  await expect(code(page).locator('.cm-line', { hasText: '| 0x55' })).toHaveCount(1);
  await expect(results(page)).toContainText('stale');
  expect(errors).toEqual([]);
});

test('a script error is marked as it is typed, before any run', async ({ page }) => {
  await openExample(page, 'ram-by-hand', 'RAM by Hand', ramByHand);
  await openTests(page);
  await replaceScript(page, "bench('a', (b) => {});\nconst x = ;\n");
  await expect(results(page)).toContainText('line 2: SyntaxError');
  await expect(tab(page).locator('.cm-lintRange-error')).toHaveCount(1);
});

test('a runaway bench: the app stays responsive, Cancel stops it, the next run passes', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openExample(page, 'ram-by-hand', 'RAM by Hand', ramByHand);
  await openTests(page);
  await replaceScript(
    page,
    [
      "bench('runs away', (b) => { while (true) {} });",
      "bench('passes', (b) => { b.wait('1us'); });",
    ].join('\n'),
  );
  await tab(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toHaveText('Running 1 of 2: Main › runs away');
  // The page's thread is free: another tab opens and comes back.
  await page.getByRole('tab', { name: /^Messages/ }).click();
  await expect(page.getByTestId('bottom-panel')).toContainText('No problems found');
  await openTests(page);
  await tab(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(status(page)).toHaveText("Cancelled: 2 benches didn't run");
  await expect(benches(page).and(page.locator('[data-state="not-run"]'))).toHaveCount(2);

  await replaceScript(page, "bench('passes', (b) => { b.wait('1us'); });");
  await tab(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(benches(page).and(page.locator('[data-state="pass"]'))).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a script can reach neither the app’s storage nor the network', async ({ page }) => {
  await openExample(page, 'ram-by-hand', 'RAM by Hand', ramByHand);
  const origin = new URL(page.url()).origin;
  // Things a script could get without the sandbox's policy: a script of the app (it would load,
  // then fail as the module it is: a SyntaxError), and an answer anyone may read.
  const script = await page.evaluate(
    () => document.querySelector<HTMLScriptElement>('script[type="module"]')!.src,
  );
  const hits: string[] = [];
  await page.route('**/leak', (route) => {
    hits.push(route.request().url());
    return route.fulfill({ body: 'leaked', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await openTests(page);
  await replaceScript(
    page,
    [
      "bench('probes', (b) => {",
      '  b.log(typeof localStorage, typeof document, typeof window, self.origin);',
      "  try { indexedDB.open('saltator'); b.log('indexedDB open'); } catch (e) { b.log('indexedDB', e.name); }",
      `  try { const x = new XMLHttpRequest(); x.open('GET', '${origin}/leak', false); x.send(); b.log('xhr', x.status); } catch (e) { b.log('xhr', e.name); }`,
      `  try { importScripts('${script}'); b.log('imported'); } catch (e) { b.log('importScripts', e.name); }`,
      '});',
    ].join('\n'),
  );
  await tab(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(benches(page).and(page.locator('[data-state="pass"]'))).toHaveCount(1);
  const logs = results(page).locator('.tests-line.log');
  await expect(logs).toHaveText([
    'line 2 at 0 ps: undefined undefined undefined null',
    'line 3 at 0 ps: indexedDB SecurityError',
    'line 4 at 0 ps: xhr NetworkError',
    'line 5 at 0 ps: importScripts NetworkError',
  ]);
  expect(hits).toEqual([]);
});

test('Insert Image… writes a memory load from a file that runs in a bench', async ({ page }) => {
  await page.addInitScript(stubFileSystemAccess);
  const errors = watchErrors(page);
  await openExample(page, 'ram-by-hand', 'RAM by Hand', ramByHand);
  await writeFile(page, 'ab.bin', 'AB');
  await openTests(page);
  await replaceScript(page, "bench('inserted', (b) => {\n");
  await pick(page, 'open', 'ab.bin');
  await tab(page)
    .getByRole('button', { name: /Insert Image/ })
    .click();
  const dialog = page.getByTestId('insert-image-dialog');
  await expect(dialog.getByTestId('image-summary')).toHaveText(
    '0x0000–0x0001 · 2 bytes · sum 0x0083',
  );
  await expect(dialog.getByLabel('Memory')).toHaveValue('U1');
  await dialog.getByLabel('Load at').fill('4');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(dialog).toBeHidden();
  await page.keyboard.insertText(
    '\n  b.table`\n    SW1 | D[0..7]\n    4   | 0x41\n    5   | 0x42\n  `;\n});\n',
  );
  await expect(code(page)).toContainText("b.memory('U1', 0x0004, `");
  await tab(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(benches(page).and(page.locator('[data-state="pass"]'))).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('an edited script comes back after a reload, as the rest of the document', async ({
  page,
}) => {
  await openExample(page, 'ram-by-hand', 'RAM by Hand', ramByHand);
  await openTests(page);
  await replaceScript(page, "// kept\nbench('kept', (b) => {});\n");
  await expect(page.getByTestId('tests-title')).toHaveText('Main · 1 bench');
  await page.reload();
  await openTests(page);
  await expect(code(page)).toContainText('// kept');
  await expect(page.getByTestId('tests-title')).toHaveText('Main · 1 bench');
});
