import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBytes } from '../../src/format.js';
import { fileKind } from '../../src/kinds.js';
import { FOLDER_MIME } from '../../src/kinds.js';
import { layoutTreemap, squarify, tileIndexAt } from '../../src/treemap.js';
import { ELSEWHERE_NAME, NO_FOLDER_NAME, UNORGANIZED_SEARCH, buildTree, removingTrashed } from '../../src/tree.js';

const file = (id, parent, bytes, extra = {}) => ({ id, name: `${id}.bin`, mimeType: 'application/octet-stream', quotaBytesUsed: String(bytes), parents: [parent], ...extra });
const folder = (id, parent, extra = {}) => ({ id, name: id, mimeType: FOLDER_MIME, parents: [parent], ...extra });

test('squarify fills the rectangle exactly', () => {
  const rect = { x: 0, y: 0, w: 600, h: 400 };
  const rects = squarify([6, 6, 4, 3, 2, 2, 1], rect);
  assert.equal(rects.length, 7);
  const area = rects.reduce((s, r) => s + r.w * r.h, 0);
  assert.ok(Math.abs(area - 600 * 400) < 1e-6);
  for (const r of rects) {
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 600 + 1e-9 && r.y + r.h <= 400 + 1e-9);
  }
});

test('buildTree nests, sums, sorts, and gathers orphans under Elsewhere', () => {
  const root = buildTree([
    folder('a', 'R'), file('a1', 'a', 100), file('a2', 'a', 300),
    file('b', 'R', 50), file('orphan', 'not-listed', 70),
    { id: 'doc', name: 'Doc', mimeType: 'application/vnd.google-apps.document', quotaBytesUsed: '0', parents: ['R'] },
  ], { rootId: 'R' });
  assert.equal(root.usage.bytes, 520);
  assert.equal(root.usage.files, 5);
  assert.equal(root.usage.folders, 1); // "a": neither the drive itself nor the virtual Elsewhere count
  assert.deepEqual(root.children.map((c) => c.name), ['a', ELSEWHERE_NAME, 'b.bin', 'Doc']);
  assert.deepEqual(root.children[0].children.map((c) => c.usage.bytes), [300, 100]);
});

test('Elsewhere groups orphans by the folder they are really in', () => {
  const root = buildTree([
    file('s1', 'theirs', 10), file('s2', 'theirs', 20),
    file('g1', 'gone', 5), { ...file('n1', 'x', 7), parents: undefined },
    file('p1', 'pending', 1),
  ], {
    rootId: 'R',
    foreignFolders: new Map([['theirs', { name: 'Team', link: 'https://drive/theirs', owner: 'Ada' }], ['gone', null]]),
  });
  const elsewhere = root.children.find((c) => c.name === ELSEWHERE_NAME);
  assert.ok(elsewhere.virtual && elsewhere.description);
  assert.deepEqual(elsewhere.children.map((c) => [c.name, c.usage.files, c.link]), [
    ['Team', 2, 'https://drive/theirs'],
    [NO_FOLDER_NAME, 2, UNORGANIZED_SEARCH],
    ['Shared folder', 1, null], // not resolved yet
  ]);
  assert.match(elsewhere.children[0].description, /Ada/);
  assert.equal(root.usage.folders, 0);
});

test('removingTrashed drops trash and recomputes totals, sharing untouched subtrees', () => {
  const root = buildTree([
    folder('keep', 'R'), file('k1', 'keep', 10),
    folder('mixed', 'R'), file('m1', 'mixed', 20), file('m2', 'mixed', 500, { trashed: true }),
    folder('gone', 'R', { trashed: true }), file('g1', 'gone', 1000, { trashed: true }),
  ], { rootId: 'R' });
  const visible = removingTrashed(root);
  assert.equal(root.usage.bytes, 1530);
  assert.equal(visible.usage.bytes, 30);
  assert.equal(visible.usage.folders, 2);
  assert.deepEqual(visible.children.map((c) => c.name), ['mixed', 'keep']);
  assert.equal(visible.children[1], root.children.find((c) => c.name === 'keep'));
});

test('layout merges items too small to draw into one small-files tile', () => {
  const files = [file('big', 'R', 5000)];
  for (let i = 0; i < 1000; i++) files.push(file(`tiny${i}`, 'R', 1));
  const tiles = layoutTreemap(buildTree(files, { rootId: 'R' }), { x: 0, y: 0, w: 200, h: 100 });
  const small = tiles.filter((t) => t.smallFiles > 0);
  assert.equal(small.length, 1);
  assert.equal(small[0].smallFiles, 1000);
  assert.equal(tileIndexAt(10, 10, tiles), 1);
});

test('shallow draws top-level folders as single blocks', () => {
  const root = buildTree([folder('a', 'R'), file('a1', 'a', 10), file('a2', 'a', 10)], { rootId: 'R' });
  const deep = layoutTreemap(root, { x: 0, y: 0, w: 100, h: 100 });
  const shallow = layoutTreemap(root, { x: 0, y: 0, w: 100, h: 100 }, { shallow: true });
  assert.equal(deep.length, 4);
  assert.equal(shallow.length, 2);
  assert.ok(shallow[1].isLeaf && shallow[1].isDirectory);
});

test('file kinds come from MIME types, then extensions', () => {
  assert.equal(fileKind({ name: 'a.jpg', mimeType: 'image/jpeg' }), 'image');
  assert.equal(fileKind({ name: 'main.py', mimeType: 'text/x-python' }), 'code');
  assert.equal(fileKind({ name: 'notes.txt', mimeType: 'text/plain' }), 'document');
  assert.equal(fileKind({ name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' }), 'document');
  assert.equal(fileKind({ name: 'app.ts', mimeType: 'video/mp2t' }), 'video'); // Drive says so; MIME wins
  assert.equal(fileKind({ name: 'backup.7z', mimeType: 'application/octet-stream' }), 'archive');
  assert.equal(fileKind({ name: 'blob', mimeType: 'application/octet-stream' }), 'other');
});

test('formatBytes writes decimal units like Finder', () => {
  assert.equal(formatBytes(0), 'Zero KB');
  assert.equal(formatBytes(1), '1 byte');
  assert.equal(formatBytes(999), '999 bytes');
  assert.equal(formatBytes(1500), '2 KB');
  assert.equal(formatBytes(4_500_000), '4.5 MB');
  assert.equal(formatBytes(28_260_000_000), '28.26 GB');
});
