// The Drive as a tree of nodes, after quicker-look's Node.swift.
//
// Node: { id, name, isDirectory, mimeType, link, trashed, virtual,
//         usage: { bytes, files, folders }, children (largest first) }
// A folder's usage is the sum of its subtree, itself included in `folders`.

import { FOLDER_MIME, addBytesByKind } from './kinds.js';
import { addUsage } from './treemap.js';

export const ELSEWHERE_NAME = 'Elsewhere';

/** Bytes a file takes from the storage quota; Google Docs and friends often take none. */
export function fileBytes(file) {
  return Number(file.quotaBytesUsed ?? file.size ?? 0) || 0;
}

/**
 * Builds the tree under `rootId` from Drive's flat `files.list` items. Items whose parent is not
 * among them (files you own inside someone else's folder, or with no parent at all) go under a
 * virtual "Elsewhere" folder, so that the total still matches what counts against the quota.
 */
export function buildTree(files, { rootId, rootName = 'My Drive', rootLink = 'https://drive.google.com/drive/my-drive' }) {
  const root = makeNode({ id: rootId, name: rootName, mimeType: FOLDER_MIME, webViewLink: rootLink });
  const byId = new Map([[rootId, root]]);
  for (const file of files) {
    if (file.id !== rootId) byId.set(file.id, makeNode(file));
  }
  let elsewhere = null;
  for (const file of files) {
    if (file.id === rootId) continue;
    const node = byId.get(file.id);
    const parent = byId.get(file.parents?.[0]);
    if (parent?.isDirectory) {
      parent.children.push(node);
    } else {
      if (!elsewhere) {
        elsewhere = makeNode({ id: '__elsewhere__', name: ELSEWHERE_NAME, mimeType: FOLDER_MIME });
        elsewhere.virtual = true;
        root.children.push(elsewhere);
      }
      elsewhere.children.push(node);
    }
  }
  finalize(root);
  // The root is the drive itself: it counts what it holds, not itself.
  root.usage.folders -= 1;
  return root;
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
