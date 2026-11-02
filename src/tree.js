// The Drive as a tree of nodes, after quicker-look's Node.swift.
//
// Node: { id, name, isDirectory, mimeType, link, trashed, virtual, description,
//         usage: { bytes, files, folders }, children (largest first) }
// A folder's usage is the sum of its subtree, itself included in `folders` (unless virtual: the
// folders the view adds, such as Elsewhere, count as none).

import { FOLDER_MIME, addBytesByKind } from './kinds.js';
import { addUsage } from './treemap.js';

export const ELSEWHERE_NAME = 'Elsewhere';
export const NO_FOLDER_NAME = 'No folder';
export const TRASH_NAME = '.Trash';
export const DRIVE_TRASH = 'https://drive.google.com/drive/trash';
/** Drive's own search for files you own that sit in no folder you can open. */
export const UNORGANIZED_SEARCH = 'https://drive.google.com/drive/search?q=is%3Aunorganized%20owner%3Ame';

/** Bytes a file takes from the storage quota; Google Docs and friends often take none. */
export function fileBytes(file) {
  return Number(file.quotaBytesUsed ?? file.size ?? 0) || 0;
}

/**
 * Builds the tree under `rootId` from Drive's flat `files.list` items.
 *
 * Items whose parent is not among them still use your quota, so they go under a virtual
 * "Elsewhere" folder, grouped by where they really are: one virtual folder per folder someone else
 * shared with you (named after `foreignFolders`, id → { name, link, owner }, once known), and
 * "No folder" for files with no parent, or one you cannot open (id → null in `foreignFolders`).
 */
export function buildTree(files, {
  rootId, rootName = 'My Drive', rootLink = 'https://drive.google.com/drive/my-drive', foreignFolders = new Map(),
}) {
  const root = makeNode({ id: rootId, name: rootName, mimeType: FOLDER_MIME, webViewLink: rootLink });
  const byId = new Map([[rootId, root]]);
  for (const file of files) {
    if (file.id !== rootId) byId.set(file.id, makeNode(file));
  }
  let elsewhere = null;
  const groups = new Map();
  function group(parentId) {
    const info = parentId ? foreignFolders.get(parentId) : null;
    const key = info === null ? NO_FOLDER_NAME : parentId;
    if (!groups.has(key)) {
      if (!elsewhere) {
        elsewhere = virtualFolder('__elsewhere__', ELSEWHERE_NAME, null,
          'Files you own outside your folders: in folders other people shared with you, or in no folder. They use your storage too.');
        root.children.push(elsewhere);
      }
      const node = key === NO_FOLDER_NAME
        ? virtualFolder('__no-folder__', NO_FOLDER_NAME, UNORGANIZED_SEARCH,
          'Files you own that are in no folder you can open. Drive finds them with the search is:unorganized owner:me.')
        : virtualFolder(`__shared__${parentId}`, info?.name ?? 'Shared folder', info?.link ?? null,
          info?.owner ? `Your files in a folder ${info.owner} shared with you.` : 'Your files in a folder someone shared with you.');
      groups.set(key, node);
      elsewhere.children.push(node);
    }
    return groups.get(key);
  }
  // Trashed items go to a virtual .Trash, as Drive's trash shows them: what was trashed itself, with
  // its contents, which Drive trashes along with it, still inside.
  let trash = null;
  function trashFolder() {
    if (!trash) {
      trash = virtualFolder('__trash__', TRASH_NAME, DRIVE_TRASH,
        'Files and folders in your Drive trash. They use your storage until the trash is emptied, which Drive does after 30 days.');
      trash.icon = 'trash';
      root.children.push(trash);
    }
    return trash;
  }
  for (const file of files) {
    if (file.id === rootId) continue;
    const node = byId.get(file.id);
    const parentId = file.parents?.[0];
    const parent = byId.get(parentId);
    const destination = node.trashed && !(parent?.isDirectory && parent.trashed)
      ? trashFolder()
      : parent?.isDirectory ? parent : group(parentId);
    destination.children.push(node);
  }
  finalize(root);
  // The root is the drive itself: it counts what it holds, not itself.
  root.usage.folders -= 1;
  return root;
}

/** A folder of the view only, not of Drive: it counts as no folder. */
function virtualFolder(id, name, link, description) {
  const node = makeNode({ id, name, mimeType: FOLDER_MIME, webViewLink: link });
  node.virtual = true;
  node.description = description;
  node.usage.folders = 0;
  return node;
}

function makeNode(file) {
  const isDirectory = file.mimeType === FOLDER_MIME;
  return {
    id: file.id,
    name: file.name ?? '',
    isDirectory,
    mimeType: file.mimeType ?? '',
    link: file.webViewLink ?? null,
    trashed: !!file.trashed,
    virtual: false,
    usage: isDirectory ? { bytes: 0, files: 0, folders: 1 } : { bytes: fileBytes(file), files: 1, folders: 0 },
    children: [],
  };
}

/** Sums usage bottom-up and sorts children largest first, as the treemap layout requires. */
function finalize(node) {
  if (!node.isDirectory) return;
  for (const child of node.children) {
    finalize(child);
    addUsage(node.usage, child.usage);
  }
  node.children.sort(bySize);
}

const bySize = (a, b) => b.usage.bytes - a.usage.bytes;

/**
 * `node` without its trashed items, or null if it is trashed itself. Subtrees with nothing
 * trashed are returned as they are, so the two trees share their nodes.
 */
export function removingTrashed(node) {
  if (node.trashed) return null;
  if (!node.isDirectory || node.children.length === 0) return node;
  const children = [];
  let changed = false;
  for (const child of node.children) {
    const kept = removingTrashed(child);
    if (!kept) {
      changed = true;
      continue;
    }
    if (kept !== child) changed = true;
    children.push(kept);
  }
  if (!changed) return node;
  const usage = { bytes: 0, files: 0, folders: node.usage.folders - sumFolders(node.children) };
  for (const child of children) addUsage(usage, child.usage);
  if (node.virtual && children.length === 0) return null;
  return { ...node, usage, children: children.sort(bySize) };
}

const sumFolders = (nodes) => nodes.reduce((s, n) => s + n.usage.folders, 0);

/** What the view shows of a folder: the node, its direct item count and bytes per category. */
export function scanOf(node) {
  return {
    root: node,
    itemCount: node.children.length,
    bytesByKind: addBytesByKind(node, {}),
  };
}

/** Path of nodes from `root` to the node with `id`, both included, or null. */
export function findPath(root, id) {
  if (root.id === id) return [root];
  if (!root.isDirectory) return null;
  for (const child of root.children) {
    const path = findPath(child, id);
    if (path) return [root, ...path];
  }
  return null;
}
