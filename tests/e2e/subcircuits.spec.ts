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

// R11a acceptance in the browser: add a circuit, give it ports, place it in Main, wire it, run.

const level = (page: Page, pin: string): Locator =>
  properties(page)
    .locator('.prop-row')
    .filter({ has: page.locator('.prop-label', { hasText: new RegExp(`^${pin}$`) }) })
    .getByTestId('live-level');
const circuits = (page: Page) => page.getByTestId('circuits');

const GATE: Point = [0, 0];
const SWITCH: Point = [-14, 0];
const INSTANCE: Point = [0, 0];
const LED: Point = [12, 1];
const GND: Point = [18, 4];

test('a subcircuit made in the app: ports, an instance in Main, wired and running', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);

  // Circuit ▸ Add Circuit opens "Circuit 2" with its name ready to type.
  await page.getByTestId('add-circuit').click();
  await expect(circuits(page).getByRole('button', { name: /Circuit 2/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const name = page.getByTestId('circuit-name');
  await expect(name).toBeFocused();
  await name.fill('Inverter');
  await name.press('Enter');
  await expect(circuits(page).getByRole('button', { name: /Inverter/ })).toBeVisible();

  // Inside: an inverter between an input port and an output port, each placed on a pin.
  await place(page, grid, 'prim/not', GATE);
  await page.keyboard.press('Shift+L');
  await clickAt(page, grid(pinOf('prim/not', GATE, 'A')));
  await clickAt(page, grid(pinOf('prim/not', GATE, 'Y')));
  await page.keyboard.press('Escape');
  await expect(summary(page)).toHaveText('P2 · PORT');
  await properties(page).getByTestId('prop-direction').selectOption('out');
  await expect(page.getByTestId('issue-counts')).toContainText('0');

  // Back in Main: the Inverter from the Parts panel's Subcircuits, a switch, an LED.
  await circuits(page).getByRole('button', { name: /Main/ }).click();
  await page.getByRole('button', { name: /Subcircuits/ }).waitFor();
  await place(page, grid, 'sub/inverter', INSTANCE);
  await clickAt(page, grid(INSTANCE));
  await expect(summary(page)).toHaveText('A1 · Inverter');
  await expect(circuits(page).getByRole('button', { name: /Inverter/ })).toContainText('1×');
  // The generated symbol: 7 × 3 cells with its stubs, PORT1 on the left, PORT2 on the right.
  const input: Point = [INSTANCE[0] - 4, INSTANCE[1]];
  const output: Point = [INSTANCE[0] + 3, INSTANCE[1]];
  await place(page, grid, 'io/switch', SWITCH);
  await place(page, grid, 'io/led', LED);
  await place(page, grid, 'io/gnd', GND);
  await wire(page, grid, pinOf('io/switch', SWITCH, 'Y'), input);
  await wire(page, grid, output, pinOf('io/led', LED, 'A'));
  await wire(page, grid, pinOf('io/led', LED, 'K'), pinOf('io/gnd', GND, 'Y'));
  await expect(page.getByTestId('issue-counts')).toHaveText(/0\s*0/);

  // Running: the LED is the switch inverted, through the instance's NOT (A1/U1).
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await clickAt(page, grid(LED));
  await expect(summary(page)).toHaveText('D1 · LED');
  const before = await level(page, 'A').textContent();
  await clickAt(page, grid(SWITCH));
  await expect(level(page, 'A')).not.toHaveText(before ?? '');
  await clickAt(page, grid(SWITCH));
  await expect(level(page, 'A')).toHaveText(before ?? '');

  // A double-click on the instance opens its circuit; Main simulates on, drawn elsewhere.
  await page.keyboard.press('v');
  await page.mouse.dblclick(...grid(INSTANCE));
  await expect(circuits(page).getByRole('button', { name: /Inverter/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('not-simulated')).toContainText('Main simulates');
  expect(errors).toEqual([]);
});
