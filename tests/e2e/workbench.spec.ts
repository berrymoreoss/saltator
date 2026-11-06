import { expect, type Page, test } from '@playwright/test';

/** Collects console errors and page errors for the whole test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const canvas = (page: Page) => page.getByTestId('schematic');

/** Distinct colors in a sample of the canvas pixels: a blank canvas has one. */
async function canvasColors(page: Page): Promise<number> {
  return canvas(page).evaluate((element) => {
    const c = element as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) {
      colors.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    }
    return colors.size;
  });
}

async function canvasCornerBrightness(page: Page): Promise<number> {
  return canvas(page).evaluate((element) => {
    const c = element as HTMLCanvasElement;
    const [r, g, b] = c.getContext('2d')!.getImageData(2, 2, 1, 1).data;
    return (r! + g! + b!) / 3;
  });
}

test.beforeEach(async ({ page }) => {
  // Every test starts from default settings.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-started')) {
      localStorage.clear();
      sessionStorage.setItem('e2e-started', '1');
    }
  });
});

test('the shell renders every region and draws the schematic', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Main toolbar' })).toBeVisible();
  for (const id of ['parts-panel', 'properties-panel', 'bottom-panel', 'statusbar']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => canvasColors(page)).toBeGreaterThan(4);
  await expect(page.getByTestId('selection-summary')).toHaveText('Nothing selected');
  expect(errors).toEqual([]);
});

test('the symbol gallery opens without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?gallery');
  await expect(page.getByTestId('messages')).toBeVisible();
  await expect.poll(() => canvasColors(page)).toBeGreaterThan(4);
  expect(errors).toEqual([]);
});

test('clicking a message selects and centers its part; clicking the canvas selects', async ({
  page,
}) => {
  await page.goto('/?gallery');
  await page.getByTestId('messages').getByRole('button').first().click();
  const summary = page.getByTestId('selection-summary');
  await expect(summary).toHaveText(/^U1 · /);
  await expect(page.getByTestId('part-properties')).toContainText('prim/and');

  // The located part sits in the middle of the canvas: Escape clears, a click there selects it.
  await page.keyboard.press('Escape');
  await expect(summary).toHaveText('Nothing selected');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(summary).toHaveText(/^U1 · /);
});

test('a selection box dragged left to right selects what is inside', async ({ page }) => {
  await page.goto('/');
  const { x, y, width, height } = (await canvas(page).boundingBox())!;
  await page.mouse.move(x + 4, y + 4);
  await page.mouse.down();
  await page.mouse.move(x + width / 2, y + height / 2, { steps: 4 });
  await page.mouse.move(x + width - 4, y + height - 4, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('selection-summary')).toHaveText('8 parts, 9 wires');
});

test('keyboard zoom changes the zoom readout', async ({ page }) => {
  await page.goto('/');
  const zoom = page.getByTestId('zoom');
  const before = await zoom.textContent();
  await canvas(page).focus();
  await page.keyboard.press('Minus');
  await expect(zoom).not.toHaveText(before!);
  await page.keyboard.press('ControlOrMeta+1');
  await expect(zoom).toHaveText('100 %');
});

test('the wheel pans, Ctrl+wheel zooms; the KiCad setting makes the wheel zoom', async ({
  page,
}) => {
  await page.goto('/');
  const zoom = page.getByTestId('zoom');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await zoom.textContent();
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(100);
  await expect(zoom).toHaveText(before!);

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect(zoom).not.toHaveText(before!);

  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Scroll Wheel' }).hover();
  await page.getByRole('menuitemcheckbox', { name: /Zooms \(KiCad\)/ }).click();
  const zoomed = await zoom.textContent();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await expect(zoom).not.toHaveText(zoomed!);
});

test('View ▸ Theme switches the shell and the canvas', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const dark = await canvasCornerBrightness(page);

  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).hover();
  await page.getByRole('menuitemcheckbox', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => canvasCornerBrightness(page)).toBeGreaterThan(dark + 100);
});

test('panel sizes and visibility survive a reload', async ({ page }) => {
  await page.goto('/');
  const parts = page.getByTestId('parts-panel');
  const before = (await parts.boundingBox())!.width;
  const splitter = page.getByRole('separator', { name: 'Resize Parts panel' });
  const s = (await splitter.boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + 80, s.y + s.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await parts.boundingBox())!.width).toBeGreaterThan(before + 60);

  await page.getByTestId('properties-panel').getByTitle('Hide panel').click();
  await expect(page.getByTestId('properties-panel')).toHaveCount(0);

  await page.waitForTimeout(400); // settings are saved with a short debounce
  await page.reload();
  await expect.poll(async () => (await parts.boundingBox())!.width).toBeGreaterThan(before + 60);
  await expect(page.getByTestId('properties-panel')).toHaveCount(0);
});

test('the shortcuts dialog opens with ? and closes with Escape', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Shift+Slash');
  const dialog = page.getByTestId('shortcuts-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Zoom to Fit');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('Shift-click toggles, Mod+A selects all, a right-to-left box selects what it touches', async ({
  page,
}) => {
  await page.goto('/?gallery');
  const summary = page.getByTestId('selection-summary');
  await page.getByTestId('messages').getByRole('button').first().click();
  await expect(summary).toHaveText(/^U1 · /);
  const box = (await canvas(page).boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.keyboard.down('Shift');
  await page.mouse.click(center.x, center.y);
  await expect(summary).toHaveText('Nothing selected');
  await page.mouse.click(center.x, center.y);
  await page.keyboard.up('Shift');
  await expect(summary).toHaveText(/^U1 · /);

  await canvas(page).focus();
  await page.keyboard.press('ControlOrMeta+A');
  await expect(summary).toHaveText(/^\d+ parts$/);
  await page.keyboard.press('Escape');

  // From empty space right of U1 leftwards into it: only touched, never enclosed.
  await page.mouse.move(center.x + 120, center.y - 20);
  await page.mouse.down();
  await page.mouse.move(center.x + 60, center.y - 10, { steps: 3 });
  await page.mouse.move(center.x, center.y, { steps: 3 });
  await page.mouse.up();
  await expect(summary).toHaveText(/^U1 · /);
});

test('Space-drag, middle-drag and the Pan tool move the view', async ({ page }) => {
  await page.goto('/');
  const cursor = page.getByTestId('cursor');
  const box = (await canvas(page).boundingBox())!;
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const readAt = async () => {
    await page.mouse.move(p.x + 1, p.y);
    await page.mouse.move(p.x, p.y);
    return cursor.textContent();
  };
  const drag = async (button: 'left' | 'middle') => {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button });
    await page.mouse.move(p.x + 160, p.y + 80, { steps: 5 });
    await page.mouse.up({ button });
  };

  const start = await readAt();
  await page.keyboard.down('Space');
  await drag('left');
  await page.keyboard.up('Space');
  const afterSpace = await readAt();
  expect(afterSpace).not.toBe(start);
  await expect(page.getByTestId('selection-summary')).toHaveText('Nothing selected');

  await drag('middle');
  const afterMiddle = await readAt();
  expect(afterMiddle).not.toBe(afterSpace);

  await page.keyboard.press('H');
  await drag('left');
  expect(await readAt()).not.toBe(afterMiddle);
  await page.keyboard.press('V');
});

test('View ▸ Panels hides and shows a dock', async ({ page }) => {
  await page.goto('/');
  const toggle = async () => {
    await page.getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitem', { name: 'Panels' }).hover();
    await page.getByRole('menuitemcheckbox', { name: 'Messages' }).click();
  };
  await toggle();
  await expect(page.getByTestId('bottom-panel')).toHaveCount(0);
  await toggle();
  await expect(page.getByTestId('bottom-panel')).toBeVisible();
});
