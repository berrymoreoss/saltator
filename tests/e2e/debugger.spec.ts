import { expect, type Page, test } from '@playwright/test';
import ramByHand from '../../examples/ram-by-hand.saltator.json' with { type: 'json' };
import programCounter from '../../examples/sap-1-program-counter.saltator.json' with {
  type: 'json',
};
import { clickAt, openApp, openExample, watchErrors } from './support';

// R14 in the browser: Step Clock on Ben Eater's program counter (a manual clock: one pulse a
// press), Run For, a breakpoint on the count, watches with what changed, a break on a timing
// violation, the debug setup after a reload.

const debug = (page: Page) => page.getByTestId('debug-panel');
const status = (page: Page) => page.getByTestId('sim-status');
const watchValues = (page: Page) => debug(page).getByTestId('watch-value');
const COUNT = 'U1.Q0 U1.Q1 U1.Q2 U1.Q3';

/** Opens SAP-1 Program Counter, the Debug tab with Run For at 250 ms, powered on by Step Clock. */
async function programCounterOpen(page: Page) {
  const at = await openExample(
    page,
    'sap-1-program-counter',
    'SAP-1 Program Counter',
    programCounter,
  );
  await page.getByRole('tab', { name: /Debug/ }).click();
  await debug(page).getByLabel('Run For duration').fill('250 ms');
  await debug(page).getByLabel('Run For duration').press('Enter');
  await page.keyboard.press('F8'); // power-on and the clock's low time
  await expect(status(page)).toHaveText(/^Paused · 500 ms · Step Clock \(X1 pulse\)/);
  await page.keyboard.press('i'); // Interact: flip the switches
  return at;
}

test('SAP-1 Program Counter: Step Clock counts by one, Run For, a breakpoint, a reload', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const at = await programCounterOpen(page);
  await debug(page).getByLabel('Watch to add').fill(COUNT);
  await debug(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(watchValues(page)).toHaveText(['0xX']); // the 74HC161 is unknown until cleared

  // CE on; CLR low for 250 ms, then high again, 250 ms before the first press.
  await clickAt(page, at.center('SW3'));
  await clickAt(page, at.center('SW2'));
  await page.keyboard.press('Shift+F8');
  await clickAt(page, at.center('SW2'));
  await page.keyboard.press('Shift+F8');
  await expect(status(page)).toHaveText(/^Paused · 1 s · Run For 250 ms/);
  await expect(watchValues(page)).toHaveText(['0x0']);

  for (const [time, count] of [
    ['2 s', '0x1'],
    ['3 s', '0x2'],
    ['4 s', '0x3'],
  ]) {
    await page.keyboard.press('F8');
    await expect(status(page)).toHaveText(new RegExp(`^Paused · ${time} · Step Clock`));
    await expect(watchValues(page)).toHaveText([count!]);
    await expect(watchValues(page)).toHaveClass(/changed/);
  }
  await page.keyboard.press('Shift+F8');
  await expect(status(page)).toHaveText(/^Paused · 4.25 s · Run For 250 ms/);
  await expect(watchValues(page)).not.toHaveClass(/changed/);

  // A breakpoint on the count: the press that makes it 5 stops there.
  await debug(page).getByRole('button', { name: /Add…/ }).click();
  const dialog = page.getByTestId('breakpoint-dialog');
  await dialog.getByLabel('Signal').fill(COUNT);
  await dialog.getByLabel('Condition').selectOption('equal');
  await dialog.getByLabel('Value').fill('5');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(debug(page).getByTestId('breakpoint')).toContainText(`${COUNT} = 5`);
  await page.keyboard.press('F8');
  await expect(watchValues(page)).toHaveText(['0x4']);
  await page.keyboard.press('F8');
  await expect(status(page)).toHaveText(/· Breakpoint 1: U1\.Q0 U1\.Q1 U1\.Q2 U1\.Q3 = 5/);
  await expect(watchValues(page)).toHaveText(['0x5']);
  await expect(debug(page).getByTestId('breakpoint')).toContainText('1 hit');

  // The debug setup is kept with the session.
  await page.reload();
  await openApp(page);
  await page.getByRole('tab', { name: /Debug/ }).click();
  await expect(debug(page).getByTestId('breakpoint')).toContainText(`${COUNT} = 5`);
  await expect(debug(page).getByTestId('watch')).toContainText(COUNT);
  await expect(debug(page).getByLabel('Run For duration')).toHaveValue('250 ms');
  expect(errors).toEqual([]);
});

test('SAP-1 Program Counter: Break on errors stops at a clock edge too close to CLR', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const at = await programCounterOpen(page);
  await debug(page).getByLabel('Break on errors').check();
  await clickAt(page, at.center('SW2')); // clear
  await page.keyboard.press('Shift+F8');
  await clickAt(page, at.center('SW2')); // release CLR …
  await page.keyboard.press('F8'); // … and press the clock at the same instant
  await expect(status(page)).toHaveText(
    /· Error: CP rose at the same time as MR was released \(recovery time ≥ 20 ns\)/,
  );
  await page.getByRole('tab', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-diagnostics')).toContainText('recovery-violation');
  await expect(page.getByTestId('run-statistics')).toContainText('Simulated time');
  expect(errors).toEqual([]);
});

test('RAM by Hand: a watched RAM cell shows the byte written to it', async ({ page }) => {
  const errors = watchErrors(page);
  const at = await openExample(page, 'ram-by-hand', 'RAM by Hand', ramByHand);
  await page.getByRole('tab', { name: /Debug/ }).click();
  await debug(page).getByLabel('Watch to add').fill('U1[2]');
  await debug(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(debug(page).getByTestId('watch')).toContainText('U1[0x02]');
  await expect(watchValues(page)).toHaveText(['']); // a stopped RAM holds nothing

  await page.keyboard.press('F5');
  await expect(watchValues(page)).toHaveText(['0xXX']); // powers on unknown
  await clickAt(page, at.center('SW3')); // PROGRAM: the DATA switches drive the bus
  await clickAt(page, at.lever('SW2', 'S1'));
  await clickAt(page, at.lever('SW2', 'S3'));
  await clickAt(page, at.lever('SW1', 'S2')); // address 2
  await page.mouse.move(...at.center('SW4'));
  await page.mouse.down(); // WRITE
  await page.waitForTimeout(100);
  await page.mouse.up();
  await expect(watchValues(page)).toHaveText(['0x05']);
  expect(errors).toEqual([]);
});
