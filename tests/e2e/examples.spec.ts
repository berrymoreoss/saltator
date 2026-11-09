import { expect, test } from '@playwright/test';
import { counts, edit, HELLO_COUNTS, unsavedDialog } from './file-system';
import { menu, openApp, watchErrors } from './support';

// The example gallery (R07): File ▸ New from Example… shows a card per example with a thumbnail
// drawn live; a card opens an untitled copy, asking first about unsaved changes.

test('the gallery shows every example with a thumbnail and opens one', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page);
  await menu(page, 'File', 'New Document');
  await expect(page).toHaveTitle('Untitled — Saltator');

  await menu(page, 'File', 'New from Example…');
  const gallery = page.getByTestId('example-gallery');
  await expect(gallery.locator('.example-card .example-title')).toContainText([
    'Hello, LED',
    'Symbol Gallery',
  ]);
  const thumbnail = gallery.getByRole('img', { name: 'Thumbnail of Hello, LED' });
  await expect(thumbnail).toBeVisible();
  // Something is drawn: the canvas isn't one flat color.
  const colors = await thumbnail.evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97)
      seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    return seen.size;
  });
  expect(colors).toBeGreaterThan(2);

  await gallery.locator('[data-example="hello-led"]').click();
  await expect(gallery).toBeHidden();
  await expect(page).toHaveTitle('Hello, LED — Saltator');
  await expect(counts(page)).toHaveText(HELLO_COUNTS);
  expect(errors).toEqual([]);
});

test('opening an example over unsaved changes asks first', async ({ page }) => {
  await openApp(page);
  await edit(page);
  await menu(page, 'File', 'New from Example…');
  await page.getByTestId('example-gallery').locator('[data-example="gallery"]').click();
  await expect(unsavedDialog(page)).toBeVisible();
  await unsavedDialog(page).getByRole('button', { name: 'Don’t Save' }).click();
  await expect(page).toHaveTitle('Symbol Gallery — Saltator');
});
