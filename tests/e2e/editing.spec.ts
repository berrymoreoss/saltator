import { expect, type Page, test } from '@playwright/test';
import { type Point, partLayout } from '../../src/circuit';
import { resolveProps } from '../../src/core';
import { layoutBounds } from '../../src/editor';
import { createDefaultRegistry } from '../../src/library';

// Editing in the browser. Every test starts from File ▸ New, which centers grid point (0, 0) on
// the canvas at 100 % (16 px per cell), so grid points map to known pixels. Pin positions come
// from the same layouts the app uses: a part placed by a click is centered on it.

const registry = createDefaultRegistry();

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const canvas = (page: Page) => page.getByTestId('schematic');
const summary = (page: Page) => page.getByTestId('selection-summary');
const properties = (page: Page) => page.getByTestId('properties-panel');

async function menu(page: Page, title: string, item: string | RegExp): Promise<void> {
  await page.getByRole('menuitem', { name: title, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).first().click();
}

/** File ▸ New; returns grid → page pixel. */
async function newCircuit(page: Page): Promise<(p: Point) => Point> {
  await page.goto('/');
  await menu(page, 'File', 'New Circuit');
  await expect(page.getByTestId('zoom')).toHaveText('100 %');
  const box = (await canvas(page).boundingBox())!;
  return ([x, y]) => [box.x + box.width / 2 + x * 16, box.y + box.height / 2 + y * 16];
}

/** Where a pin of a part placed by a click at `at` (rotation 0) ends up. */
function pinOf(type: string, at: Point, pin: string): Point {
  const definition = registry.get(type)!;
  const layout = partLayout(definition, resolveProps(definition, {}));
  const b = layoutBounds(layout);
  const origin: Point = [
    at[0] - Math.round(b.x + b.width / 2),
    at[1] - Math.round(b.y + b.height / 2),
  ];
  const local = layout.pins.find((p) => p.name === pin)!.at;
  return [origin[0] + local[0], origin[1] + local[1]];
}

async function clickAt(page: Page, p: Point, options: { button?: 'right' } = {}): Promise<void> {
  await page.mouse.click(p[0], p[1], options);
}

async function place(page: Page, grid: (p: Point) => Point, type: string, at: Point) {
  await page.locator(`[data-type="${type}"]`).click();
  await clickAt(page, grid(at));
  await page.keyboard.press('Escape');
}

/** Wire tool: click each grid point; the last one is a pin, which finishes the wire. */
async function wire(page: Page, grid: (p: Point) => Point, ...points: Point[]) {
  await page.keyboard.press('w');
  for (const p of points) {
    await page.mouse.move(...grid(p));
    await clickAt(page, grid(p));
  }
  await page.keyboard.press('Escape');
}

/** The net a part's pin is on, as the Properties panel shows it ("open" if none). */
async function netOf(page: Page, grid: (p: Point) => Point, at: Point, pin: string) {
  await clickAt(page, grid(at));
  return properties(page)
    .locator('.prop-row', { hasText: new RegExp(`^${pin}`) })
    .textContent();
}

test('Hello, LED drawn by hand: place, wire, label, color — no design issues', async ({ page }) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  await place(page, grid, 'io/switch', [-12, 0]);
  await place(page, grid, 'prim/nand', [0, 1]);
  await place(page, grid, 'io/vcc', [-6, -6]);
  await place(page, grid, 'io/led', [12, 1]);
  await place(page, grid, 'io/gnd', [18, 4]);
  await expect(page.getByTestId('status-hint')).toContainText('Click to select');

  await wire(page, grid, pinOf('io/switch', [-12, 0], 'Y'), pinOf('prim/nand', [0, 1], 'A'));
  await wire(page, grid, pinOf('io/vcc', [-6, -6], 'Y'), pinOf('prim/nand', [0, 1], 'B'));
  await wire(page, grid, pinOf('prim/nand', [0, 1], 'Y'), pinOf('io/led', [12, 1], 'A'));
  await wire(page, grid, pinOf('io/led', [12, 1], 'K'), pinOf('io/gnd', [18, 4], 'Y'));
  // Each L-shaped route is two wire segments.
  await expect(page.getByTestId('statusbar')).toContainText('5 parts · 6 wires');
  await expect(page.getByTestId('issue-counts')).toHaveText(/0\s*0/);

  // Label and color in the Properties panel.
  await clickAt(page, grid([12, 1]));
  await expect(summary(page)).toHaveText('D1 · LED');
  await page.getByTestId('prop-label').fill('OUT');
  await page.keyboard.press('Enter');
  await page.getByTestId('prop-color').selectOption('green');
  await expect(properties(page)).toContainText('U1.Y');
  await expect(page.getByTestId('prop-label')).toHaveValue('OUT');
  await expect(page.getByTestId('prop-color')).toHaveValue('green');
  expect(errors).toEqual([]);
});

test('a part dragged from the Parts panel lands where it is dropped', async ({ page }) => {
  const grid = await newCircuit(page);
  const [x, y] = grid([4, 2]);
  await page.locator('[data-type="prim/nand"]').dragTo(canvas(page), {
    targetPosition: {
      x: x - (await canvas(page).boundingBox())!.x,
      y: y - (await canvas(page).boundingBox())!.y,
    },
  });
  await expect(summary(page)).toHaveText('U1 · NAND');
  await expect(page.getByTestId('prop-x')).toHaveValue('1');
  await expect(page.getByTestId('prop-y')).toHaveValue('0');
});

test('moving a part keeps its wire; undo and redo', async ({ page }) => {
  const grid = await newCircuit(page);
  await place(page, grid, 'prim/nand', [0, 1]);
  await place(page, grid, 'io/led', [12, 1]);
  await wire(page, grid, pinOf('prim/nand', [0, 1], 'Y'), pinOf('io/led', [12, 1], 'A'));
  expect(await netOf(page, grid, [12, 1], 'A')).toContain('U1.Y');

  // Drag the LED down four cells.
  const [x, y] = grid([12, 1]);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 32, { steps: 4 });
  await page.mouse.move(x, y + 64, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('prop-y')).toHaveValue('4');
  expect(await netOf(page, grid, [12, 5], 'A')).toContain('U1.Y');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('prop-y')).toHaveValue('0');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByTestId('prop-y')).toHaveValue('4');
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Undo Move' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('rotate, flip and delete from the keyboard and the toolbar', async ({ page }) => {
  const grid = await newCircuit(page);
  await place(page, grid, 'prim/nand', [0, 0]);
  await clickAt(page, grid([0, 0]));
  await page.keyboard.press('r');
  await expect(page.getByTestId('prop-rotation')).toHaveValue('90');
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await expect(page.getByTestId('prop-rotation')).toHaveValue('180');
  await page.keyboard.press('Shift+r');
  await expect(page.getByTestId('prop-rotation')).toHaveValue('90');
  await page.keyboard.press('f');
  await expect(page.getByTestId('prop-flip')).toBeChecked();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('statusbar')).toContainText('0 parts');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('statusbar')).toContainText('1 parts');
});

test('copy and paste float until dropped; duplicate; paste in another tab', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const grid = await newCircuit(page);
  await place(page, grid, 'prim/nand', [0, 0]);
  await clickAt(page, grid([0, 0]));

  await menu(page, 'Edit', 'Copy');
  await menu(page, 'Edit', 'Paste');
  await expect(page.getByTestId('status-hint')).toContainText('Click to drop');
  await clickAt(page, grid([0, 8]));
  await expect(summary(page)).toHaveText('U2 · NAND');
  await expect(page.getByTestId('prop-y')).toHaveValue('6');

  await page.keyboard.press('ControlOrMeta+d');
  await clickAt(page, grid([10, 8]));
  await expect(summary(page)).toHaveText('U3 · NAND');
  await expect(page.getByTestId('statusbar')).toContainText('3 parts');

  // The clipboard holds document text: another tab pastes it.
  const other = await context.newPage();
  const otherGrid = await newCircuit(other);
  await menu(other, 'Edit', 'Paste');
  await expect(other.getByTestId('status-hint')).toContainText('Click to drop');
  await clickAt(other, otherGrid([0, 0]));
  await expect(summary(other)).toHaveText('U1 · NAND');
});

test('Properties: rename, a taken designator is refused, edit a prop, undo it', async ({
  page,
}) => {
  const grid = await newCircuit(page);
  await place(page, grid, 'prim/nand', [0, 0]);
  await place(page, grid, 'prim/nand', [0, 8]);
  await page.mouse.dblclick(...grid([0, 0]));
  const designator = page.getByTestId('prop-designator');
  await expect(designator).toBeFocused();
  await designator.fill('U2');
  await expect(properties(page)).toContainText('"U2" is already used.');
  await designator.fill('GATE');
  await page.keyboard.press('Enter');
  await expect(summary(page)).toHaveText('GATE · NAND');

  const inputs = page.getByTestId('prop-inputs');
  await inputs.fill('9');
  await expect(properties(page)).toContainText('Enter a number between 2 and 8.');
  await inputs.fill('3');
  await page.keyboard.press('Enter');
  await expect(inputs).toHaveValue('3');
  await page.getByTestId('prop-delay').fill('2.5ns');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('prop-delay')).toHaveValue('2.5 ns');
  await canvas(page).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('prop-delay')).toHaveValue('1 ns');
});

test('the context menu edits the item under the pointer', async ({ page }) => {
  const grid = await newCircuit(page);
  await place(page, grid, 'prim/nand', [0, 0]);
  await page.keyboard.press('Escape'); // nothing selected
  await clickAt(page, grid([0, 0]), { button: 'right' });
  const contextMenu = page.getByTestId('context-menu');
  await expect(contextMenu).toBeVisible();
  await expect(summary(page)).toHaveText('U1 · NAND');
  // A row's accessible name ends with its shortcut ("Rotate R").
  await contextMenu
    .getByRole('menuitem', { name: /^Rotate/ })
    .first()
    .click();
  await expect(contextMenu).toHaveCount(0);
  await expect(page.getByTestId('prop-rotation')).toHaveValue('90');

  await clickAt(page, grid([20, 10]), { button: 'right' });
  await expect(contextMenu.getByRole('menuitem', { name: 'Select All' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(contextMenu).toHaveCount(0);
});

test('Mod+C and Mod+V copy and paste through the clipboard events', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const grid = await newCircuit(page);
  await place(page, grid, 'io/led', [0, 0]);
  await clickAt(page, grid([0, 0]));
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.getByTestId('status-hint')).toContainText('Click to drop');
  await clickAt(page, grid([0, 6]));
  await expect(summary(page)).toHaveText('D2 · LED');
  await page.keyboard.press('ControlOrMeta+x');
  await expect(page.getByTestId('statusbar')).toContainText('1 parts');
});
