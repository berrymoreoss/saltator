import { expect, type Locator, type Page, test } from '@playwright/test';
import type { Point } from '../../src/circuit';
import {
  clickAt,
  newCircuit,
  pinOf,
  place,
  properties,
  summary,
  watchErrors,
  wire,
} from './support';

// Real chips in the browser (R06): the M1 circuit with a 74HC00 placed from the Parts panel, and
// the Part tab of the bottom dock.

const HC00 = '74xx/74hc00';
const level = (page: Page, pin: string): Locator =>
  properties(page)
    .locator('.prop-row')
    .filter({ has: page.locator('.prop-label', { hasText: new RegExp(`^${pin}$`) }) })
    .getByTestId('live-level');
const sheet = (page: Page) => page.getByTestId('part-sheet');
const partTab = (page: Page) => page.getByRole('tab', { name: 'Part', exact: true });

// Click positions (a placed part is centered on the click) and the pins they give.
const CHIP: Point = [0, 4]; // 1A (-3, 1), 1B (-3, 2), 1Y (-3, 3)
const SWITCH: Point = [-12, 2]; // Y (-10, 2), level with 1B
const VCC: Point = [-6, -4]; // Y (-6, -3)
const LED: Point = [-3, 10]; // A (-5, 10), K (-1, 10)
const GND: Point = [1, 12]; // Y (1, 11)

test('a 74HC00 from the Parts panel runs: switch → gate 1 → LED', async ({ page }) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  await page.getByRole('button', { name: /74HC Logic/ }).waitFor();
  await place(page, grid, 'io/switch', SWITCH);
  await place(page, grid, HC00, CHIP);
  await expect(summary(page)).toHaveText('U1 · 74HC00');
  await place(page, grid, 'io/vcc', VCC);
  await place(page, grid, 'io/led', LED);
  await place(page, grid, 'io/gnd', GND);

  const vcc = pinOf('io/vcc', VCC, 'Y');
  const a = pinOf(HC00, CHIP, '1A');
  await wire(page, grid, vcc, [vcc[0], a[1]], a); // 1A tied high: gate 1 is an inverter
  await wire(page, grid, pinOf('io/switch', SWITCH, 'Y'), pinOf(HC00, CHIP, '1B'));
  const y = pinOf(HC00, CHIP, '1Y');
  const anode = pinOf('io/led', LED, 'A');
  await wire(page, grid, y, [anode[0], y[1]], anode);
  await wire(page, grid, pinOf('io/led', LED, 'K'), pinOf('io/gnd', GND, 'Y'));

  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await clickAt(page, grid(LED)); // a click on an LED selects it
  await expect(summary(page)).toHaveText('D1 · LED');
  await expect(level(page, 'A')).toHaveText('1'); // switch off: NAND(1, 0) = 1
  await clickAt(page, grid(SWITCH)); // the Interact tool flips it
  await expect(level(page, 'A')).toHaveText('0');
  await clickAt(page, grid(SWITCH));
  await expect(level(page, 'A')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('the Part tab shows the pins, function table and data sheet of the part picked last', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  await partTab(page).click();
  await expect(page.getByTestId('bottom-panel')).toContainText('Select a part');

  // Picked in the Parts panel.
  await page.locator('[data-type="74xx/74hc245"]').click();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toContainText('Octal bus transceiver; 3-state');
  await expect(sheet(page).getByRole('table', { name: 'Pins' })).toContainText('direction control');
  await expect(sheet(page).getByRole('table', { name: 'Function table' })).toContainText('A = B');
  await expect(sheet(page).getByRole('link', { name: /Datasheet 74HC_HCT245/ })).toHaveAttribute(
    'href',
    'https://assets.nexperia.com/documents/data-sheet/74HC_HCT245.pdf',
  );

  // Placed (and so selected) on the canvas: the header names the instance.
  await place(page, grid, HC00, CHIP);
  await expect(sheet(page)).toContainText('U1');
  await expect(sheet(page)).toContainText('Quad 2-input NAND gate');
  await expect(sheet(page).getByRole('table', { name: 'Function table' })).toContainText(
    'each gate (n = 1 to 4)',
  );

  // The context menu opens the tab from another one.
  await page.getByRole('tab', { name: /Messages/ }).click();
  await clickAt(page, grid(CHIP), { button: 'right' });
  await page.getByRole('menuitem', { name: /Part Info/ }).click();
  await expect(partTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(sheet(page)).toContainText('74HC00');
  expect(errors).toEqual([]);
});
