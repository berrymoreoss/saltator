import { expect, type Page, test } from '@playwright/test';
import dataBus from '../../examples/data-bus.logic.json' with { type: 'json' };
import programCounter from '../../examples/sap-1-program-counter.logic.json' with { type: 'json' };
import { clickAt, menu, openExample, watchErrors } from './support';

// R14b in the browser: stepping back on Ben Eater's program counter (Step Back Clock, Step
// Clock replaying the recorded presses, Step Back, Reverse Continue to a breakpoint, a new
// future when acting behind the present), and going to a time from the waveforms' ruler.

const debug = (page: Page) => page.getByTestId('debug-panel');
const status = (page: Page) => page.getByTestId('sim-status');
const watchValues = (page: Page) => debug(page).getByTestId('watch-value');
const COUNT = 'U1.Q0 U1.Q1 U1.Q2 U1.Q3';

/** SAP-1 Program Counter powered on, cleared, counting to 3 with three Step Clock presses. */
async function countedToThree(page: Page) {
  const at = await openExample(
    page,
    'sap-1-program-counter',
    'SAP-1 Program Counter',
    programCounter,
  );
  await page.getByRole('tab', { name: /Debug/ }).click();
  await debug(page).getByLabel('Run For duration').fill('250 ms');
  await debug(page).getByLabel('Run For duration').press('Enter');
  await debug(page).getByLabel('Watch to add').fill(COUNT);
  await debug(page).getByRole('button', { name: 'Add', exact: true }).click();
  await page.keyboard.press('F8'); // power-on and the clock's low time
  await page.keyboard.press('i'); // Interact
  await clickAt(page, at.center('SW3')); // CE on
  await clickAt(page, at.center('SW2')); // CLR low …
  await page.keyboard.press('Shift+F8');
  await clickAt(page, at.center('SW2')); // … and high again
  await page.keyboard.press('Shift+F8');
  await expect(watchValues(page)).toHaveText(['0x0']);
  for (const count of ['0x1', '0x2', '0x3']) {
    await page.keyboard.press('F8');
    await expect(watchValues(page)).toHaveText([count]);
  }
  await expect(status(page)).toHaveText(/^Paused · 4 s · Step Clock/);
  return at;
}

test('SAP-1 Program Counter: Step Back Clock, a replayed Step Clock, Step Back', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await countedToThree(page);

  await page.keyboard.press('Alt+F8');
  await expect(status(page)).toHaveText(/· Step Back Clock \(X1\.Y ↑\) · .* behind the present$/);
  await expect(watchValues(page)).toHaveText(['0x2']);
  await page.keyboard.press('Alt+F8');
  await expect(watchValues(page)).toHaveText(['0x1']);
  // Forward again: the recorded presses, back to the present.
  await page.keyboard.press('F8');
  await expect(watchValues(page)).toHaveText(['0x2']);
  await expect(status(page)).toHaveText(/behind the present$/);
  await page.keyboard.press('F8');
  await expect(watchValues(page)).toHaveText(['0x3']);
  await expect(status(page)).toHaveText(/^Paused · 4 s · Step Clock \(X1 pulse\)$/);

  // Step Back and Step: the moment before, then back to it.
  await page.keyboard.press('Alt+F10');
  await expect(status(page)).toHaveText(/· Step Back · .* behind the present$/);
  const back = await status(page).textContent();
  await page.keyboard.press('F10');
  await expect(status(page)).not.toHaveText(back!);
  await expect(watchValues(page)).toHaveText(['0x3']);
  expect(errors).toEqual([]);
});

test('SAP-1 Program Counter: Reverse Continue to a breakpoint; acting there starts anew', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const at = await countedToThree(page);
  await debug(page).getByRole('button', { name: /Add…/ }).click();
  const dialog = page.getByTestId('breakpoint-dialog');
  await dialog.getByLabel('Signal').fill(COUNT);
  await dialog.getByLabel('Condition').selectOption('equal');
  await dialog.getByLabel('Value').fill('1');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();

  await page.keyboard.press('Alt+F5');
  await expect(status(page)).toHaveText(
    /· Reverse Continue: Breakpoint 1: U1\.Q0 U1\.Q1 U1\.Q2 U1\.Q3 = 1 · .* behind the present$/,
  );
  await expect(watchValues(page)).toHaveText(['0x1']);
  await debug(page).getByRole('button', { name: 'Reverse Continue' }).click();
  await expect(status(page)).toHaveText(/· Reverse Continue: no earlier hit · /);

  // Back at 1, a press of the clock module's button: a new future, no longer behind.
  await page.keyboard.press('F8');
  await page.keyboard.press('Alt+F8');
  await expect(watchValues(page)).toHaveText(['0x0']);
  await clickAt(page, at.center('SW2')); // CLR: the recorded future is gone
  await expect(status(page)).not.toHaveText(/behind the present/);
  expect(errors).toEqual([]);
});

test('Data Bus: the waveforms ruler goes back in time; Go to Present comes back', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openExample(page, 'data-bus', 'Data Bus', dataBus);
  await page.getByRole('tab', { name: /Debug/ }).click();
  await debug(page).getByLabel('Run For duration').fill('20 µs');
  await debug(page).getByLabel('Run For duration').press('Enter');
  await page.keyboard.press('Shift+F8');
  await expect(status(page)).toHaveText(/^Paused · 20 µs · Run For 20 µs/);
  await page.getByRole('tab', { name: /Waveforms/ }).click();
  const plot = page.getByTestId('waves-plot');
  const box = (await plot.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + 8); // the ruler
  await expect(status(page)).toHaveText(
    /^Paused · ([\d.]+ [pnµ]s) · Rewound to \1 · [\d.]+ [pnµ]s behind the present$/,
  );
  await menu(page, 'Simulate', 'Go to Present');
  await expect(status(page)).toHaveText(/^Paused · 20 µs · Present$/);
  expect(errors).toEqual([]);
});
