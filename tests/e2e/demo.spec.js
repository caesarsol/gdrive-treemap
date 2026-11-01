import { expect, test } from '@playwright/test';
import { findTile, parseBytes } from './helpers.js';

const SIZE = /^[\d.,]+ (bytes|KB|MB|GB|TB)\b/;

test('a walk through the demo drive', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.getByRole('button', { name: 'Try with demo data' }).click();

  // Header: the drive, its total and counts; the account bar says it is the demo.
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#demo-badge')).toBeVisible();
  await expect(page.locator('#crumbs .current')).toHaveText('My Drive');
  await expect(page.locator('#total-bytes')).toHaveText(SIZE);
  await expect(page.locator('#counts')).toHaveText(/^\d+ items · [\d,]+ files · \d+ folders$/);
  await expect(page.locator('#caption')).toHaveText('owned by you, trash included');
  await expect(page.locator('#quota')).toHaveText(/ of 100 GB used$/);

  // The kind legend lists the demo's categories, each with its size.
  const legend = page.locator('#kind-legend [data-kind]');
  for (const label of ['Images', 'Videos', 'Audio', 'Archives', 'Code', 'Documents']) {
    await expect(legend.filter({ hasText: label })).toHaveCount(1);
  }

  // Hovering the treemap names the file under the pointer, with its size.
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#status-name')).not.toHaveText(/^\s*$/);
  await expect(page.locator('#status-detail')).toHaveText(SIZE);
  await page.mouse.move(1, 1); // off the canvas: the status line clears
  await expect(page.locator('#status-name')).toHaveText(/^\s*$/);

  // Hovering a legend entry shows that category's total in the status line.
  const videos = legend.filter({ hasText: 'Videos' });
  await videos.hover();
  await expect(videos).toHaveClass(/hovered/);
  await expect(page.locator('#status-name')).toHaveText('Videos');
  const videosBytes = await page.locator('#status-detail').textContent();
  await expect(videos).toHaveText(`Videos ${videosBytes}`);
  await page.mouse.move(0, 0);

  // Clicking a folder (its border) zooms into it; the breadcrumb follows.
  const photos = await findTile(page, { name: 'Photos', folders: '' });
  expect(photos, 'a point on the Photos folder').not.toBeNull();
  await page.mouse.click(photos.x, photos.y);
  const crumbs = page.locator('#crumbs > button, #crumbs > .current');
  await expect(crumbs).toHaveText(['My Drive', 'Photos']);
  await expect(page.locator('#crumbs .open')).toHaveText('Open in Drive ↗');

  const year = await findTile(page, { name: '2024', folders: '' });
  expect(year, 'a point on the Photos/2024 folder').not.toBeNull();
  await page.mouse.click(year.x, year.y);
  await expect(crumbs).toHaveText(['My Drive', 'Photos', '2024']);
  await expect(page.locator('#counts')).toHaveText(/^\d+ items · \d+ files · 0 folders$/);

  // Escape goes up one level; the breadcrumb goes anywhere above.
  await page.keyboard.press('Escape');
  await expect(crumbs).toHaveText(['My Drive', 'Photos']);
  await page.locator('#crumbs').getByRole('button', { name: 'My Drive' }).click();
  await expect(crumbs).toHaveText(['My Drive']);

  // Leaving out the trash makes the drive smaller.
  const withTrash = parseBytes(await page.locator('#total-bytes').textContent());
  await page.getByLabel('Show trashed files').uncheck();
  await expect(page.locator('#caption')).toHaveText('owned by you, trash excluded');
  const withoutTrash = parseBytes(await page.locator('#total-bytes').textContent());
  expect(withoutTrash).toBeLessThan(withTrash);

  // Shallow draws each top-level item as one block: whatever is hovered sits right under the root.
  await page.getByLabel('Shallow').check();
  for (const [fx, fy] of [[0.2, 0.2], [0.5, 0.5], [0.8, 0.7]]) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await expect(page.locator('#status-name')).not.toHaveText(/^\s*$/);
    await expect(page.locator('#status-folders')).toHaveText('');
  }

  // Exit demo: back to the start page.
  await page.getByRole('button', { name: 'Exit demo' }).click();
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#account')).toBeHidden();
});
