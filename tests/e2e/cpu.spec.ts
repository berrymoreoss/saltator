import { expect, type Page, test } from '@playwright/test';
import nopSled from '../../examples/6502-nop-sled.logic.json' with { type: 'json' };
import romRam from '../../examples/6502-rom-ram.logic.json' with { type: 'json' };
import { openExample, watchErrors } from './support';

// R17a in the browser: the W65C02S examples open from the gallery and their benches — the CPU
// reading its reset vector and counting through NOPs, a program from ROM counting in RAM — pass
// in the Tests tab.

const results = (page: Page) => page.getByTestId('test-results');
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
