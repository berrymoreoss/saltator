import { expect, test } from '@playwright/test';
import type { Point } from '../../src/circuit';
import { menu, newCircuit, pinOf, place, summary, watchErrors, wire } from './support';

// R09a in the browser: the Part tab shows a chip's timing; a 74HC74 clocked too fast reports a
// pulse-width violation as an error; the SAP-1 A Register example opens clean and runs.

const sheet = (page: import('@playwright/test').Page) => page.getByTestId('part-sheet');

test('the Part tab shows a flip-flop’s delays and the minima its timing checks use', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await newCircuit(page);
  await page.getByRole('tab', { name: 'Part', exact: true }).click();
  await page.locator('[data-type="74xx/74hc74"]').click();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toContainText('Dual D-type flip-flop with set and reset');
  const timing = sheet(page).getByRole('table', { name: 'Timing' });
  await expect(timing).toContainText('VCC = 4.5 V, CL = 50 pF');
  await expect(timing.getByRole('row').filter({ hasText: 'nD to nCP' }).first()).toContainText(
    '15 ns',
  ); // tsu min
  await expect(timing).toContainText('the guaranteed minimum the timing checks hold');
  await expect(timing).toContainText('Nexperia 74HC_HCT74 product data sheet');
  expect(errors).toEqual([]);
});

test('a 74HC74 clocked at 30 MHz reports a pulse-width violation as an error', async ({ page }) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  const chip: Point = [0, 0];
  await place(page, grid, '74xx/74hc74', chip);
  await expect(summary(page)).toHaveText('U1 · 74HC74');
  const cp = pinOf('74xx/74hc74', chip, '1CP');
  const clockAt: Point = [cp[0] - 10, cp[1]];
  await place(page, grid, 'io/clock', clockAt);
  const y = pinOf('io/clock', clockAt, 'Y');
  expect(y[1]).toBe(cp[1]); // same row: one straight wire into the pin
  await wire(page, grid, y, cp);

  // 30 MHz: 16.7 ns HIGH and LOW, under the 74HC74's 20 ns minimum pulse width.
  await page.mouse.dblclick(...grid(clockAt));
  const frequency = page.getByTestId('prop-frequency');
  await frequency.fill('30M');
  await page.keyboard.press('Enter');
  await expect(frequency).toHaveValue('30 MHz');

  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await page.getByRole('tab', { name: /Simulation/ }).click();
  const violation = page
    .getByTestId('sim-diagnostics')
    .locator('.sim-message.error', { hasText: '1CP was' });
  await expect(violation.first()).toContainText('(pulse width ≥ 20 ns)');
  await expect(violation.first()).toContainText('U1.1CP');
  // Click-to-locate: the message selects the chip.
  await page.keyboard.press('Escape');
  await violation.first().click();
  await expect(summary(page)).toHaveText('U1 · 74HC74');
  expect(errors).toEqual([]);
});

test('the SAP-1 A Register example opens without design issues and runs cleanly', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await newCircuit(page);
  await menu(page, 'File', 'New from Example…');
  await page.getByTestId('example-gallery').locator('[data-example="sap-1-register"]').click();
  await expect(page).toHaveTitle('SAP-1 A Register — Logic');
  await expect(page.getByTestId('bottom-panel')).toContainText('No problems found');
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await page.getByRole('tab', { name: /Simulation/ }).click();
  await page.waitForTimeout(500);
  // Not cleared yet, but nothing floats and nothing fights: the bus is pulled down.
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems while running');
  expect(errors).toEqual([]);
});
