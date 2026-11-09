import { expect, type Page, test } from '@playwright/test';
import twoDigitCounter from '../../examples/two-digit-counter.saltator.json' with { type: 'json' };
import { fitted, openExample, properties, summary, watchErrors } from './support';

// R11b in the browser: going into the Two-Digit Counter's instances while it runs — each digit
// drawn with its own levels, the breadcrumb bar, the instance switcher, probing inside by path,
// going up by the bar and by Mod+↑, and a reload coming back into the instance.

const bar = (page: Page) => page.getByTestId('breadcrumbs');
const status = (page: Page) => page.getByTestId('sim-status');
const rows = (page: Page) => page.getByTestId('waves-panel').getByTestId('waves-row');

/** Step Clock (F8), waiting for the step to end. */
async function stepClock(page: Page): Promise<void> {
  const before = await status(page).textContent();
  await page.keyboard.press('F8');
  await expect(status(page)).not.toHaveText(before ?? '');
  await expect(status(page)).toHaveText(/^Paused/);
}

/** The session this tab stored last: the circuit and instance open. */
async function storedView(page: Page): Promise<{ open?: string; path?: string } | undefined> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('saltator');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction('sessions').objectStore('sessions').getAll();
          all.onsuccess = () => {
            db.close();
            const sessions = all.result as { open?: string; path?: string; updated: number }[];
            const last = sessions.sort((a, b) => b.updated - a.updated)[0];
            resolve(last && { open: last.open, path: last.path });
          };
        };
      }),
  );
}

test('Two-Digit Counter: into each digit and its counter while simulating, and out again', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const main = await openExample(page, 'two-digit-counter', 'Two-Digit Counter', twoDigitCounter);
  await expect(bar(page)).toHaveText('Main');

  // Power on, clear both digits with RESET held over one clock edge, then count three.
  await stepClock(page);
  await page.mouse.move(...main.center('SW1'));
  await page.mouse.down();
  await stepClock(page);
  await page.mouse.up();
  for (let i = 0; i < 3; i++) await stepClock(page);

  // Into the tens digit: its bus reads 0, with that instance's levels.
  await page.mouse.dblclick(...main.center('A2'));
  await expect(bar(page)).toContainText('A2 · Counter Digit');
  await expect(bar(page)).toContainText('Edits change all 2 instances');
  const digit = await fitted(page, twoDigitCounter, 'counter-digit');
  await page.mouse.click(...digit.wire(true));
  await expect(properties(page).getByTestId('bus-value')).toHaveText('0x0');
  // The ones digit, by the switcher: the same bus line, its own value.
  await page.getByTestId('instance-select').selectOption('A1');
  await expect(bar(page)).toContainText('A1 · Counter Digit');
  await expect(properties(page).getByTestId('bus-value')).toHaveText('0x3');

  // Into its Decade Counter; the Probe tool probes inside by path.
  await page.mouse.dblclick(...digit.center('A1'));
  await expect(bar(page)).toContainText('A1 · Counter Digit');
  await expect(bar(page)).toContainText('A1 · Decade Counter');
  await expect(page.getByTestId('instance-select')).toHaveValue('A1/A1');
  const counter = await fitted(page, twoDigitCounter, 'decade-counter');
  await page.keyboard.press('p');
  await page.mouse.click(...counter.stub('U1', 'Q0'));
  await expect(rows(page)).toHaveCount(6);
  await expect(rows(page).last()).toContainText('A1/A1/U1.Q0');

  // Over to the tens digit's counter, then up by the bar and by Mod+↑.
  await page.getByTestId('instance-select').selectOption('A2/A1');
  await expect(bar(page)).toContainText('A2 · Counter Digit');
  await bar(page).getByRole('button', { name: 'A2 · Counter Digit' }).click();
  await expect(bar(page).locator('[aria-current="location"]')).toHaveText('A2 · Counter Digit');
  await expect(summary(page)).toHaveText('A1 · Decade Counter');
  await page.keyboard.press('ControlOrMeta+ArrowUp');
  await expect(bar(page)).toHaveText('Main');
  await expect(summary(page)).toHaveText('A2 · Counter Digit');

  // A reload comes back into the instance open.
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await expect(bar(page)).toContainText('A2 · Counter Digit');
  await expect.poll(() => storedView(page)).toEqual({ open: 'counter-digit', path: 'A2' });
  await page.reload();
  await expect(bar(page)).toContainText('A2 · Counter Digit');
  await expect(page.getByTestId('instance-select')).toHaveValue('A2');
  expect(errors).toEqual([]);
});
