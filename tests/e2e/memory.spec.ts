import { expect, type Page, test } from '@playwright/test';
import eeprom7Segment from '../../examples/eeprom-7-segment.saltator.json' with { type: 'json' };
import ramByHand from '../../examples/ram-by-hand.saltator.json' with { type: 'json' };
import { pick, stubFileSystemAccess, writeFile } from './file-system';
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

// R12a in the browser: the EEPROM 7-Segment Decoder shows the digit its ADDRESS switches pick,
// and RAM by Hand stores a byte from its DATA switches and reads it back. R12b: the Memory tab
// shows, edits, loads and saves their cells.

/** The live level of a selected part's pin in Properties. */
const level = (page: Page, pin: string) =>
  properties(page)
    .locator('.prop-row')
    .filter({ has: page.locator('.prop-label', { hasText: new RegExp(` ${pin}$`) }) })
    .getByTestId('live-level');

/** Expects the data pins IO0…IO7 to show `bits` (IO7 first). */
async function expectData(page: Page, bits: string) {
  for (let i = 0; i < 8; i++) await expect(level(page, `IO${i}`)).toHaveText(bits[7 - i]!);
}

test('EEPROM 7-Segment Decoder: the data pins follow the ADDRESS switches', async ({ page }) => {
  const errors = watchErrors(page);
  const at = await openExample(
    page,
    'eeprom-7-segment',
    'EEPROM 7-Segment Decoder',
    eeprom7Segment,
  );
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await clickAt(page, at.center('U1'));
  await expect(summary(page)).toHaveText('U1 · AT28C16');
  await expectData(page, '00111111'); // 0: segments a–f
  await clickAt(page, at.lever('SW1', 'S1'));
  await clickAt(page, at.lever('SW1', 'S2'));
  await expectData(page, '01001111'); // 3: a, b, c, d, g

  await page.getByRole('tab', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems while running');
  expect(errors).toEqual([]);
});

test('RAM by Hand: a byte written in PROGRAM mode reads back', async ({ page }) => {
  const errors = watchErrors(page);
  const at = await openExample(page, 'ram-by-hand', 'RAM by Hand', ramByHand);
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await clickAt(page, at.center('U1'));
  await expectData(page, 'XXXXXXXX'); // never written

  await clickAt(page, at.center('SW3')); // PROGRAM: the DATA switches drive the bus
  await clickAt(page, at.lever('SW2', 'S1'));
  await clickAt(page, at.lever('SW2', 'S3'));
  await clickAt(page, at.lever('SW1', 'S2')); // address 2
  await page.mouse.move(...at.center('SW4'));
  await page.mouse.down(); // WRITE
  await page.waitForTimeout(100);
  await page.mouse.up();
  await clickAt(page, at.center('SW3')); // read: the RAM drives the bus
  await clickAt(page, at.center('U1'));
  await expect(summary(page)).toHaveText('U1 · 6116');
  await expectData(page, '00000101');

  await page.getByRole('tab', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems while running');
  expect(errors).toEqual([]);
});

const memoryTab = (page: Page) => page.getByTestId('memory-panel');
const cell = (page: Page, address: number) =>
  memoryTab(page).locator(`.memory-cell[data-address="${address}"]`);

/** Bytes of a file in the private file system. */
async function readBytes(page: Page, name: string): Promise<number[]> {
  return page.evaluate(async (n) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(n)).getFile();
    return [...new Uint8Array(await file.arrayBuffer())];
  }, name);
}

test('Memory tab: an EEPROM byte edited while running changes the digit; Undo restores it', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const at = await openExample(
    page,
    'eeprom-7-segment',
    'EEPROM 7-Segment Decoder',
    eeprom7Segment,
  );
  await page.getByRole('tab', { name: 'Memory' }).click();
  await expect(memoryTab(page).getByLabel('Memory')).toHaveValue('U1');
  await expect(cell(page, 0)).toHaveText('3F'); // 0: segments a–f
  await expect(cell(page, 0x10)).toHaveText('FF');

  await page.keyboard.press('F5');
  await expect(page.getByTestId('memory-address')).toHaveText('Address 0x000');
  await expect(cell(page, 0)).toHaveClass(/current/);
  await cell(page, 0).click();
  await page.keyboard.type('06'); // 1: segments b, c
  await expect(cell(page, 0)).toHaveText('06');
  await clickAt(page, at.center('U1'));
  await expectData(page, '00000110');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(cell(page, 0)).toHaveText('3F');
  await clickAt(page, at.center('U1')); // Undo brought back the selection before the edit
  await expectData(page, '00111111');
  await clickAt(page, at.lever('SW1', 'S1')); // address 1: read lit, followed
  await expect(page.getByTestId('memory-address')).toHaveText('Address 0x001');
  await expect(cell(page, 1)).toHaveAttribute('style', /--level-1/);
  expect(errors).toEqual([]);
});

test('Memory tab: Intel HEX and binary files load into an EEPROM', async ({ page }) => {
  await page.addInitScript(stubFileSystemAccess);
  const errors = watchErrors(page);
  await openExample(page, 'eeprom-7-segment', 'EEPROM 7-Segment Decoder', eeprom7Segment);
  // Four bytes assembled for 0x8000, as for a ROM decoded at the top of a 6502's memory.
  await writeFile(page, 'prog.hex', ':048000000102030472\n:00000001FF\n');
  await writeFile(page, 'ab.bin', 'AB');
  await page.getByRole('tab', { name: 'Memory' }).click();

  await pick(page, 'open', 'prog.hex');
  await memoryTab(page).getByRole('button', { name: /Load/ }).click();
  const dialog = page.getByTestId('load-image-dialog');
  await expect(dialog.getByTestId('image-summary')).toHaveText(
    '0x8000–0x8003 · 4 bytes · sum 0x000A',
  );
  await expect(dialog.getByLabel('Load at')).toHaveValue('0x0000');
  await dialog.getByRole('button', { name: 'Program' }).click();
  await expect(cell(page, 0)).toHaveText('01');
  await expect(cell(page, 3)).toHaveText('04');
  await expect(cell(page, 5)).toHaveText('FF'); // erased first

  await pick(page, 'open', 'ab.bin');
  await memoryTab(page).getByRole('button', { name: /Load/ }).click();
  await dialog.getByLabel('Load at').fill('7FF');
  await expect(dialog).toContainText('past the last address 0x07FF by 1');
  await dialog.getByLabel('Load at').fill('10');
  await dialog.getByLabel(/Fill the rest/).uncheck();
  await dialog.getByRole('button', { name: 'Program' }).click();
  await expect(cell(page, 0x10)).toHaveText('41');
  await expect(cell(page, 0x11)).toHaveText('42');
  await expect(cell(page, 0)).toHaveText('01'); // kept

  await memoryTab(page).getByRole('button', { name: /Erase/ }).click();
  await expect(cell(page, 0)).toHaveText('FF');
  expect(errors).toEqual([]);
});

test('Memory tab: RAM by Hand — a write lights up, a poke reads back, Save writes the cells', async ({
  page,
}) => {
  await page.addInitScript(stubFileSystemAccess);
  const errors = watchErrors(page);
  const at = await openExample(page, 'ram-by-hand', 'RAM by Hand', ramByHand);
  await page.getByRole('tab', { name: 'Memory' }).click();
  await expect(memoryTab(page).getByTestId('memory-none')).toContainText(
    'A RAM holds data only while simulating',
  );
  await page.keyboard.press('F5');
  await expect(cell(page, 2)).toHaveText('XX');

  await clickAt(page, at.center('SW3')); // PROGRAM
  await clickAt(page, at.lever('SW2', 'S1'));
  await clickAt(page, at.lever('SW2', 'S3'));
  await clickAt(page, at.lever('SW1', 'S2')); // address 2
  await expect(page.getByTestId('memory-address')).toHaveText('Address 0x002');
  await page.mouse.move(...at.center('SW4'));
  await page.mouse.down(); // WRITE
  await page.waitForTimeout(100);
  await page.mouse.up();
  await expect(cell(page, 2)).toHaveText('05');
  await expect(cell(page, 2)).toHaveAttribute('style', /--warning/);
  await clickAt(page, at.center('SW3')); // read

  await cell(page, 3).click();
  await page.keyboard.type('a5'); // a debug write
  await expect(cell(page, 3)).toHaveText('A5');
  await clickAt(page, at.lever('SW1', 'S1')); // address 3
  await clickAt(page, at.center('U1'));
  await expect(summary(page)).toHaveText('U1 · 6116');
  await expectData(page, '10100101');

  await pick(page, 'save', 'ram.bin');
  await memoryTab(page).getByRole('button', { name: /Save/ }).click();
  const dialog = page.getByTestId('save-image-dialog');
  await expect(dialog).toContainText('2046 of 2048 bytes have unknown (X) bits');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(dialog).toBeHidden();
  const bytes = await readBytes(page, 'ram.bin');
  expect(bytes).toHaveLength(2048);
  expect(bytes.slice(0, 5)).toEqual([0, 0, 5, 0xa5, 0]);
  expect(errors).toEqual([]);
});

test('Memory tab: a 62256 shows only the rows in view', async ({ page }) => {
  const grid = await newCircuit(page);
  await place(page, grid, 'mem/62256', [0, 0]);
  await page.getByRole('tab', { name: 'Memory' }).click();
  await page.keyboard.press('F5');
  await expect(memoryTab(page).getByLabel('Memory')).toHaveValue('U1');
  const view = memoryTab(page).getByRole('application');
  await expect(cell(page, 0)).toHaveText('XX');
  const rows = await view.locator('.memory-row').count();
  expect(rows).toBeGreaterThan(2);
  expect(rows).toBeLessThan(40);
  await view.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(cell(page, 0x7fff)).toHaveText('XX');
  await expect(memoryTab(page).getByRole('checkbox', { name: 'Follow' })).not.toBeChecked();
  expect(await view.locator('.memory-row').count()).toBeLessThan(40);
});

test('Memory tab: follows the memory picked on the canvas; Inspect Memory opens it', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  await place(page, grid, 'mem/6116', [-20, 0]);
  await place(page, grid, 'mem/at28c16', [20, 0]);
  await page.getByRole('tab', { name: 'Messages' }).click();
  await clickAt(page, grid([20, 0]));
  await expect(summary(page)).toHaveText('U2 · AT28C16');
  await menu(page, 'Edit', 'Inspect Memory');
  await expect(memoryTab(page).getByLabel('Memory')).toHaveValue('U2');
  await expect(cell(page, 0)).toHaveText('FF'); // erased
  await clickAt(page, grid([-20, 0]));
  await expect(memoryTab(page).getByLabel('Memory')).toHaveValue('U1');
  await expect(memoryTab(page).getByTestId('memory-none')).toBeVisible(); // a stopped RAM
  await memoryTab(page).getByLabel('Memory').selectOption('U2');
  await expect(cell(page, 0)).toHaveText('FF');
  expect(errors).toEqual([]);
});
