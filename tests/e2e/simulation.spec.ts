import { expect, type Locator, type Page, test } from '@playwright/test';
import type { Point } from '../../src/circuit';
import {
  clickAt,
  drawHelloLed,
  newCircuit,
  pinOf,
  place,
  properties,
  summary,
  watchErrors,
  wire,
} from './support';

// Running circuits in the browser (R05). Levels are read from the Properties panel's live
// badges; the canvas is sampled only to see that a lit LED is drawn lit.

const status = (page: Page) => page.getByTestId('sim-status');
const toolbar = (page: Page, name: string) =>
  page.getByRole('toolbar').getByRole('button', { name, exact: true });

/** The live level badge of a pin in the Properties panel (the selected part). */
const level = (page: Page, pin: string): Locator =>
  properties(page)
    .locator('.prop-row')
    .filter({ has: page.locator('.prop-label', { hasText: new RegExp(`^${pin}$`) }) })
    .getByTestId('live-level');

/** Red channel at a grid point of the canvas, in device pixels. */
async function redAt(page: Page, p: Point): Promise<number> {
  return page.evaluate(([x, y]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="schematic"]')!;
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    const data = canvas
      .getContext('2d')!
      .getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data;
    return data[0]!;
  }, p);
}

test('Hello, LED runs: F5 powers it on, the switch drives D1, the clock blinks D2', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const grid = await drawHelloLed(page);
  await expect(status(page)).toHaveText(/Stopped/);
  await page.keyboard.press('F5');
  await expect(status(page)).toHaveText(/Running · /);
  const interact = toolbar(page, 'Operate switches and buttons while simulating');
  await expect(interact).toHaveAttribute('aria-pressed', 'true');

  // The NAND inverts the switch: off → D1's anode is 1 and D1 is lit.
  await clickAt(page, grid([12, 1])); // a click on an LED selects it
  await expect(summary(page)).toHaveText('D1 · LED');
  await expect(level(page, 'A')).toHaveText('1');
  await expect(level(page, 'K')).toHaveText('0');
  const [ax, ay] = pinOf('io/led', [12, 1], 'A');
  const diode = grid([ax + 2, ay]); // the diode, two cells right of the anode pin
  const lit = await redAt(page, diode);

  await clickAt(page, grid([-12, 0])); // flips the switch
  await expect(level(page, 'A')).toHaveText('0');
  await expect.poll(() => redAt(page, diode)).toBeLessThan(lit);

  // The 1 Hz clock: D2's anode goes 1 and back to 0 within a period.
  await clickAt(page, grid([12, 9]));
  await expect(summary(page)).toHaveText('D2 · LED');
  await expect(level(page, 'A')).toHaveText('1', { timeout: 2000 });
  await expect(level(page, 'A')).toHaveText('0', { timeout: 2000 });
  expect(errors).toEqual([]);
});

test('Step, Pause, Stop and Reset from the keyboard and the toolbar; F5 never reloads', async ({
  page,
}) => {
  await drawHelloLed(page);
  await page.evaluate(() => Object.assign(window, { notReloaded: true }));

  await page.keyboard.press('F10'); // powers on and runs t = 0
  await expect(status(page)).toHaveText(/^Paused · 0 ps/);
  await page.keyboard.press('F10'); // the NAND's output, one gate delay later
  await expect(status(page)).toHaveText(/^Paused · 1 ns/);

  await toolbar(page, 'Run / Pause').click();
  await expect(status(page)).toHaveText(/Running/);
  await expect(toolbar(page, 'Step to the next event')).toBeDisabled();
  await page.keyboard.press('F5');
  await expect(status(page)).toHaveText(/Paused/);

  // F5 typed into a text field (the parts search) still runs the simulation, not a reload.
  await page.keyboard.press('/');
  await expect(page.getByPlaceholder('Search parts')).toBeFocused();
  await page.keyboard.press('F5');
  await expect(status(page)).toHaveText(/Running/);
  await expect(status(page)).toHaveText(/Running · 1(\.\d+)? s/, { timeout: 3000 });
  await page.keyboard.press('ControlOrMeta+Shift+F5'); // Reset: back to t = 0
  await expect(status(page)).toHaveText(/^Running · \d+(\.\d+)? (ps|ns|µs|ms)/);

  await page.keyboard.press('Shift+F5');
  await expect(status(page)).toHaveText('Stopped');
  await expect(toolbar(page, 'Select')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+F5'); // disabled now, and still no reload
  expect(await page.evaluate(() => 'notReloaded' in window)).toBe(true);
});

test('a push button is held while the mouse is down', async ({ page }) => {
  const grid = await newCircuit(page);
  await place(page, grid, 'io/button', [-8, 0]);
  await place(page, grid, 'io/led', [4, 0]);
  await place(page, grid, 'io/gnd', [10, 3]);
  await wire(page, grid, pinOf('io/button', [-8, 0], 'Y'), pinOf('io/led', [4, 0], 'A'));
  await wire(page, grid, pinOf('io/led', [4, 0], 'K'), pinOf('io/gnd', [10, 3], 'Y'));
  await page.keyboard.press('F5');
  await clickAt(page, grid([4, 0]));
  await expect(level(page, 'A')).toHaveText('Z'); // SPST to VCC, open: floating

  await page.mouse.move(...grid([-8, 0]));
  await page.mouse.down();
  await expect(level(page, 'A')).toHaveText('1');
  await page.mouse.move(...grid([-3, 6])); // moving off keeps it pressed
  await expect(level(page, 'A')).toHaveText('1');
  await page.mouse.up();
  await expect(level(page, 'A')).toHaveText('Z');
});

test('editing while running keeps the switch position, across a rename too', async ({ page }) => {
  const grid = await drawHelloLed(page);
  await page.keyboard.press('F5');
  await clickAt(page, grid([-12, 0])); // switch on → D1 dark
  await page.keyboard.press('v');
  await clickAt(page, grid([12, 1]));
  await expect(level(page, 'A')).toHaveText('0');

  // A structural edit: place another part while running.
  await place(page, grid, 'io/probe', [0, 9]);
  await clickAt(page, grid([12, 1]));
  await expect(level(page, 'A')).toHaveText('0');

  // Rename the switch in Properties.
  await clickAt(page, grid([-12, 0]));
  await expect(summary(page)).toHaveText('SW1 · SW');
  await page.getByTestId('prop-designator').fill('SW9');
  await page.keyboard.press('Enter');
  await expect(summary(page)).toHaveText('SW9 · SW');
  await expect(level(page, 'Y')).toHaveText('1');
  await expect(status(page)).toHaveText(/Running/);
});

test('a short circuit is listed in the Simulation tab and located by a click', async ({ page }) => {
  const grid = await newCircuit(page);
  await place(page, grid, 'io/switch', [-8, 0]);
  await place(page, grid, 'io/switch', [-8, 6]);
  const a = pinOf('io/switch', [-8, 0], 'Y');
  const b = pinOf('io/switch', [-8, 6], 'Y');
  await wire(page, grid, a, [a[0] + 2, a[1]], [b[0] + 2, b[1]], b);
  await page.getByRole('tab', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-diagnostics')).toContainText('Run the simulation');

  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems');
  await clickAt(page, grid([-8, 0])); // one switch on, the other off: a short
  const row = page.getByTestId('sim-diagnostics').getByRole('button', { name: /contention/ });
  await expect(row).toContainText('bus contention on net');
  await expect(status(page)).toContainText('1');
  await row.click();
  await expect(summary(page)).toHaveText(/wire/i);

  await page.getByTitle(/Clear the list/).click();
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems');
});

test('the speed select changes how fast simulated time runs', async ({ page }) => {
  await drawHelloLed(page);
  const speed = page.getByRole('combobox', { name: 'Simulation speed' });
  await speed.selectOption({ label: '1 ms/s' });
  await page.keyboard.press('F5');
  await page.waitForTimeout(500);
  // Half a second at 1 ms/s is about 500 µs of simulated time.
  await expect(status(page)).toHaveText(/Running · \d+(\.\d+)? µs/);
  await expect(speed).toHaveValue('1ms');
});
