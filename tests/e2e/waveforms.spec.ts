import { expect, type Page, test } from '@playwright/test';
import clockModule from '../../examples/clock-module.saltator.json' with { type: 'json' };
import dataBus from '../../examples/data-bus.saltator.json' with { type: 'json' };
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
  // The example opens with its 555 outputs and CLK probed; the Probe tool adds U3's output.
  await page.keyboard.press('p');
  await clickAt(page, at.pin('U3', 'OUT'));
  await expect(page.getByRole('tab', { name: /Waveforms/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).last()).toContainText('U3.OUT');

  // The 555 runs at 1 / (0.693 (RA + 2 RB) C) = 1.533 Hz: 2.5 s show a few periods.
  await page.keyboard.press('F5');
  await page.waitForTimeout(2500);
  await page.keyboard.press('F5'); // pause
  await rows(page).filter({ hasText: 'astable' }).click(); // U1.OUT
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
  // Opens with the bus, the register's clock and its outputs (a group) probed.
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first()).toContainText('D[0..7]');
  await waves(page).getByLabel('Signal to add').fill('D[0..7]');
  await waves(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(waves(page).getByRole('alert')).toContainText('D[0..7] is probed already.');

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
  expect(text).toContain('$dumpvars\nbzzzzzzzz !\n');
  expect(text).toContain('#11000\nb00101010 !\n');
  expect(text).toContain('$var wire 8 # Q [7:0] $end'); // the register's outputs, a group
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
  await page.mouse.click(...at.pin('U3', 'OUT'), { button: 'right' });
  await page.getByRole('menuitem', { name: /Add U3.OUT to Waveforms/ }).click();
  await expect(rows(page)).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows(page)).toHaveCount(3);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(rows(page)).toHaveCount(4);
  await page.keyboard.press('F5'); // probing doesn't stop a running simulation
  await page.mouse.click(...at.pin('U5', '1Y'), { button: 'right' });
  await page.getByRole('menuitem', { name: /Add U5.1Y to Waveforms/ }).click();
  await expect(rows(page)).toHaveCount(5);
  await expect(page.getByTestId('sim-status')).toContainText('Running');

  await pick(page, 'save', 'clock.saltator.json');
  await menu(page, 'File', /Save As/);
  await expect(page).toHaveTitle('clock — Saltator');
  const saved = (await readFile(page, 'clock.saltator.json'))!;
  expect(saved).toContain('"schemaVersion": 7');
  expect(saved).toContain('        { "ref": "U3.OUT" },\n        { "ref": "U5.1Y" }\n      ]');
  expect(errors).toEqual([]);
});
