// The page: sign-in, loading, and the treemap view after quicker-look's TreemapPreviewView.swift.

import { demoDrive, demoQuota } from './demo.js';
import { fetchAbout, fetchAllFiles, fetchRoot, requestAccessToken, revokeToken } from './drive.js';
import { formatBytes, formatCount } from './format.js';
import { FOLDER_COLOR, KIND_COLORS, KIND_LABELS, SMALL_FILES_COLOR, cushion } from './kinds.js';
import { FOLDER_BORDER, layoutTreemap, pathNames, tileIndexAt } from './treemap.js';
import { buildTree, findPath, removingTrashed, scanOf } from './tree.js';

const $ = (id) => document.getElementById(id);

/** Largest icon drawn inside a tile, in px. */
const MAX_ICON_SIDE = 48;
/** While listing, the tree is rebuilt at most this often (ms): cheap pages, costly rebuilds. */
const REBUILD_INTERVAL = 500;

const KIND_GRADIENTS = Object.fromEntries(Object.entries(KIND_COLORS).map(([k, c]) => [k, cushion(c)]));
const FOLDER_GRADIENT = cushion(FOLDER_COLOR);
const SMALL_FILES_GRADIENT = cushion(SMALL_FILES_COLOR);

const storage = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const state = {
  source: null, // 'drive' | 'demo'
  token: null,
  rootId: null,
  rootLink: undefined,
  files: [],
  /** Both kept, so "Show trashed files" switches instantly instead of rebuilding. */
  withTrashed: null,
  withoutTrashed: null,
  revision: 0,
  loading: false,
  quota: null,
  // Remembered across visits.
  includeTrashed: storage.get('includeTrashed', true),
  shallow: storage.get('shallow', false),
  /** Ids of the folders zoomed into, from the root's child down. */
  zoom: [],
  hovered: null,
  hoveredKind: null,
  abort: null,
};

// ---- Start page -------------------------------------------------------------------------------

const configuredClientId = new URLSearchParams(location.search).get('client_id') || window.DRIVE_TREEMAP?.clientId || '';
$('client-id-field').hidden = !!configuredClientId;
$('setup').hidden = !!configuredClientId;
$('client-id').value = storage.get('clientId', '');
$('origin').textContent = location.origin;

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

$('sign-in-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const clientId = configuredClientId || $('client-id').value.trim();
  if (!clientId) {
    showError('Enter an OAuth client ID first.');
    $('client-id').focus();
    return;
  }
  if (!configuredClientId) storage.set('clientId', clientId);
  showError('');
  try {
    state.token = await requestAccessToken(clientId);
  } catch (error) {
    showError(error.message);
    return;
  }
  startDrive();
});

$('demo').addEventListener('click', () => startDemo());
$('reload').addEventListener('click', () => (state.source === 'demo' ? startDemo() : startDrive()));
$('sign-out').addEventListener('click', () => {
  state.abort?.abort();
  if (state.token) revokeToken(state.token);
  Object.assign(state, { source: null, token: null, files: [], withTrashed: null, withoutTrashed: null, zoom: [], quota: null });
  if (new URLSearchParams(location.search).has('demo')) history.replaceState(null, '', location.pathname);
  showPanel(false);
});

function showPanel(visible) {
  $('welcome').hidden = visible;
  $('panel').hidden = !visible;
  $('account').hidden = !visible;
  $('demo-badge').hidden = state.source !== 'demo';
  $('sign-out').textContent = state.source === 'demo' ? 'Exit demo' : 'Sign out';
  if (visible) render();
}

// ---- Loading ----------------------------------------------------------------------------------

function startDemo() {
  state.abort?.abort();
  const { rootId, files } = demoDrive();
  Object.assign(state, { source: 'demo', rootId, rootLink: null, files, loading: false, quota: demoQuota(files), zoom: [] });
  $('account-name').textContent = '';
  rebuild();
  showPanel(true);
}

async function startDrive() {
  state.abort?.abort();
  const abort = new AbortController();
  Object.assign(state, {
    source: 'drive', abort, files: [], loading: true, quota: null, zoom: [], withTrashed: null, withoutTrashed: null,
  });
  $('account-name').textContent = '';
  showPanel(true);
  try {
    const [about, root] = await Promise.all([fetchAbout(state.token), fetchRoot(state.token)]);
    if (abort.signal.aborted) return;
    state.quota = about.storageQuota;
    $('account-name').textContent = about.user?.emailAddress ?? '';
    Object.assign(state, { rootId: root.id, rootLink: root.webViewLink });
    let lastBuild = 0;
    await fetchAllFiles(state.token, (files, done) => {
      if (abort.signal.aborted) return;
      state.files = files;
      if (done) return;
      const now = performance.now();
      if (now - lastBuild > REBUILD_INTERVAL) {
        lastBuild = now;
        rebuild();
      } else {
        renderHeader();
      }
    }, { signal: abort.signal });
    if (abort.signal.aborted) return;
    state.loading = false;
    rebuild();
  } catch (error) {
    if (error.name === 'AbortError' || abort.signal.aborted) return;
    state.loading = false;
    if (error.status === 401) {
      state.source = null;
      showPanel(false);
      showError('Your Google session expired: sign in again.');
    } else {
      render();
      $('caption').textContent = error.message;
    }
  }
}

function rebuild() {
  state.withTrashed = buildTree(state.files, { rootId: state.rootId, rootLink: state.rootLink ?? null });
  state.withoutTrashed = removingTrashed(state.withTrashed);
  state.revision++;
  render();
}

// ---- What is shown ----------------------------------------------------------------------------

/** The tree the toggles pick; never null, even before anything is listed. */
function currentTree() {
  const tree = state.includeTrashed ? state.withTrashed : state.withoutTrashed;
  return tree ?? buildTree([], { rootId: state.rootId ?? 'root', rootLink: null });
}

/** Nodes from the root down to the zoomed folder; the zoom shrinks to what still exists. */
function zoomPath() {
  const tree = currentTree();
  const path = [tree];
  for (const id of state.zoom) {
    const child = path.at(-1).children.find((c) => c.id === id && c.isDirectory);
    if (!child) break;
    path.push(child);
  }
  return path;
}

function zoomTo(node) {
  const path = findPath(currentTree(), node.id);
  if (!path) return;
  state.zoom = path.slice(1).map((n) => n.id);
  state.hovered = null;
  render();
}

function zoomOut() {
  if (state.zoom.length === 0) return;
  state.zoom = zoomPath().slice(1, -1).map((n) => n.id);
  state.hovered = null;
  render();
}

// ---- Rendering --------------------------------------------------------------------------------

let scan = null;

function render() {
  if ($('panel').hidden) return;
  scan = scanOf(zoomPath().at(-1));
  renderHeader();
  renderKinds();
  layout();
  draw();
  renderStatus();
}

function renderHeader() {
  const path = zoomPath();
  const current = path.at(-1);
  const total = current.usage;

  const crumbs = $('crumbs');
  crumbs.replaceChildren();
  path.forEach((node, i) => {
    if (i > 0) crumbs.append(el('span', { className: 'sep', textContent: '›' }));
    if (i < path.length - 1) {
      const button = el('button', { type: 'button', textContent: node.name });
      button.addEventListener('click', () => {
        state.zoom = state.zoom.slice(0, i);
        render();
      });
      crumbs.append(button);
    } else {
      crumbs.append(el('span', { className: 'current', textContent: node.name }));
    }
  });
  if (current.link) {
    crumbs.append(el('a', { className: 'open', href: current.link, target: '_blank', rel: 'noopener', textContent: 'Open in Drive ↗' }));
  }

  // A folder's usage counts the folder itself; the root's already leaves itself out.
  const folders = path.length > 1 ? total.folders - 1 : total.folders;
  $('counts').textContent =
    `${formatCount(current.children.length)} items · ${formatCount(total.files)} files · ${formatCount(folders)} folders`;
  $('total-bytes').textContent = formatBytes(total.bytes);
  $('spinner').hidden = !state.loading;
  $('caption').textContent = state.loading
    ? `listing… ${formatCount(state.files.length)} items so far`
    : state.includeTrashed ? 'owned by you, trash included' : 'owned by you, trash excluded';
  $('quota').textContent = state.quota
    ? state.quota.limit
      ? `${formatBytes(Number(state.quota.usage))} of ${formatBytes(Number(state.quota.limit))} used`
      : `${formatBytes(Number(state.quota.usage))} used`
    : '';
  $('show-trashed').checked = state.includeTrashed;
  $('shallow').checked = state.shallow;
}

/** Stacked bar of bytes per file category, largest first, with its legend. */
function renderKinds() {
  const kinds = Object.entries(scan.bytesByKind).filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]);
  const total = Math.max(1, kinds.reduce((s, [, b]) => s + b, 0));
  const bar = $('kind-bar');
  const legend = $('kind-legend');
  bar.replaceChildren();
  legend.replaceChildren();
  for (const [kind, bytes] of kinds) {
    const segment = el('div', { title: KIND_LABELS[kind] });
    segment.style.width = `${(100 * bytes) / total}%`;
    segment.style.background = KIND_COLORS[kind];
    segment.dataset.kind = kind;
    const dot = el('span', { className: 'dot' });
    dot.style.background = KIND_COLORS[kind];
    const entry = el('span');
    entry.dataset.kind = kind;
    entry.append(dot, KIND_LABELS[kind], ' ', formatBytes(bytes));
    for (const node of [segment, entry]) {
      node.addEventListener('mouseenter', () => setHoveredKind(kind));
      node.addEventListener('mouseleave', () => state.hoveredKind === kind && setHoveredKind(null));
    }
    bar.append(segment);
    legend.append(entry);
  }
  markHoveredKind();
}

function setHoveredKind(kind) {
  state.hoveredKind = kind;
  markHoveredKind();
  draw();
  renderStatus();
}

function markHoveredKind() {
  for (const node of document.querySelectorAll('[data-kind]')) {
    node.classList.toggle('hovered', node.dataset.kind === state.hoveredKind);
  }
}

// Canvas: laid out again only when the tree, the view or the size changes, not on every hover.
const canvas = $('canvas');
const context = canvas.getContext('2d');
let tiles = [];
let icons = [];
let layoutKey = '';
const images = new Map();

function layout() {
  const box = $('treemap').getBoundingClientRect();
  const width = Math.floor(box.width);
  const height = Math.floor(box.height);
  const dpr = window.devicePixelRatio || 1;
  const key = [state.revision, state.includeTrashed, state.shallow, state.zoom.join('/'), width, height, dpr].join('|');
  if (key === layoutKey) return;
  layoutKey = key;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  tiles = width > 0 && height > 0 ? layoutTreemap(scan.root, { x: 0, y: 0, w: width, h: height }, { shallow: state.shallow }) : [];
  if (tiles.length && state.hovered >= tiles.length) state.hovered = null;
  // Drawn tiles big enough for an icon (folders too, as in shallow mode).
  icons = [];
  for (const tile of tiles) {
    const side = Math.min(MAX_ICON_SIDE, Math.min(tile.w, tile.h) - 8);
    const src = tile.node?.iconLink;
    if (!tile.isLeaf || tile.smallFiles > 0 || side < 16 || !src) continue;
    icons.push({ x: tile.x + 4, y: tile.y + 4, side, src: iconSource(src, side) });
  }
  const empty = !state.loading && scan.root.children.every((c) => c.usage.bytes === 0);
  $('treemap').classList.toggle('empty', empty);
}

/** Drive's icon links name their size (`…/16/type/…`): ask for one sharp at this device's scale. */
function iconSource(link, side) {
  const px = side * (window.devicePixelRatio || 1) > 32 ? 64 : 32;
  return link.replace(/\/16\//, `/${px}/`);
}

function image(src) {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => draw();
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function gradientFor(tile) {
  if (tile.smallFiles > 0) return SMALL_FILES_GRADIENT;
  return tile.isDirectory ? FOLDER_GRADIENT : KIND_GRADIENTS[tile.kind];
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  tiles.forEach((tile, index) => {
    if (tile.isLeaf) {
      if (tile.bytes <= 0) return;
      const [from, to] = gradientFor(tile);
      const gradient = context.createLinearGradient(tile.x, tile.y, tile.x + tile.w, tile.y + tile.h);
      gradient.addColorStop(0, from);
      gradient.addColorStop(1, to);
      context.fillStyle = gradient;
      context.fillRect(tile.x, tile.y, tile.w, tile.h);
    } else if (index > 0) {
      // The border fills the inset that layoutTreemap leaves around the folder's content.
      strokeInside(tile, FOLDER_COLOR);
    }
  });
  for (const icon of icons) {
    const img = image(icon.src);
    if (img) context.drawImage(img, icon.x, icon.y, icon.side, icon.side);
  }
  // Hovering a bar category outlines all its files as if each were hovered.
  const outlined = state.hoveredKind
    ? tiles.filter((t) => t.isLeaf && !t.isDirectory && t.smallFiles === 0 && t.bytes > 0 && t.kind === state.hoveredKind)
    : state.hovered != null ? [tiles[state.hovered]] : [];
  // On a hovered folder this exactly repaints its border in white.
  for (const tile of outlined) strokeInside(tile, 'white');
}

function strokeInside(tile, color) {
  const half = FOLDER_BORDER / 2;
  context.strokeStyle = color;
  context.lineWidth = FOLDER_BORDER;
  context.strokeRect(tile.x + half, tile.y + half, Math.max(0, tile.w - FOLDER_BORDER), Math.max(0, tile.h - FOLDER_BORDER));
}

/** Name and size of the hovered tile or bar category; blank but still sized otherwise. */
function renderStatus() {
  let folders = '';
  let name = ' ';
  let detail = '';
  if (state.hoveredKind) {
    name = KIND_LABELS[state.hoveredKind];
    detail = formatBytes(scan.bytesByKind[state.hoveredKind] ?? 0);
  } else if (state.hovered != null && state.hovered < tiles.length) {
    const tile = tiles[state.hovered];
    const names = pathNames(state.hovered, tiles);
    folders = names.slice(0, -1).map((n) => `${n}/`).join('');
    name = names.at(-1) || ' ';
    detail = formatBytes(tile.bytes);
    if (tile.smallFiles > 0) {
      name = `${formatCount(tile.smallFiles)} small ${tile.smallFiles === 1 ? 'file' : 'files'}`;
      detail = `${formatBytes(tile.bytes)} · ~${formatBytes(Math.round(tile.bytes / tile.smallFiles))} each`;
    } else if (tile.node?.trashed) {
      detail += ' · in trash';
    }
  }
  $('status-folders').textContent = folders;
  $('status-name').textContent = name;
  $('status-detail').textContent = detail;
}

// ---- Interaction ------------------------------------------------------------------------------

function pointerTile(event) {
  const box = canvas.getBoundingClientRect();
  return tileIndexAt(event.clientX - box.left, event.clientY - box.top, tiles);
}

canvas.addEventListener('mousemove', (event) => {
  const index = pointerTile(event);
  if (index === state.hovered) return;
  state.hovered = index;
  const tile = index != null ? tiles[index] : null;
  canvas.style.cursor = tile && (tile.node?.link || tile.isDirectory || tile.smallFiles) ? 'pointer' : 'default';
  draw();
  renderStatus();
});

canvas.addEventListener('mouseleave', () => {
  state.hovered = null;
  draw();
  renderStatus();
});

// Folders (their border, or their block when too small to subdivide) zoom in; the small-files
// tile zooms into its folder; files open in Drive, as quicker-look reveals them in Finder.
canvas.addEventListener('click', (event) => {
  const index = pointerTile(event);
  if (index == null) return;
  const tile = tiles[index];
  if (tile.isDirectory && tile.node) {
    zoomTo(tile.node);
  } else if (tile.smallFiles > 0) {
    if (tile.parent > 0) zoomTo(tiles[tile.parent].node);
  } else if (tile.node?.link) {
    window.open(tile.node.link, '_blank', 'noopener');
  }
});

document.addEventListener('keydown', (event) => {
  if ($('panel').hidden || event.target.closest?.('input, textarea')) return;
  if (event.key === 'Escape' || event.key === 'Backspace') zoomOut();
});

$('show-trashed').addEventListener('change', (event) => {
  state.includeTrashed = event.target.checked;
  storage.set('includeTrashed', state.includeTrashed);
  render();
});

$('shallow').addEventListener('change', (event) => {
  state.shallow = event.target.checked;
  storage.set('shallow', state.shallow);
  render();
});

new ResizeObserver(() => {
  if (!$('panel').hidden && scan) {
    layout();
    draw();
  }
}).observe($('treemap'));

function el(tag, props = {}) {
  return Object.assign(document.createElement(tag), props);
}

// For the tests and for sharing: `?demo` opens the demo straight away.
if (new URLSearchParams(location.search).has('demo')) startDemo();
