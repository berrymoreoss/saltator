import { expect, type Page, test } from '@playwright/test';
import nopSled from '../../examples/6502-nop-sled.saltator.json' with { type: 'json' };
import romRam from '../../examples/6502-rom-ram.saltator.json' with { type: 'json' };
import { clickAt, openExample, properties, summary, watchErrors } from './support';

// R17a in the browser: the W65C02S examples open from the gallery and their benches — the CPU
// reading its reset vector and counting through NOPs, a program from ROM counting in RAM — pass
// in the Tests tab; the NOP Sled runs in the app, unknown until RESET is pressed.

const results = (page: Page) => page.getByTestId('test-results');
/** The live level of the selected chip's pin in Properties (labels are `25 A15`). */
const level = (page: Page, pin: string) =>
  properties(page)
    .locator('.prop-row')
    .filter({ has: page.locator('.prop-label', { hasText: new RegExp(` ${pin}$`) }) })
    .getByTestId('live-level');
const benches = (page: Page) => results(page).getByTestId('bench-row');

async function runTests(page: Page) {
  await page.getByRole('tab', { name: /^Tests/ }).click();
  const code = page.getByTestId('tests-panel').locator('.cm-content');
  await expect(code).toBeVisible();
  await code.click();
  await page.keyboard.press('ControlOrMeta+Enter');
}

test('6502 NOP Sled: the CPU reads $EAEA after RESET and counts up (its bench)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openExample(page, '6502-nop-sled', '6502 NOP Sled', nopSled);
  await runTests(page);
  await expect(benches(page).and(page.locator('[data-state="pass"]'))).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('6502 ROM and RAM: a program from the EEPROM counts in the RAM (its bench)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openExample(page, '6502-rom-ram', '6502 ROM and RAM', romRam);
  await runTests(page);
  await expect(benches(page).and(page.locator('[data-state="pass"]'))).toHaveCount(1);
  await expect(results(page)).toContainText('counts in RAM after RESET');
  expect(errors).toEqual([]);
});

test('6502 NOP Sled runs in the app: unknown until RESET, then fetching at $EAxx', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const at = await openExample(page, '6502-nop-sled', '6502 NOP Sled', nopSled);
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await clickAt(page, at.center('U1'));
  await expect(summary(page)).toHaveText('U1 · W65C02S');
  await expect(level(page, 'A15')).toHaveText('X'); // no reset yet: nobody knows
  // RESET held over a few cycles of the 10 Hz clock, as a hand would.
  await page.mouse.move(...at.center('SW1'));
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(level(page, 'A15')).toHaveText('1', { timeout: 5000 }); // $EAEA and on
  await expect(level(page, 'A14')).toHaveText('1');
  await page.getByRole('tab', { name: /^Part/ }).click();
  await expect(page.getByTestId('bottom-panel')).toContainText('tADS');
  await expect(page.getByTestId('bottom-panel')).toContainText('Table 6-3');
  await expect(page.getByTestId('bottom-panel')).toContainText('vector pull');
  await page.getByRole('tab', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems while running');
  expect(errors).toEqual([]);
});
