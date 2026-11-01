// Squarified treemap layout, ported from quicker-look's TreemapPreview/Treemap.swift.

import { fileKind } from './kinds.js';

/** Width of the border drawn around each folder's content. */
export const FOLDER_BORDER = 2;
/** Folders smaller than this (px) are drawn as a single block. */
const MIN_FOLDER_SIDE = 8;
/** Items whose share of their folder is smaller than this (square px) join the small-files tile. */
const MIN_ITEM_AREA = 4;

/**
 * Lays out `root` in `bounds` ({x, y, w, h}). Returns tiles, parents before children; `parent`
 * indexes the same array (-1 for the root). `shallow` draws the root's children as single blocks.
 *
 * Tile: { x, y, w, h, node, name, bytes, parent, isLeaf, isDirectory, kind, smallFiles }
 * `node` is null for the merged small-files tile, whose `smallFiles` counts the files it stands for.
 */
export function layoutTreemap(root, bounds, { shallow = false } = {}) {
  const tiles = [];
  function visit(node, rect, parent) {
    const index = tiles.length;
    const isLeaf = node.children.length === 0 || Math.min(rect.w, rect.h) < MIN_FOLDER_SIDE || (shallow && parent >= 0);
    tiles.push({
      ...rect, node, name: node.name, bytes: node.usage.bytes, parent, isLeaf,
      isDirectory: node.isDirectory, kind: node.isDirectory ? 'other' : fileKind(node), smallFiles: 0,
    });
    if (isLeaf) return;
    const kids = node.children.filter((c) => c.usage.bytes > 0);
    const inner = parent < 0 ? rect : inset(rect, FOLDER_BORDER);
    // Children come largest first: once one is too small to see, so is the rest. Merged into one
    // tile, they keep their area, which would otherwise stay an empty hole.
    const total = kids.reduce((s, c) => s + c.usage.bytes, 0);
    const pxPerByte = (inner.w * inner.h) / Math.max(1, total);
    let shownCount = 0;
    while (shownCount < kids.length && kids[shownCount].usage.bytes * pxPerByte >= MIN_ITEM_AREA) shownCount++;
    const items = kids.slice(0, shownCount).map((c) => ({ node: c, usage: c.usage }));
    if (shownCount < kids.length) {
      const rest = { bytes: 0, files: 0, folders: 0 };
      for (const c of kids.slice(shownCount)) addUsage(rest, c.usage);
      items.push({ node: null, usage: rest });
      items.sort((a, b) => b.usage.bytes - a.usage.bytes);
    }
    const rects = squarify(items.map((i) => i.usage.bytes), inner);
    rects.forEach((r, i) => {
      if (r.w < 1 || r.h < 1) return;
      const item = items[i];
      if (item.node) {
        visit(item.node, r, index);
      } else {
        tiles.push({
          ...r, node: null, name: '', bytes: item.usage.bytes, parent: index, isLeaf: true,
          isDirectory: false, kind: 'other', smallFiles: item.usage.files,
        });
      }
    });
  }
  visit(root, bounds, -1);
  return tiles;
}

export function addUsage(into, usage) {
  into.bytes += usage.bytes;
  into.files += usage.files;
  into.folders += usage.folders;
}

export function inset(r, d) {
  return { x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) };
}

/** Names from the root's child down to `index`, root excluded. */
export function pathNames(index, tiles) {
  const names = [];
  for (let i = index; i > 0; i = tiles[i].parent) names.push(tiles[i].name);
  return names.reverse();
}

/**
 * The tile under (x, y): a drawn tile, or a folder when the point is on its border.
 * The last match is the deepest, since children follow their parents; the root has no border.
 */
export function tileIndexAt(x, y, tiles) {
  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i];
    if (t.bytes > 0 && x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return i === 0 ? null : i;
  }
  return null;
}

/** Squarified treemap (Bruls, Huizing, van Wijk 2000); `sizes` must be sorted largest first. */
export function squarify(sizes, rect) {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!(total > 0) || rect.w <= 0 || rect.h <= 0) return [];
  const areas = sizes.map((s) => (s * rect.w * rect.h) / total);
  const rects = [];
  let free = { ...rect };
  let start = 0;
  while (start < areas.length) {
    // Grow the row while it keeps its rectangles closer to squares.
    const side = Math.min(free.w, free.h);
    let end = start + 1;
    let sum = areas[start];
    while (end < areas.length) {
      const grown = sum + areas[end];
      if (worstRatio(areas[start], areas[end], grown, side) > worstRatio(areas[start], areas[end - 1], sum, side)) break;
      sum = grown;
      end++;
    }
    // Lay the row along the shorter side, then shrink the free rectangle.
    if (free.w >= free.h) {
      const width = sum / free.h;
      let y = free.y;
      for (let i = start; i < end; i++) {
        rects.push({ x: free.x, y, w: width, h: areas[i] / width });
        y += areas[i] / width;
      }
      free = { x: free.x + width, y: free.y, w: free.w - width, h: free.h };
    } else {
      const height = sum / free.w;
      let x = free.x;
      for (let i = start; i < end; i++) {
        rects.push({ x, y: free.y, w: areas[i] / height, h: height });
        x += areas[i] / height;
      }
      free = { x: free.x, y: free.y + height, w: free.w, h: free.h - height };
    }
    start = end;
  }
  return rects;
}

function worstRatio(largest, smallest, sum, side) {
  const side2 = side * side;
  const sum2 = sum * sum;
  return Math.max((side2 * largest) / sum2, sum2 / (side2 * smallest));
}
