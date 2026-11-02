// The Google account above My Drive: Drive shares its storage with Gmail and Google Photos, which
// the Drive API only reports as one total, and what is left is free.

import { addUsage } from './treemap.js';

export const ACCOUNT_ID = '__account__';
/** Google One's own breakdown of the storage, with its clean-up tools for Gmail and Photos. */
export const GOOGLE_ONE_STORAGE = 'https://one.google.com/storage/management';

/** Bytes of Gmail & Photos and of free space, from `about.storageQuota`; null when unknown. */
export function accountBytes(quota) {
  if (!quota || quota.usageInDrive == null) return { mail: null, free: null };
  const usage = Number(quota.usage);
  return {
    mail: Math.max(0, usage - Number(quota.usageInDrive)),
    free: quota.limit ? Math.max(0, Number(quota.limit) - usage) : null,
  };
}

/**
 * The account as a tree: My Drive (`drive`, as listed), plus a block for Gmail & Photos and one for
 * the free space, each when asked for and not empty. Null when it would hold My Drive alone.
 */
export function buildAccount(drive, quota, { mail: showMail, free: showFree }) {
  const { mail, free } = accountBytes(quota);
  const children = [drive];
  if (showMail && mail > 0) {
    children.push(block('__mail__', 'Gmail & Photos', 'mail', mail, 'envelope-simple', GOOGLE_ONE_STORAGE));
  }
  if (showFree && free > 0) children.push(block('__free__', 'Free space', 'free', free, 'circle-dashed', null));
  if (children.length === 1) return null;
  const usage = { bytes: 0, files: 0, folders: 0 };
  for (const child of children) addUsage(usage, child.usage);
  return {
    id: ACCOUNT_ID,
    name: 'Google account',
    isDirectory: true,
    virtual: true,
    description: 'Your Google storage, shared by Drive, Gmail and Google Photos. Drive only reports Gmail and Photos together.',
    link: GOOGLE_ONE_STORAGE,
    usage,
    children: children.sort((a, b) => b.usage.bytes - a.usage.bytes),
  };
}

function block(id, name, kind, bytes, icon, link) {
  return {
    id, name, kind, icon, link, isDirectory: false, virtual: true, trashed: false, mimeType: '',
    usage: { bytes, files: 0, folders: 0 }, children: [],
  };
}
