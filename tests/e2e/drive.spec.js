import { expect, test } from '@playwright/test';
import { findTile } from './helpers.js';

const FOLDER = 'application/vnd.google-apps.folder';
const link = (id) => `https://drive.google.com/file/d/${id}/view`;
const file = (id, name, mimeType, bytes, parent, extra = {}) => ({
  id, name, mimeType, size: String(bytes), quotaBytesUsed: String(bytes), parents: [parent], trashed: false,
  webViewLink: link(id), ...extra,
});

// Two pages of `files.list`, 4.95 GB in all, 0.25 GB of it in the trash.
const PAGES = [
  [
    { id: 'projects', name: 'Projects', mimeType: FOLDER, parents: ['root-id'], trashed: false, webViewLink: link('projects') },
    file('video', 'video.mp4', 'video/mp4', 3e9, 'projects'),
    { id: 'sub', name: 'Sub', mimeType: FOLDER, parents: ['projects'], trashed: false, webViewLink: link('sub') },
    file('photo', 'photo.jpg', 'image/jpeg', 5e8, 'sub'),
  ],
  [
    file('report', 'report.pdf', 'application/pdf', 1e9, 'root-id'),
    file('old', 'old.zip', 'application/zip', 2.5e8, 'root-id', { trashed: true }),
    // Owned by you, in a folder someone else shared: its parent is not listed.
    file('shared', 'shared.pdf', 'application/pdf', 2e8, 'someone-elses-folder'),
    // Google Docs take no quota.
    { id: 'notes', name: 'Notes', mimeType: 'application/vnd.google-apps.document', quotaBytesUsed: '0', parents: ['root-id'], trashed: false, webViewLink: link('notes') },
  ],
];

test('signing in with Google and browsing the drive', async ({ page, context }) => {
  // Google Identity Services: hands out a token straight away, no consent popup.
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.google = { accounts: { oauth2: {
      initTokenClient: ({ callback }) => ({ requestAccessToken() { callback({ access_token: 'test-token' }); } }),
      revoke(token, done) { done?.(); },
    } } };`,
  }));

  // The Drive API.
  const authorizations = [];
  const pageTokens = [];
  await page.route((url) => url.hostname === 'www.googleapis.com', (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    authorizations.push(request.headers().authorization);
    const url = new URL(request.url());
    const json = (body) => route.fulfill({ headers: cors, json: body });
    switch (url.pathname) {
      case '/drive/v3/about':
        return json({ user: { displayName: 'Test User', emailAddress: 'test@example.com' }, storageQuota: { limit: '15000000000', usage: '4950000000' } });
      case '/drive/v3/files/root':
        return json({ id: 'root-id', name: 'My Drive', webViewLink: 'https://drive.google.com/drive/my-drive' });
      case '/drive/v3/files': {
        const pageToken = url.searchParams.get('pageToken');
        pageTokens.push(pageToken);
        return pageToken === 'page-2'
          ? json({ files: PAGES[1] })
          : json({ nextPageToken: 'page-2', files: PAGES[0] });
      }
      default:
        return route.fulfill({ status: 404, headers: cors, json: { error: { message: 'Not found' } } });
    }
  });
  // Where files open: Drive itself, stubbed.
  await context.route('https://drive.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Drive</title>' }));

  await page.goto('/');
  await page.getByLabel('OAuth client ID').fill('1234-test.apps.googleusercontent.com');
  await page.getByRole('button', { name: 'Sign in with Google' }).click();

  // Both pages listed, every request with the token.
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#caption')).toHaveText('owned by you, trash included');
  expect(pageTokens).toEqual([null, 'page-2']);
  expect(authorizations.length).toBe(4);
  expect(new Set(authorizations)).toEqual(new Set(['Bearer test-token']));

  // Header: account, quota, totals and counts of the mocked drive.
  await expect(page.locator('#account-name')).toHaveText('test@example.com');
  await expect(page.locator('#quota')).toHaveText('4.95 GB of 15 GB used');
  await expect(page.locator('#demo-badge')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.locator('#total-bytes')).toHaveText('4.95 GB');
  // Projects, report.pdf, old.zip, Elsewhere and Notes; the folders are Projects, Sub and Elsewhere.
  await expect(page.locator('#counts')).toHaveText('5 items · 6 files · 3 folders');
  await expect(page.locator('#crumbs .open')).toHaveAttribute('href', 'https://drive.google.com/drive/my-drive');
  await expect(page.locator('#kind-legend [data-kind]')).toHaveText([
    'Videos 3 GB', 'Documents 1.2 GB', 'Images 500 MB', 'Archives 250 MB',
  ]);

  // The treemap: nested files, the trash, and what has no listed parent under "Elsewhere".
  for (const [name, folders, detail] of [
    ['video.mp4', 'Projects/', '3 GB'],
    ['photo.jpg', 'Projects/Sub/', '500 MB'],
    ['old.zip', '', '250 MB · in trash'],
    ['shared.pdf', 'Elsewhere/', '200 MB'],
  ]) {
    expect(await findTile(page, { name, folders }), name).not.toBeNull();
    await expect(page.locator('#status-detail')).toHaveText(detail);
  }

  // Without the trash.
  await page.getByLabel('Show trashed files').uncheck();
  await expect(page.locator('#total-bytes')).toHaveText('4.7 GB');
  expect(await findTile(page, { name: 'old.zip' })).toBeNull();

  // Clicking a file opens it in Drive.
  const report = await findTile(page, { name: 'report.pdf', folders: '' });
  const popup = page.waitForEvent('popup');
  await page.mouse.click(report.x, report.y);
  await expect(await popup).toHaveURL(link('report'));

  // Signing out goes back to the start page.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#welcome')).toBeVisible();
});
