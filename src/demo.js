// A made-up drive, deterministic, in the shape `files.list` returns: to try the app without signing in.

import { FOLDER_MIME } from './kinds.js';

export const DEMO_ROOT_ID = 'demo-root';

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = {
  jpg: ['image/jpeg', 2e6, 6e6], png: ['image/png', 2e5, 3e6], heic: ['image/heic', 1.5e6, 4e6],
  mov: ['video/quicktime', 5e7, 9e8], mp4: ['video/mp4', 2e7, 6e8],
  mp3: ['audio/mpeg', 3e6, 1.2e7], wav: ['audio/wav', 2e7, 8e7],
  zip: ['application/zip', 1e6, 4e8], dmg: ['application/x-apple-diskimage', 5e7, 6e8],
  pdf: ['application/pdf', 1e5, 3e7], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 3e4, 2e6],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 2e4, 5e6], txt: ['text/plain', 1e3, 5e4],
  js: ['text/javascript', 1e3, 6e4], py: ['text/x-python', 1e3, 4e4], json: ['application/json', 5e2, 2e6],
  psd: ['image/vnd.adobe.photoshop', 2e7, 2e8], sketch: ['application/octet-stream', 5e6, 5e7],
};

const TREE = {
  Photos: { '2022': ['jpg', 260, 'heic', 120], '2023': ['jpg', 380, 'heic', 200, 'mov', 14], '2024': ['heic', 420, 'mov', 22, 'png', 30], Screenshots: ['png', 300] },
  Videos: { 'Family trip': ['mov', 9, 'mp4', 4], Recordings: ['mp4', 12] },
  Music: { Demos: ['wav', 18, 'mp3', 40], Podcast: ['mp3', 30] },
  Work: {
    'Client proposals': { '2024 Q1': ['pdf', 24, 'docx', 30, 'xlsx', 12], '2024 Q2': ['pdf', 30, 'docx', 22], Archive: ['zip', 8] },
    Design: { Assets: ['psd', 14, 'png', 120, 'sketch', 6], Exports: ['png', 200, 'pdf', 20] },
    Code: { 'data-pipeline': ['py', 140, 'json', 60], dashboard: ['js', 260, 'json', 30] },
  },
  Documents: { Taxes: ['pdf', 40], Manuals: ['pdf', 60], Notes: ['txt', 300] },
  Backups: ['zip', 6, 'dmg', 3],
  _files: ['pdf', 12, 'docx', 6, 'jpg', 20, 'xlsx', 4],
};

/** Files and folders as Drive would list them, plus the root's id. */
export function demoDrive(seed = 7) {
  const random = rng(seed);
  const files = [];
  let next = 0;
  const id = () => `demo-${(next++).toString(36)}`;
  const link = (fileId) => `https://drive.google.com/demo/${fileId}`;

  function addFiles(spec, parent, prefix) {
    for (let i = 0; i < spec.length; i += 2) {
      const [ext, count] = [spec[i], spec[i + 1]];
      const [mimeType, min, max] = TYPES[ext];
      for (let n = 0; n < count; n++) {
        // Log-uniform sizes, with the odd giant, as real folders have.
        let size = Math.round(min * (max / min) ** random());
        if (random() < 0.01) size *= 8;
        const fileId = id();
        files.push({
          id: fileId, name: `${prefix}_${String(1000 + n)}.${ext}`, mimeType, size: String(size),
          quotaBytesUsed: String(size), parents: [parent], trashed: false, webViewLink: link(fileId),
        });
      }
    }
  }

  function addFolder(name, spec, parent) {
    const folderId = id();
    files.push({ id: folderId, name, mimeType: FOLDER_MIME, parents: [parent], trashed: false, webViewLink: link(folderId) });
    if (Array.isArray(spec)) addFiles(spec, folderId, name.replace(/\W+/g, '').slice(0, 8) || 'file');
    else addChildren(spec, folderId);
  }

  function addChildren(spec, parent) {
    for (const [name, child] of Object.entries(spec)) {
      if (name === '_files') addFiles(child, parent, 'Untitled');
      else addFolder(name, child, parent);
    }
  }

  addChildren(TREE, DEMO_ROOT_ID);

  // Some trash, which still counts against the quota.
  const trashedFolder = id();
  files.push({ id: trashedFolder, name: 'Old exports', mimeType: FOLDER_MIME, parents: [DEMO_ROOT_ID], trashed: true, webViewLink: link(trashedFolder) });
  const before = files.length;
  addFiles(['mov', 5, 'zip', 4], trashedFolder, 'export');
  for (const f of files.slice(before)) f.trashed = true;

  // Owned by you, inside a folder someone else shared with you: its parent is not listed.
  addFiles(['pdf', 6], 'someone-elses-folder', 'Shared deck');
  // Owned by you, in no folder at all (its folder was deleted by its owner, say).
  const beforeOrphans = files.length;
  addFiles(['zip', 2], 'gone-folder', 'Orphan');
  for (const f of files.slice(beforeOrphans)) f.parents = [];

  // Google Docs take no quota: listed, but with nothing to draw.
  files.push({ id: id(), name: 'Meeting notes', mimeType: 'application/vnd.google-apps.document', quotaBytesUsed: '0', parents: [DEMO_ROOT_ID], trashed: false });

  return { rootId: DEMO_ROOT_ID, files };
}

/** What Drive would say of the folders that hold your files but aren't yours. */
export function demoForeignFolders() {
  return new Map([['someone-elses-folder', { name: 'Client deliverables', link: 'https://drive.google.com/demo/someone-elses-folder', owner: 'Ada Lovelace' }]]);
}

/** Totals for the demo, shaped like `about.storageQuota`. */
export function demoQuota(files) {
  const usage = files.reduce((s, f) => s + Number(f.quotaBytesUsed ?? 0), 0);
  const trash = files.filter((f) => f.trashed).reduce((s, f) => s + Number(f.quotaBytesUsed ?? 0), 0);
  return { limit: String(100e9), usage: String(usage), usageInDrive: String(usage), usageInDriveTrash: String(trash) };
}
