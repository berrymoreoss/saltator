import { expect, type Page, test } from '@playwright/test';
import clockModule from '../../examples/clock-module.logic.json' with { type: 'json' };
import dataBus from '../../examples/data-bus.logic.json' with { type: 'json' };
import { pick, readFile, stubFileSystemAccess } from './file-system';
import { clickAt, menu, openExample, watchErrors } from './support';

// R13 in the browser: probing from the canvas, the Waveforms tab while running, cursors measuring
// a clock's period, a trigger on a bus value pausing the run, VCD export, probes in the file.

const waves = (page: Page) => page.getByTestId('waves-panel');
const readout = (page: Page) => page.getByTestId('cursor-readout');
const rows = (page: Page) => waves(page).getByTestId('waves-row');

test('Clock Module: the clock probed with the Probe tool; the cursors measure its period', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const at = await openExample(page, 'clock-module', 'Clock Module', clockModule);
  await page.keyboard.press('p');
  await clickAt(page, at.pin('U1', 'OUT'));
  await expect(page.getByRole('tab', { name: /Waveforms/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('U1.OUT');

  // The 555 runs at 1 / (0.693 (RA + 2 RB) C) = 1.533 Hz: 2.5 s show a few periods.
  await page.keyboard.press('F5');
  await page.waitForTimeout(2500);
  await page.keyboard.press('F5'); // pause
  await rows(page).first().click();
  const plot = waves(page).getByTestId('waves-plot');
  await plot.focus();
  // A on the 2nd edge, B on the 4th: one whole period apart, past the longer first high time.
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+BracketRight');
  await expect(readout(page)).toContainText('Δ 652.113 ms · 1.533 Hz');
  expect(errors).toEqual([]);
});

test('Data Bus: a trigger on the bus value pauses the run; the capture exports as VCD', async ({
  page,
}) => {
  await page.addInitScript(stubFileSystemAccess);
  const errors = watchErrors(page);
  const at = await openExample(page, 'data-bus', 'Data Bus', dataBus);
  await page.getByRole('tab', { name: /Waveforms/ }).click();
  await waves(page).getByLabel('Signal to add').fill('D[0..7]');
  await waves(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(rows(page).first()).toContainText('D[0..7]');

  await page.keyboard.press('F5');
  await expect(rows(page).first().getByTestId('waves-value')).toHaveText('0x2A'); // DIP on = 42
  await waves(page).getByTestId('trigger-button').click();
  const dialog = page.getByTestId('trigger-dialog');
  await expect(dialog.getByLabel('Condition')).toHaveValue('equal');
  await dialog.getByLabel('Value').fill('2B');
  await dialog.getByLabel('Window').fill('100 ms');
  await dialog.getByRole('button', { name: 'Arm' }).click();
  await expect(waves(page).getByTestId('trigger-button')).toHaveText('Armed');

  await clickAt(page, at.lever('SW1', 'S1')); // bit 0: 0x2B
  await expect(waves(page).getByTestId('trigger-button')).toHaveText(/^Triggered at /);
  await expect(page.getByTestId('sim-status')).toContainText('Paused');
  const triggered = (await waves(page).getByTestId('trigger-button').textContent())!;

  await pick(page, 'save', 'bus.vcd');
  await waves(page).getByRole('button', { name: 'Export VCD…' }).click();
  await page.getByTestId('vcd-dialog').getByRole('button', { name: 'Save…' }).click();
  await expect(page.getByTestId('vcd-dialog')).toBeHidden();
  const text = (await readFile(page, 'bus.vcd'))!;
  expect(text).toContain('$timescale 1ps $end');
  expect(text).toContain('$scope module Data_Bus $end');
  expect(text).toContain('$var wire 8 ! D [7:0] $end');
  // The 245's outputs float until enabled (ten = 11 ns), then show the switches.
  expect(text).toContain('$dumpvars\nbzzzzzzzz !\n$end\n#11000\nb00101010 !\n');
  // The trigger, then 90 % of the 100 ms window after it: the record ends there.
  const [, trigger, end] = text.match(/#(\d+)\nb00101011 !\n#(\d+)\n$/)!;
  expect(Number(end) - Number(trigger)).toBe(90e9);
  expect(triggered).toMatch(/Triggered at \d/);
  expect(errors).toEqual([]);
});

test('Probes: added from the context menu, undone, and saved with the circuit', async ({
  page,
}) => {
  await page.addInitScript(stubFileSystemAccess);
  const errors = watchErrors(page);
  const at = await openExample(page, 'clock-module', 'Clock Module', clockModule);
  await page.mouse.click(...at.pin('U2', 'OUT'), { button: 'right' });
  await page.getByRole('menuitem', { name: /Add U2.OUT to Waveforms/ }).click();
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(waves(page)).toContainText('Probe signals to see them here');

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press('F5'); // probing doesn't stop a running simulation
  await page.mouse.click(...at.pin('U3', 'OUT'), { button: 'right' });
  await page.getByRole('menuitem', { name: /Add U3.OUT to Waveforms/ }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId('sim-status')).toContainText('Running');

  await pick(page, 'save', 'clock.logic.json');
  await menu(page, 'File', /Save As/);
  await expect(page).toHaveTitle('clock — Logic');
  const saved = (await readFile(page, 'clock.logic.json'))!;
  expect(saved).toContain('"schemaVersion": 3');
  expect(saved).toContain(
    '"probes": [\n        { "ref": "U2.OUT" },\n        { "ref": "U3.OUT" }\n      ]',
  );
  expect(errors).toEqual([]);
});
