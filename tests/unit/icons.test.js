import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ICON_NAMES, iconName, iconUrl } from '../../src/icons.js';

const node = (name, mimeType = 'application/octet-stream', extra = {}) => ({ name, mimeType, isDirectory: false, ...extra });

test('icons by extension, then MIME type, then category', () => {
  assert.equal(iconName(node('Report.PDF')), 'file-pdf');
  assert.equal(iconName(node('main.py', 'text/x-python')), 'file-py');
  assert.equal(iconName(node('Budget', 'application/vnd.google-apps.spreadsheet')), 'file-xls');
  assert.equal(iconName(node('clip.mov', 'video/quicktime')), 'file-video');
  assert.equal(iconName(node('noise', 'audio/x-weird')), 'file-audio');
  assert.equal(iconName(node('blob')), 'file');
  assert.equal(iconName({ name: 'Photos', isDirectory: true }), 'folder');
  assert.equal(iconName({ name: 'Elsewhere', isDirectory: true, virtual: true }), 'folder-user');
});

test('every icon the mapping can name is vendored', () => {
  for (const name of ICON_NAMES) assert.ok(existsSync(fileURLToPath(iconUrl(name))), name);
});
