import { expect, type Locator, type Page, test } from '@playwright/test';
import type { Point } from '../../src/circuit';
import { pick, readFile, stubFileSystemAccess } from './file-system';
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

// M1 "Hello, LED" acceptance (roadmap): in the browser, build switch → 74HC00 → LED and
// clock → LED; run; the LED follows the logic; save, reload, still works.

const HC00 = '74xx/74hc00';
const CHIP: Point = [0, 4];
const SWITCH: Point = [-12, 2];
const VCC: Point = [-6, -4];
const LED: Point = [-3, 10];
const GND: Point = [1, 12];
const CLOCK: Point = [-14, -9];
const BLINK: Point = [-5, -9];
const GND2: Point = [1, -7];

const level = (page: Page, pin: string): Locator =>
  properties(page)
    .locator('.prop-row')
    .filter({ has: page.locator('.prop-label', { hasText: new RegExp(`^${pin}$`) }) })
    .getByTestId('live-level');
const status = (page: Page) => page.getByTestId('sim-status');

/** Runs the circuit and checks that D1 follows the switch and D2 blinks. */
async function runAndCheck(page: Page, grid: (p: Point) => Point) {
  await page.keyboard.press('F5');
  await expect(status(page)).toHaveText(/Running · /);
  await clickAt(page, grid(LED));
  await expect(summary(page)).toHaveText('D1 · LED');
  await expect(level(page, 'A')).toHaveText('1'); // switch off: NAND(1, 0) = 1
  await clickAt(page, grid(SWITCH));
  await expect(level(page, 'A')).toHaveText('0');
  await clickAt(page, grid(SWITCH));
  await expect(level(page, 'A')).toHaveText('1');
  await clickAt(page, grid(BLINK));
  await expect(summary(page)).toHaveText('D2 · LED');
  await expect(level(page, 'A')).toHaveText('1', { timeout: 2000 });
  await expect(level(page, 'A')).toHaveText('0', { timeout: 2000 });
  await page.keyboard.press('Shift+F5');
  await expect(status(page)).toHaveText(/Stopped/);
}

test('M1: build switch → 74HC00 → LED and clock → LED, run, save, reload, still works', async ({
  page,
}) => {
  await page.addInitScript(stubFileSystemAccess);
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  await page.getByRole('button', { name: /74HC Logic/ }).waitFor();
  await place(page, grid, 'io/switch', SWITCH);
  await place(page, grid, HC00, CHIP);
  await place(page, grid, 'io/vcc', VCC);
  await place(page, grid, 'io/led', LED);
  await place(page, grid, 'io/gnd', GND);
  await place(page, grid, 'io/clock', CLOCK);
  await place(page, grid, 'io/led', BLINK);
  await place(page, grid, 'io/gnd', GND2);

  const vcc = pinOf('io/vcc', VCC, 'Y');
  const a = pinOf(HC00, CHIP, '1A');
  await wire(page, grid, vcc, [vcc[0], a[1]], a);
  await wire(page, grid, pinOf('io/switch', SWITCH, 'Y'), pinOf(HC00, CHIP, '1B'));
  const y = pinOf(HC00, CHIP, '1Y');
  const anode = pinOf('io/led', LED, 'A');
  await wire(page, grid, y, [anode[0], y[1]], anode);
  await wire(page, grid, pinOf('io/led', LED, 'K'), pinOf('io/gnd', GND, 'Y'));
  await wire(page, grid, pinOf('io/clock', CLOCK, 'Y'), pinOf('io/led', BLINK, 'A'));
  const k = pinOf('io/led', BLINK, 'K');
  const gnd = pinOf('io/gnd', GND2, 'Y');
  await wire(page, grid, k, [gnd[0], k[1]], gnd);
  await expect(page.getByTestId('counts')).toHaveText(/^8 parts · /);
  const drawn = (await page.getByTestId('counts').textContent())!;

  await runAndCheck(page, grid);

  await pick(page, 'save', 'm1.saltator.json');
  await page.keyboard.press('ControlOrMeta+S');
  await expect(page).toHaveTitle('m1 — Logic');
  expect(await readFile(page, 'm1.saltator.json')).toContain('"74xx/74hc00"');

  // The reload restores the session (same view: the grid mapping still holds).
  await page.reload();
  await expect(page).toHaveTitle('m1 — Logic');
  await expect(page.getByTestId('counts')).toHaveText(drawn);
  await runAndCheck(page, grid);

  // And the file itself opens and runs.
  await menu(page, 'File', 'New Document');
  await expect(page).toHaveTitle('Untitled — Logic');
  await pick(page, 'open', 'm1.saltator.json');
  await page.keyboard.press('ControlOrMeta+O');
  await expect(page).toHaveTitle('m1 — Logic');
  await expect(page.getByTestId('counts')).toHaveText(drawn);
  expect(errors).toEqual([]);
});
