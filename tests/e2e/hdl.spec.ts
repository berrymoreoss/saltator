import { expect, type Locator, type Page, test } from '@playwright/test';
import addressDecoder from '../../examples/verilog-address-decoder.saltator.json' with {
  type: 'json',
};
import counterTrafficLight from '../../examples/verilog-counter-traffic-light.saltator.json' with {
  type: 'json',
};
import uart from '../../examples/verilog-uart.saltator.json' with { type: 'json' };
import { YOSYS_FIXTURES } from '../../src/library/hdl/fixtures';
import {
  clickAt,
  menu,
  newCircuit,
  openExample,
  place,
  properties,
  summary,
  watchErrors,
} from './support';

// HDL-1 in the browser: a module from Yosys's JSON, compiled in the app, placed and running.

const view = (page: Page) => page.getByTestId('module-view');
const messages = (page: Page) => page.getByTestId('module-messages');
const circuits = (page: Page) => page.getByTestId('circuits');
const level = (page: Page, pin: string): Locator =>
  properties(page)
    .locator('.prop-row')
    .filter({ has: page.locator('.prop-label', { hasText: new RegExp(`^${pin}$`) }) })
    .getByTestId('live-level');

async function compile(page: Page, json: string) {
  await page.getByTestId('module-json').fill(json);
  await page.getByTestId('compile-module').click();
}

test('a Verilog module: the command, a refused JSON, Compile, undo, placed in Main', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  await page.getByTestId('add-verilog-module').click();
  await expect(circuits(page).getByRole('button', { name: /Module 2/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(view(page)).toBeVisible();
  await expect(page.getByTestId('yosys-command')).toContainText('proc -norom; flatten');
  await expect(page.getByTestId('module-summary')).toHaveText('Not compiled yet.');

  // What the interpreter can't run yet is refused with its source location.
  await compile(page, YOSYS_FIXTURES.hierarchy!);
  await expect(messages(page)).toContainText(
    'hierarchy.v:8.7-8.24: the module places module inv (u1): make the JSON with the command, which flattens',
  );
  await expect(page.getByTestId('module-summary')).toHaveText('Not compiled yet.');

  // Yosys's JSON of the decoder: compiled, its ports and cells listed.
  await compile(page, YOSYS_FIXTURES.decoder!);
  await expect(messages(page)).toContainText('Compiled decoder: 6 cells');
  await expect(page.getByTestId('module-summary')).toContainText('addr[15:12]');

  // Compile is one undo step.
  await menu(page, 'Edit', /^Undo/);
  await expect(page.getByTestId('module-summary')).toHaveText('Not compiled yet.');
  await menu(page, 'Edit', /^Redo/);
  await expect(page.getByTestId('module-summary')).toContainText('Module decoder');

  // In Main: placed from Parts ▸ Subcircuits, an instance with the module's pins.
  await circuits(page).getByRole('button', { name: /Main/ }).click();
  await expect(view(page)).toBeHidden();
  await place(page, grid, 'sub/module-2', [0, 0]);
  await clickAt(page, grid([0, 0]));
  await expect(summary(page)).toHaveText('A1 · Module 2');
  await expect(properties(page)).toContainText('addr[15..12]');
  await expect(circuits(page).getByRole('button', { name: /Module 2/ })).toContainText('1×');
  expect(errors).toEqual([]);
});

test('Verilog Address Decoder: the switches select a chip, and its benches pass', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const at = await openExample(
    page,
    'verilog-address-decoder',
    'Verilog Address Decoder',
    addressDecoder,
  );
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  // D3 lights while ROM is selected: its cathode on ROM_CS, LOW from A15 = 1.
  await clickAt(page, at.center('D3'));
  await expect(summary(page)).toHaveText('D3 · LED');
  await expect(level(page, 'K')).toHaveText('1');
  await clickAt(page, at.center('SW1'));
  await expect(level(page, 'K')).toHaveText('0');
  await clickAt(page, at.center('SW1'));
  await expect(level(page, 'K')).toHaveText('1');

  // Compiled again while running (another decoder with the same ports, and a page output): the
  // run goes on, the module restarts, and the LED follows the switch through the new IR.
  await circuits(page)
    .getByRole('button', { name: /Address Decoder/ })
    .click();
  await compile(page, YOSYS_FIXTURES.decoder!);
  await expect(messages(page)).toContainText('Compiled decoder: 6 cells');
  await circuits(page).getByRole('button', { name: /Main/ }).click();
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await clickAt(page, at.center('D3'));
  await expect(level(page, 'K')).toHaveText('1');
  await clickAt(page, at.center('SW1'));
  await expect(level(page, 'K')).toHaveText('0');
  await page.keyboard.press('Shift+F5');
  await menu(page, 'Edit', /^Undo/);

  // The module's own benches and the board's, in the Tests tab's sandbox.
  await page.getByRole('tab', { name: /^Tests/ }).click();
  await menu(page, 'Test', 'Run All Tests');
  await expect(page.getByRole('tab', { name: /^Tests/ })).toContainText('✓ 4', { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("Verilog Counter and Traffic Light: its modules' benches and the board's pass", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openExample(
    page,
    'verilog-counter-traffic-light',
    'Verilog Counter and Traffic Light',
    counterTrafficLight,
  );
  await page.getByRole('tab', { name: /^Tests/ }).click();
  await menu(page, 'Test', 'Run All Tests');
  await expect(page.getByRole('tab', { name: /^Tests/ })).toContainText('✓ 6', { timeout: 30_000 });
  expect(errors).toEqual([]);
});

// HDL-8: a module on a bus — an inout port, its bench writing and reading through it.
const IO_PORT_BENCH = `bench('writes $A5, reads its pins', (b) => {
  b.set({ strobe: 0, cs_n: 0, rw: 0, 'pins[7..0]': 0x3c, 'd[7..0]': 0xa5 });
  b.wait('1us');
  b.clock('strobe');
  b.expect({ 'q[7..0]': 0xa5 });
  b.set({ rw: 1, 'd[7..0]': 'Z', strobe: 1 });
  b.wait('1us');
  b.expect({ 'd[7..0]': 0x3c });
});
`;

test('a module on a bus: an inout port, its bench, placed as a bus pin', async ({ page }) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  await page.getByTestId('add-verilog-module').click();
  await expect(page.getByTestId('yosys-command')).toContainText('flatten; tribuf -logic; opt');
  await compile(page, YOSYS_FIXTURES.io_port!);
  await expect(messages(page)).toContainText('Compiled io_port: 7 cells');
  const ports = page.getByTestId('module-summary');
  await expect(ports.getByRole('row').filter({ hasText: 'd[7:0]' })).toContainText('inout');
  await expect(ports.getByRole('row').filter({ hasText: 'q[7:0]' })).toContainText('output');

  await page.getByRole('tab', { name: /^Tests/ }).click();
  const code = page.getByTestId('tests-panel').locator('.cm-content');
  await code.click();
  await page.keyboard.insertText(IO_PORT_BENCH);
  await page.keyboard.press('ControlOrMeta+Enter');
  const benches = page.getByTestId('test-results').getByTestId('bench-row');
  await expect(benches.and(page.locator('[data-state="pass"]'))).toHaveCount(1);

  await circuits(page).getByRole('button', { name: /Main/ }).click();
  await place(page, grid, 'sub/module-2', [0, 0]);
  await clickAt(page, grid([0, 0]));
  await expect(summary(page)).toHaveText('A1 · Module 2');
  await expect(properties(page)).toContainText('d[7..0]');
  expect(errors).toEqual([]);
});

// HDL-4: inside a module — its registers in the waveforms, its Signals with live values, a watch.
test('Verilog UART: the registers inside its modules, probed, listed and watched', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openExample(page, 'verilog-uart', 'Verilog UART', uart);
  const waves = page.getByTestId('waves-panel');
  await page.getByRole('tab', { name: /Waveforms/ }).click();
  await expect(waves.getByTestId('waves-row').locator('.waves-name')).toHaveText([
    'SEND',
    'LINE',
    'A1/shift',
    'A1/left',
    'A2/at',
    'A2/shift',
    'VALID',
  ]);
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  // Idle: the transmitter's shift register all ones, as the line.
  const shift = waves.getByTestId('waves-row').filter({ hasText: 'A1/shift' });
  await expect(shift.getByTestId('waves-value')).toHaveText('1111111111');

  // The transmitter's view lists its signals with the running instance's values.
  await page
    .getByTestId('circuits')
    .getByRole('button', { name: /UART Transmitter/ })
    .click();
  const signals = page.getByTestId('module-signals');
  await expect(signals.locator('tr')).toHaveCount(4);
  await expect(page.getByTestId('module-summary')).toContainText('Signals in A1');
  await expect(signals.locator('tr[data-signal="shift"] .module-value')).toHaveText('0x3FF');
  await expect(signals.locator('tr[data-signal="left"] .module-value')).toHaveText('0x0');

  // Watch from the list: the Debug tab shows it; Probe adds it to the waveforms.
  await signals.getByRole('button', { name: 'Watch left' }).click();
  await expect(page.getByTestId('debug-panel').getByTestId('watch')).toContainText('A1/left');
  await signals.getByRole('button', { name: 'Probe tick' }).click();
  await expect(waves.getByTestId('waves-row').locator('.waves-name').last()).toHaveText('A1/tick');
  expect(errors).toEqual([]);
});
