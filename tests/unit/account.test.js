import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNT_ID, accountBytes, buildAccount } from '../../src/account.js';
import { buildTree } from '../../src/tree.js';

const quota = { limit: '100', usage: '70', usageInDrive: '40' };
const drive = () => buildTree([{ id: 'f', name: 'f.bin', parents: ['R'], quotaBytesUsed: '40' }], { rootId: 'R' });

test('Gmail & Photos is the account usage beyond Drive; free space is what the limit leaves', () => {
  assert.deepEqual(accountBytes(quota), { mail: 30, free: 30 });
  assert.deepEqual(accountBytes({ usage: '70', usageInDrive: '40' }), { mail: 30, free: null });
  assert.deepEqual(accountBytes({ usage: '70' }), { mail: null, free: null });
});

test('the account holds My Drive and the blocks asked for, or is not there', () => {
  const account = buildAccount(drive(), quota, { mail: true, free: true });
  assert.equal(account.id, ACCOUNT_ID);
  assert.deepEqual(account.children.map((c) => [c.name, c.usage.bytes, c.kind]),
    [['My Drive', 40, undefined], ['Gmail & Photos', 30, 'mail'], ['Free space', 30, 'free']]);
  assert.equal(account.usage.bytes, 100);
  assert.deepEqual(buildAccount(drive(), quota, { mail: false, free: true }).children.map((c) => c.name), ['My Drive', 'Free space']);
  assert.equal(buildAccount(drive(), quota, { mail: false, free: false }), null);
  assert.equal(buildAccount(drive(), null, { mail: true, free: true }), null);
});
