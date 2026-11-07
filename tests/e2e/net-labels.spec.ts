import { expect, type Page, test } from '@playwright/test';
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
} from './support';

// R10a in the browser: net labels placed from the canvas Place submenu and with L, renamed in
// Properties, join distant pins by name; the Net Labels example opens clean and runs.

const SWITCH: Point = [-14, 0];
const NAND: Point = [10, 1];

test('labels placed from the Place submenu and with L join distant pins by name', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  await place(page, grid, 'io/switch', SWITCH);
  await place(page, grid, 'prim/nand', NAND);
  const out = pinOf('io/switch', SWITCH, 'Y');
  const input = pinOf('prim/nand', NAND, 'A');

  // Right click on empty canvas ▸ Place ▸ Net Label: the label's point lands on the click.
  await clickAt(page, grid([0, 12]), { button: 'right' });
  const contextMenu = page.getByTestId('context-menu');
  await contextMenu.getByRole('menuitem', { name: 'Place', exact: true }).hover();
  await contextMenu.getByRole('menuitem', { name: /^Net Label/ }).click();
  await page.mouse.move(...grid(out));
  await clickAt(page, grid(out));
  await page.keyboard.press('Escape');
  await expect(summary(page)).toHaveText('NL1 · NET LABEL');
  const name = properties(page).getByTestId('prop-name');
  await expect(name).toHaveValue('NET1');
  await name.fill('C K');
  await expect(properties(page)).toContainText('Use letters, digits');
  await name.fill('CLK');
  await name.press('Enter');
  const messages = page.getByTestId('bottom-panel');
  await expect(messages).toContainText('net label NL1 "CLK" is the only one with this name');

  // L arms the next label, named after the last one; R R points it the other way.
  await canvasFocus(page, grid);
  await page.keyboard.press('l');
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  await page.mouse.move(...grid(input));
  await clickAt(page, grid(input));
  await page.keyboard.press('Escape');
  await expect(summary(page)).toHaveText('NL2 · NET LABEL');
  await expect(properties(page).getByTestId('prop-name')).toHaveValue('CLK');
  await expect(messages).not.toContainText('is the only one with this name');

  // The NAND's input is now on the switch's net, called CLK.
  await clickAt(page, grid(NAND));
  await expect(
    properties(page)
      .locator('.prop-row', { hasText: /^1?\s*A/ })
      .first(),
  ).toContainText('CLK');
  expect(errors).toEqual([]);
});

test('the Place menu arms the place tool with presets', async ({ page }) => {
  const grid = await newCircuit(page);
  await menu(page, 'Place', /^Pull-down/);
  await clickAt(page, grid([0, 0]));
  await page.keyboard.press('Escape');
  await expect(summary(page)).toHaveText('R1 · PULL');
  await expect(properties(page).getByTestId('prop-direction')).toHaveValue('down');
});

test('the Net Labels example opens without design issues and runs cleanly', async ({ page }) => {
  const errors = watchErrors(page);
  await newCircuit(page);
  await menu(page, 'File', 'New from Example…');
  await page.getByTestId('example-gallery').locator('[data-example="net-labels"]').click();
  await expect(page).toHaveTitle('Net Labels — Logic');
  await expect(page.getByTestId('bottom-panel')).toContainText('No problems found');
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await page.getByRole('tab', { name: /Simulation/ }).click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems while running');
  expect(errors).toEqual([]);
});

/** Gives the canvas the keyboard (a click on empty canvas, which also clears the selection). */
async function canvasFocus(page: Page, grid: (p: Point) => Point) {
  await clickAt(page, grid([0, 14]));
}
