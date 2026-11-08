import { expect, test } from '@playwright/test';
import { clickAt, menu, newCircuit, properties, summary, watchErrors } from './support';

// PLT-1 in the browser: a text placed with T and from the Place menu, edited over several lines
// in Properties, focused by a double-click, reverted with Escape, undone; never a design issue.

test('a text placed with T is edited over several lines in Properties', async ({ page }) => {
  const errors = watchErrors(page);
  const grid = await newCircuit(page);
  await clickAt(page, grid([0, 12])); // the canvas takes the keyboard
  await page.keyboard.press('t');
  // A text without pins is centered under the pointer: "Text" is 2 × 1 cells, at (−1, −1).
  await page.mouse.move(...grid([0, 0]));
  await clickAt(page, grid([0, 0]));
  await page.keyboard.press('Escape');
  await expect(summary(page)).toHaveText('TXT1 · TEXT');
  const text = properties(page).getByTestId('prop-text');
  await expect(text).toHaveValue('Text');
  await expect(properties(page)).not.toContainText('Label');

  // Enter starts a line; Mod+Enter applies.
  await text.fill('');
  await text.pressSequentially('Line one');
  await text.press('Enter');
  await text.pressSequentially('Line two');
  await text.press('ControlOrMeta+Enter');
  await expect(text).toHaveValue('Line one\nLine two');
  await expect(page.getByTestId('bottom-panel')).toContainText('No problems found');

  // A double-click on the text, now two lines from (−1, −1), puts the cursor in its text.
  await clickAt(page, grid([0, 12]));
  await page.mouse.dblclick(...grid([1, 0.5]));
  await expect(summary(page)).toHaveText('TXT1 · TEXT');
  await expect(text).toBeFocused();

  // Escape reverts what was typed.
  await text.pressSequentially(' and more');
  await text.press('Escape');
  await expect(text).toHaveValue('Line one\nLine two');

  // The mono font; undo goes back one edit at a time.
  await properties(page).getByTestId('prop-font').selectOption('mono');
  await clickAt(page, grid([0, 12]));
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await clickAt(page, grid([0, -0.5]));
  await expect(summary(page)).toHaveText('TXT1 · TEXT');
  await expect(text).toHaveValue('Text');
  await expect(properties(page).getByTestId('prop-font')).toHaveValue('sans');
  expect(errors).toEqual([]);
});

test('Place ▸ Text arms the place tool with a text', async ({ page }) => {
  const grid = await newCircuit(page);
  await menu(page, 'Place', /^Text/);
  await clickAt(page, grid([4, 4]));
  await page.keyboard.press('Escape');
  await expect(summary(page)).toHaveText('TXT1 · TEXT');
  await expect(properties(page).getByTestId('prop-size')).toHaveValue('normal');
});
