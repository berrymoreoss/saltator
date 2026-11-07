import { expect, type Page, test } from '@playwright/test';
import { menu, newCircuit, watchErrors } from './support';

// R09b in the browser: the counter and shift register examples open clean and run; the Part tab
// of a counter draws its pins with the data sheet's overlines.

const sheet = (page: Page) => page.getByTestId('part-sheet');

for (const [id, title] of [
  ['shift-register-leds', 'Shift Register LEDs'],
  ['sap-1-program-counter', 'SAP-1 Program Counter'],
] as const) {
  test(`the ${title} example opens without design issues and runs cleanly`, async ({ page }) => {
    const errors = watchErrors(page);
    await newCircuit(page);
    await menu(page, 'File', 'New from Example…');
    await page.getByTestId('example-gallery').locator(`[data-example="${id}"]`).click();
    await expect(page).toHaveTitle(`${title} — Logic`);
    await expect(page.getByTestId('bottom-panel')).toContainText('No problems found');
    await page.keyboard.press('F5');
    await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
    await page.getByRole('tab', { name: /Simulation/ }).click();
    await page.waitForTimeout(1500); // the 595's clock ticks a few times
    await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems while running');
    expect(errors).toEqual([]);
  });
}

test('the Part tab of a 74HC191 overlines only the U of U̅/D, and shows its minima', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await newCircuit(page);
  await page.getByRole('tab', { name: 'Part', exact: true }).click();
  await page.locator('[data-type="74xx/74hc191"]').click();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toContainText('Presettable synchronous 4-bit binary up/down counter');
  const pins = sheet(page).getByRole('table', { name: 'Pins' });
  const ud = pins.getByRole('row').filter({ hasText: 'up/down input' });
  await expect(ud.locator('.overline')).toHaveText('U');
  await expect(ud).toContainText('U/D (UD)');
  const timing = sheet(page).getByRole('table', { name: 'Timing' });
  await expect(timing.getByRole('row').filter({ hasText: 'U/D to CP' }).first()).toContainText(
    '41 ns',
  ); // tsu min
  expect(errors).toEqual([]);
});
