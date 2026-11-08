/**
 * Helpers shared by the browser tests: File ▸ New centers grid point (0, 0) on the canvas at
 * 100 % (16 px per cell), so grid points map to known pixels; pin positions come from the same
 * layouts the app uses (a part placed by a click is centered on it).
 */
import { expect, type Page } from '@playwright/test';
import { loadDocument, type Point, partLayout } from '../../src/circuit';
import { resolveProps } from '../../src/core';
import { buildScene, fitRect, layoutBounds } from '../../src/editor';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry();

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export const canvas = (page: Page) => page.getByTestId('schematic');
export const summary = (page: Page) => page.getByTestId('selection-summary');
export const properties = (page: Page) => page.getByTestId('properties-panel');

export async function menu(page: Page, title: string, item: string | RegExp): Promise<void> {
  await page.getByRole('menuitem', { name: title, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).first().click();
}

/**
 * Loads the app and waits until it is ready: start-up restores the autosaved session before
 * anything renders or listens to keys.
 */
export async function openApp(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(canvas(page)).toBeVisible();
}

/** File ▸ New; returns grid → page pixel. */
export async function newCircuit(page: Page): Promise<(p: Point) => Point> {
  await openApp(page);
  // A second tab starts from the latest autosaved session, which may have unsaved changes.
  const unsaved = (await page.getByTestId('document-name').textContent())?.startsWith('•');
  await menu(page, 'File', 'New Document');
  if (unsaved) {
    await page.getByTestId('unsaved-dialog').getByRole('button', { name: 'Don’t Save' }).click();
  }
  await expect(page.getByTestId('zoom')).toHaveText('100 %');
  const box = (await canvas(page).boundingBox())!;
  return ([x, y]) => [box.x + box.width / 2 + x * 16, box.y + box.height / 2 + y * 16];
}

/** Where a pin of a part placed by a click at `at` (rotation 0) ends up. */
export function pinOf(type: string, at: Point, pin: string): Point {
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

export async function clickAt(
  page: Page,
  p: Point,
  options: { button?: 'right' } = {},
): Promise<void> {
  await page.mouse.click(p[0], p[1], options);
}

export async function place(page: Page, grid: (p: Point) => Point, type: string, at: Point) {
  await page.locator(`[data-type="${type}"]`).click();
  await clickAt(page, grid(at));
  await page.keyboard.press('Escape');
}

/** Wire tool: click each grid point; the last one is a pin, which finishes the wire. */
export async function wire(page: Page, grid: (p: Point) => Point, ...points: Point[]) {
  await page.keyboard.press('w');
  for (const p of points) {
    await page.mouse.move(...grid(p));
    await clickAt(page, grid(p));
  }
  await page.keyboard.press('Escape');
}

/** The net a part's pin is on, as the Properties panel shows it ("open" if none). */
export async function netOf(page: Page, grid: (p: Point) => Point, at: Point, pin: string) {
  await clickAt(page, grid(at));
  return properties(page)
    .locator('.prop-row', { hasText: new RegExp(`^${pin}`) })
    .textContent();
}

/** Places and wires the R05 Hello LED circuits (a `prim/nand`; the example now uses a 74HC00). */
export async function drawHelloLed(page: Page): Promise<(p: Point) => Point> {
  const grid = await newCircuit(page);
  await place(page, grid, 'io/switch', [-12, 0]);
  await place(page, grid, 'prim/nand', [0, 1]);
  await place(page, grid, 'io/vcc', [-6, -6]);
  await place(page, grid, 'io/led', [12, 1]);
  await place(page, grid, 'io/gnd', [18, 4]);
  await place(page, grid, 'io/clock', [-12, 9]);
  await place(page, grid, 'io/led', [12, 9]);
  await place(page, grid, 'io/gnd', [18, 12]);
  await wire(page, grid, pinOf('io/switch', [-12, 0], 'Y'), pinOf('prim/nand', [0, 1], 'A'));
  await wire(page, grid, pinOf('io/vcc', [-6, -6], 'Y'), pinOf('prim/nand', [0, 1], 'B'));
  await wire(page, grid, pinOf('prim/nand', [0, 1], 'Y'), pinOf('io/led', [12, 1], 'A'));
  await wire(page, grid, pinOf('io/led', [12, 1], 'K'), pinOf('io/gnd', [18, 4], 'Y'));
  await wire(page, grid, pinOf('io/clock', [-12, 9], 'Y'), pinOf('io/led', [12, 9], 'A'));
  await wire(page, grid, pinOf('io/led', [12, 9], 'K'), pinOf('io/gnd', [18, 12], 'Y'));
  return grid;
}

/** Opens an example from the gallery; returns where its parts are on screen (it opens fitted). */
export async function openExample(page: Page, id: string, title: string, document: unknown) {
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
    /** A pin's tip. */
    pin(id: string, pin: string): Point {
      return screen(scene.partById.get(id)!.pins.find((p) => p.name === pin)!.at);
    },
    /** The middle of a wire (`bus`: the first bus line). */
    wire(bus = false): Point {
      const w = scene.wires.find((x) => x.bus === bus)!;
      return screen([(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2]);
    },
    /** A DIP switch's lever: the body's middle on the row of its pin. */
    lever(id: string, pin: string): Point {
      const part = scene.partById.get(id)!;
      const at = part.pins.find((p) => p.name === pin)!.at;
      return screen([part.body.x + part.body.width / 2, at[1]]);
    },
  };
}
