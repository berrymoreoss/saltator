import { expect, type Page, test } from '@playwright/test';
import tftColorBars from '../../examples/tft-color-bars.logic.json' with { type: 'json' };
import type { Point } from '../../src/circuit';
import { canvas, openExample, watchErrors } from './support';

// The ST7789 module in the browser: TFT Color Bars draws the SMPTE bars after RESET. The glass
// is canvas pixels: the test counts saturated ones (the 75 % bars) in the top band of the
// picture, which is drawn first.

/** Saturated pixels (a channel spread over 100) in the band from `top` to `top + height` of DS1's glass. */
async function colorful(page: Page, center: Point, size: number, top: number, height: number) {
  const box = (await canvas(page).boundingBox())!;
  const rect = {
    x: center[0] - size / 2 - box.x,
    y: center[1] + top - box.y,
    width: size,
    height,
  };
  return canvas(page).evaluate((element, r) => {
    const c = element as HTMLCanvasElement;
    const scale = c.width / c.getBoundingClientRect().width;
    const data = c
      .getContext('2d')!
      .getImageData(r.x * scale, r.y * scale, r.width * scale, r.height * scale).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
      const min = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
      if (max - min > 100) n++;
    }
    return n;
  }, rect);
}

async function press(page: Page, where: Point) {
  await page.mouse.move(...where);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(100);
}

test('TFT Color Bars: the bars appear after RESET', async ({ page }) => {
  const errors = watchErrors(page);
  const at = await openExample(page, 'tft-color-bars', 'TFT Color Bars', tftColorBars);
  // The module is turned: its glass is 20 cells wide (320 pixels), 15 tall, around its middle.
  const center = at.center('DS1');
  const cell = (at.pin('DS1', 'GND')[1] - at.pin('DS1', 'BLK')[1]) / 7;
  const top = -7.5 * cell + 0.5 * cell;
  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  await page.waitForTimeout(300);
  expect(await colorful(page, center, 18 * cell, top, 2 * cell)).toBe(0); // asleep since power-on
  await press(page, at.center('SW1'));
  await expect
    .poll(() => colorful(page, center, 18 * cell, top, 2 * cell), { timeout: 20_000 })
    .toBeGreaterThan(50);
  await page.getByRole('tab', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems while running');
  expect(errors).toEqual([]);
});
