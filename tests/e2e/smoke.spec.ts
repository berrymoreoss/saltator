import { expect, test } from '@playwright/test';

test('the app loads without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Logic');
  await expect(page.locator('#root')).not.toBeEmpty();
  expect(errors).toEqual([]);
});
