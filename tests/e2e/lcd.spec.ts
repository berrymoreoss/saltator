import { expect, type Page, test } from '@playwright/test';
import lcdByHand from '../../examples/lcd-by-hand.saltator.json' with { type: 'json' };
import lcdHelloWorld from '../../examples/lcd-hello-world.saltator.json' with { type: 'json' };
import type { Point } from '../../src/circuit';
import { canvas, clickAt, openExample, properties, summary, watchErrors } from './support';

// The HD44780 module in the browser: LCD Hello, World prints after RESET, LCD by Hand shows its
// cursor once the display is turned on from the switches. The glass is canvas pixels: the test
// counts the dark ones inside the yellow-green glass (lit glass and unlit dots are bright; a lit
// dot is dark, blended with the glass where the zoom makes it about a pixel).

/**
 * Dark pixels inside DS1's glass: from between VDD and V0 to DB7 (the first 13 columns of a
 * 16 × 2) and from 6 to 3 cells above the pin tips (its two lines), clear of the bezel.
 */
async function litPixels(page: Page, at: { pin(id: string, pin: string): Point }) {
  const vdd = at.pin('DS1', 'VDD');
  const db7 = at.pin('DS1', 'DB7');
  const cell = (db7[0] - vdd[0]) / 12;
  const box = (await canvas(page).boundingBox())!;
  const rect = {
    x: vdd[0] + 0.5 * cell - box.x,
    y: vdd[1] - 6 * cell - box.y,
    width: 11.5 * cell,
    height: 3 * cell,
  };
  return canvas(page).evaluate((element, r) => {
    const c = element as HTMLCanvasElement;
    const scale = c.width / c.getBoundingClientRect().width;
    const data = c
      .getContext('2d')!
      .getImageData(r.x * scale, r.y * scale, r.width * scale, r.height * scale).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      if (luminance < 140) n++;
    }
    return n;
  }, rect);
}

/**
 * Presses and releases a button like a hand, and lets a moment pass: two actions in one frame
 * happen at one simulated instant (data changing as E falls is a real setup violation).
 */
async function press(page: Page, where: Point) {
  await page.mouse.move(...where);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(100);
}

test('LCD Hello, World: the text appears after RESET', async ({ page }) => {
  const errors = watchErrors(page);
  const at = await openExample(page, 'lcd-hello-world', 'LCD Hello, World', lcdHelloWorld);
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await page.waitForTimeout(300);
  expect(await litPixels(page, at)).toBe(0); // display off since power-on
  await press(page, at.center('SW1'));
  // Fitted to the window a dot is about a pixel: two lines of text are well over a hundred.
  await expect.poll(() => litPixels(page, at), { timeout: 5000 }).toBeGreaterThan(100);

  await page.getByRole('tab', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems while running');
  expect(errors).toEqual([]);
});

test('LCD by Hand: function set, then display on: the cursor shows', async ({ page }) => {
  const errors = watchErrors(page);
  const at = await openExample(page, 'lcd-by-hand', 'LCD by Hand', lcdByHand);
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await press(page, at.center('SW3')); // DATA = 0x38: function set
  // 0x38 → 0x0E (display on, cursor on): flip S2, S3, S5, S6.
  // The switch bank is turned: its pins point up, a lever is under its pin.
  for (const s of ['S2', 'S3', 'S5', 'S6']) {
    await clickAt(page, [at.pin('SW1', s)[0], at.center('SW1')[1]]);
  }
  await page.waitForTimeout(100);
  expect(await litPixels(page, at)).toBe(0);
  await press(page, at.center('SW3'));
  // The cursor: one row of five dots.
  await expect.poll(() => litPixels(page, at)).toBeGreaterThan(0);

  await page.getByRole('tab', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems while running');
  expect(errors).toEqual([]);
});

test('LCD: a new size and backlight in Properties redraw it, its wires still on the pins', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const at = await openExample(page, 'lcd-by-hand', 'LCD by Hand', lcdByHand);
  await clickAt(page, at.center('DS1'));
  await expect(summary(page)).toHaveText('DS1 · HD44780');
  await properties(page).getByLabel('Size').selectOption('20x4');
  await properties(page).getByLabel('Backlight').selectOption('blue');
  // The pins stay where they were: the DATA wires and the labels still meet them.
  await expect(page.getByTestId('bottom-panel')).toContainText('No problems found');
  // The glass (unlit while stopped) is blue now.
  const vdd = at.pin('DS1', 'VDD');
  const cell = (at.pin('DS1', 'DB7')[0] - vdd[0]) / 12;
  const box = (await canvas(page).boundingBox())!;
  const blue = await canvas(page).evaluate(
    (element, r) => {
      const c = element as HTMLCanvasElement;
      const scale = c.width / c.getBoundingClientRect().width;
      const data = c
        .getContext('2d')!
        .getImageData(r.x * scale, r.y * scale, r.width * scale, r.height * scale).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 2]! - data[i]! > 40 && data[i + 2]! - data[i + 1]! > 25) n++;
      }
      return n / (data.length / 4);
    },
    { x: vdd[0] + cell - box.x, y: vdd[1] - 6 * cell - box.y, width: 10 * cell, height: 3 * cell },
  );
  expect(blue).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});
