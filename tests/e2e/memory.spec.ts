import { expect, type Page, test } from '@playwright/test';
import eeprom7Segment from '../../examples/eeprom-7-segment.logic.json' with { type: 'json' };
import ramByHand from '../../examples/ram-by-hand.logic.json' with { type: 'json' };
import { loadDocument, type Point } from '../../src/circuit';
import { buildScene, fitRect } from '../../src/editor';
import { createDefaultRegistry } from '../../src/library';
import { canvas, clickAt, menu, newCircuit, properties, summary, watchErrors } from './support';

// R12a in the browser: the EEPROM 7-Segment Decoder shows the digit its ADDRESS switches pick,
// and RAM by Hand stores a byte from its DATA switches and reads it back.

const registry = createDefaultRegistry();

/** Opens an example from the gallery; returns where its parts are on screen (it opens fitted). */
async function openExample(page: Page, id: string, title: string, document: unknown) {
  await newCircuit(page);
  await menu(page, 'File', 'New from Example…');
  await page.getByTestId('example-gallery').locator(`[data-example="${id}"]`).click();
  await expect(page).toHaveTitle(`${title} — Logic`);
  await expect(page.getByTestId('bottom-panel')).toContainText('No problems found');
  const scene = buildScene(loadDocument(document).circuits[0]!, registry);
  const box = (await canvas(page).boundingBox())!;
  const camera = fitRect(scene.bounds!, { width: box.width, height: box.height });
  const screen = ([x, y]: Point): Point => [
    box.x + (x - camera.x) * camera.scale,
    box.y + (y - camera.y) * camera.scale,
  ];
  return {
    /** The middle of a part's body. */
    center(id: string): Point {
      const { x, y, width, height } = scene.partById.get(id)!.body;
      return screen([x + width / 2, y + height / 2]);
    },
    /** A DIP switch's lever: the body's middle on the row of its pin. */
    lever(id: string, pin: string): Point {
      const part = scene.partById.get(id)!;
      const at = part.pins.find((p) => p.name === pin)!.at;
      return screen([part.body.x + part.body.width / 2, at[1]]);
    },
  };
}

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
