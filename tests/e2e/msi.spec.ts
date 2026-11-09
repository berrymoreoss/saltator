import { expect, type Locator, type Page, test } from '@playwright/test';
import type { Point } from '../../src/circuit';
import {
  clickAt,
  menu,
  newCircuit,
  pinOf,
  place,
  properties,
  summary,
  watchErrors,
  wire,
} from './support';

// R08 in the browser: an NE555 placed from the Parts panel blinks an LED, its RC values are typed
// with SI prefixes; the Part tab of an MSI chip; the Clock Module example opens and runs.

const TIMER = 'timer/ne555';
const level = (page: Page, pin: string): Locator =>
  properties(page)
    .locator('.prop-row')
    .filter({ has: page.locator('.prop-label', { hasText: new RegExp(`^${pin}$`) }) })
    .getByTestId('live-level');
const sheet = (page: Page) => page.getByTestId('part-sheet');

test('an NE555 from the Parts panel blinks an LED; RB takes SI prefixes', async ({ page }) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  const chip: Point = [0, 0];
  await place(page, grid, TIMER, chip);
  await expect(summary(page)).toHaveText('U1 · NE555');
  const reset = pinOf(TIMER, chip, 'RESET');
  const out = pinOf(TIMER, chip, 'OUT');

  // RESET tied high; OUT → LED → GND, below the chip.
  const vccAt: Point = [reset[0] - 4, reset[1] - 8];
  await place(page, grid, 'io/vcc', vccAt);
  const vcc = pinOf('io/vcc', vccAt, 'Y');
  await wire(page, grid, vcc, [vcc[0], reset[1]], reset);
  const ledAt: Point = [out[0] + 2, out[1] + 6];
  await place(page, grid, 'io/led', ledAt);
  const anode = pinOf('io/led', ledAt, 'A');
  await wire(page, grid, out, [out[0] - 2, out[1]], [out[0] - 2, anode[1]], anode);
  const cathode = pinOf('io/led', ledAt, 'K');
  const gndAt: Point = [cathode[0] + 2, cathode[1] + 2];
  await place(page, grid, 'io/gnd', gndAt);
  const gnd = pinOf('io/gnd', gndAt, 'Y');
  await wire(page, grid, cathode, [gnd[0], cathode[1]], gnd);

  // RA = 1 kΩ, RB = 100 kΩ, C = 1 µF by default (≈ 7 Hz); RB typed as 47k.
  await page.mouse.dblclick(...grid(chip));
  const rb = page.getByTestId('prop-rb');
  await expect(rb).toHaveValue('100 kΩ');
  await rb.fill('47k');
  await page.keyboard.press('Enter');
  await expect(rb).toHaveValue('47 kΩ');

  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await clickAt(page, grid(ledAt));
  await expect(summary(page)).toHaveText('D1 · LED');
  await expect(level(page, 'A')).toHaveText('1');
  await expect(level(page, 'A')).toHaveText('0');
  await expect(level(page, 'A')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('the Part tab shows an MSI chip’s labelled pins and a 555’s unsimulated ones', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await newCircuit(page);
  await page.getByRole('tab', { name: 'Part', exact: true }).click();
  await page.locator('[data-type="74xx/74hc151"]').click();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toContainText('8-input multiplexer');
  const pins = sheet(page).getByRole('table', { name: 'Pins' });
  await expect(pins).toContainText('complementary multiplexer output');
  await expect(pins).toContainText('(YN)');
  await expect(sheet(page).getByRole('link', { name: /Datasheet 74HC_HCT151/ })).toBeVisible();

  await page.locator(`[data-type="${TIMER}"]`).click();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toContainText('Precision timer');
  await expect(pins).toContainText('not simulated');
  await expect(sheet(page).getByRole('link', { name: /Datasheet ne555/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the Clock Module example opens and runs without design issues', async ({ page }) => {
  const errors = watchErrors(page);
  await newCircuit(page);
  await menu(page, 'File', 'New from Example…');
  await page.getByTestId('example-gallery').locator('[data-example="clock-module"]').click();
  await expect(page).toHaveTitle('Clock Module — Saltator');
  await expect(page.getByTestId('bottom-panel')).toContainText('No problems found');
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  expect(errors).toEqual([]);
});
