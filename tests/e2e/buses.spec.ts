import { expect, type Page, test } from '@playwright/test';
import dataBus from '../../examples/data-bus.saltator.json' with { type: 'json' };
import { loadDocument, type Point } from '../../src/circuit';
import { buildScene, fitRect } from '../../src/editor';
import { createDefaultRegistry } from '../../src/library';
import {
  canvas,
  clickAt,
  menu,
  newCircuit,
  pinOf,
  place,
  properties,
  summary,
  watchErrors,
} from './support';

// R10b in the browser: bus entries placed with Z on two switches, a bus line drawn from the
// Place menu through their bus ends, a bus label named D[0..1]; running, the bus's value follows
// the switches in Properties. The Data Bus example opens clean and runs; LOAD latches the bus
// value from one chip into the other.

const registry = createDefaultRegistry();

const SW1: Point = [-14, 0];
const SW2: Point = [-14, 4];

test('entries, a bus line and a bus label make a bus whose value follows the switches', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  await place(page, grid, 'io/switch', SW1);
  await place(page, grid, 'io/switch', SW2);
  const y1 = pinOf('io/switch', SW1, 'Y');
  const y2 = pinOf('io/switch', SW2, 'Y');

  // Z arms the bus entry tool: each placed by its bit end, named D0, then D1.
  await canvasFocus(page, grid);
  await page.keyboard.press('z');
  for (const at of [y1, y2]) {
    await page.mouse.move(...grid(at));
    await clickAt(page, grid(at));
  }
  await page.keyboard.press('Escape');
  await expect(summary(page)).toHaveText('BE2 · BUS ENTRY');
  await expect(properties(page).getByTestId('prop-name')).toHaveValue('D1');

  // Place ▸ Bus: a click on BE1's bus end starts the line, a click on BE2's finishes it.
  const b1: Point = [y1[0] + 3, y1[1] + 1];
  const b2: Point = [y2[0] + 3, y2[1] + 1];
  await placeBus(page);
  await expect(page.getByTestId('statusbar')).toContainText('Click to start a bus line');
  for (const at of [b1, b2]) {
    await page.mouse.move(...grid(at));
    await clickAt(page, grid(at));
  }
  await page.keyboard.press('Escape');

  // A label on the bus line, renamed like a bus: it names the bus.
  const middle: Point = [b1[0], b1[1] + 2];
  await canvasFocus(page, grid);
  await page.keyboard.press('l');
  await page.mouse.move(...grid(middle));
  await clickAt(page, grid(middle));
  await page.keyboard.press('Escape');
  const name = properties(page).getByTestId('prop-name');
  await name.fill('D[0..1]');
  await name.press('Enter');
  await expect(properties(page)).toContainText('Members2');

  // A click on the bus line shows it; running, its value follows the switches.
  await clickAt(page, grid([b1[0], b1[1] + 1]));
  await expect(summary(page)).toHaveText(/^Bus line w\d+ · bus D\[0\.\.1\]$/);
  await page.keyboard.press('F5');
  const value = properties(page).getByTestId('bus-value');
  await expect(value).toHaveText('0x0');
  await clickAt(page, grid(SW2)); // the Interact tool flips SW2: D1 = 1
  await expect(value).toHaveText('0x2');
  await clickAt(page, grid(SW1));
  await expect(value).toHaveText('0x3');
  await expect(properties(page)).toContainText('11 = 3');
  expect(errors).toEqual([]);
});

test('a wire does not connect to a bus line', async ({ page }) => {
  const grid = await newCircuit(page);
  await canvasFocus(page, grid);
  await page.keyboard.press('b'); // the Bus tool
  await expect(page.getByTestId('statusbar')).toContainText('Click to start a bus line');
  for (const at of [[0, 0] as Point, [0, 8] as Point, [0, 8] as Point]) {
    await page.mouse.move(...grid(at));
    await clickAt(page, grid(at));
  }
  await page.keyboard.press('w');
  for (const at of [[-6, 4] as Point, [0, 4] as Point]) {
    await page.mouse.move(...grid(at));
    await clickAt(page, grid(at));
  }
  // The bus line didn't finish the wire: it is still being drawn.
  await expect(page.getByTestId('statusbar')).toContainText('Click to add a corner');
});

test('the Data Bus example runs cleanly; LOAD latches 0x2A from the bus into the 74HC574', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await newCircuit(page);
  await menu(page, 'File', 'New from Example…');
  await page.getByTestId('example-gallery').locator('[data-example="data-bus"]').click();
  await expect(page).toHaveTitle('Data Bus — Saltator');
  await expect(page.getByTestId('bottom-panel')).toContainText('No problems found');

  // The example opens fitted to the canvas: where its parts are on screen.
  const scene = buildScene(loadDocument(dataBus).circuits[0]!, registry);
  const box = (await canvas(page).boundingBox())!;
  const camera = fitRect(scene.bounds!, { width: box.width, height: box.height });
  const centerOf = (id: string): Point => {
    const { x, y, width, height } = scene.partById.get(id)!.body;
    return [
      box.x + (x + width / 2 - camera.x) * camera.scale,
      box.y + (y + height / 2 - camera.y) * camera.scale,
    ];
  };

  await page.keyboard.press('F5');
  await expect(page.getByTestId('sim-status')).toHaveText(/Running · /);
  // Hold LOAD for a moment: the 574 takes the bus on the rising edge.
  await page.mouse.move(...centerOf('SW2'));
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  await clickAt(page, centerOf('U2')); // a click on a chip selects it
  await expect(summary(page)).toHaveText('U2 · 74HC574');
  // 0x2A = 0010 1010: Q1, Q3, Q5 high.
  const q = (i: number) =>
    properties(page)
      .locator('.prop-row')
      .filter({ has: page.locator('.prop-label', { hasText: new RegExp(` Q${i}$`) }) })
      .getByTestId('live-level');
  for (let i = 0; i < 8; i++) await expect(q(i)).toHaveText(i % 2 === 1 && i < 6 ? '1' : '0');

  await page.getByRole('tab', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-diagnostics')).toContainText('No problems while running');
  expect(errors).toEqual([]);
});

/** Place ▸ Bus: the Bus tool (a checkable item, as the tools are). */
async function placeBus(page: Page) {
  await page.getByRole('menuitem', { name: 'Place', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /^Bus\b/ }).click();
}

/** Gives the canvas the keyboard (a click on empty canvas, which also clears the selection). */
async function canvasFocus(page: Page, grid: (p: Point) => Point) {
  await clickAt(page, grid([0, 14]));
}
