// The page: sign-in, loading, and the treemap view after quicker-look's TreemapPreviewView.swift.

import { ACCOUNT_ID, accountBytes, buildAccount } from './account.js';
import { demoDrive, demoForeignFolders, demoQuota } from './demo.js';
import { fetchAbout, fetchAllFiles, fetchFolderInfo, fetchRoot, requestAccessToken, revokeToken } from './drive.js';
import { formatBytes, formatCount } from './format.js';
import { iconName, iconUrl } from './icons.js';
import { FOLDER_COLOR, KIND_COLORS, KIND_LABELS, SMALL_FILES_COLOR, cushion } from './kinds.js';
import { FOLDER_BORDER, layoutTreemap, pathNames, tileIndexAt } from './treemap.js';
import { DRIVE_TRASH, buildTree, findPath, removingTrashed, scanOf } from './tree.js';

const $ = (id) => document.getElementById(id);

/** Largest icon drawn inside a tile, in px. */
const MAX_ICON_SIDE = 48;
/** Over trashed files' tiles, to set them apart. */
const TRASHED_SHADE = 'rgba(0, 0, 0, 0.35)';
const ICON_OPACITY = 0.9;
const LABEL_FONT_SIZE = 12;
const LABEL_OPACITY = 0.95;
/** The name's distance from the tile's left edge, and from the icon above it. */
const LABEL_PADDING = { left: 10, top: 5 };
/** Under white icons and names, so they read on the light tiles (yellow, pink) too. */
const GLYPH_SHADOW = { color: 'rgba(0, 0, 0, 0.35)', blur: 3, offsetY: 0.5 };
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
  /** Folders you do not own that hold files you own: id → { name, link, owner }, or null. */
  foreignFolders: new Map(),
  // Remembered across visits.
  includeTrashed: storage.get('includeTrashed', true),
  shallow: storage.get('shallow', false),
  /** Show Gmail & Photos, and the free space, next to My Drive, in an account level above it. */
  showMail: storage.get('showMail', true),
  showFree: storage.get('showFree', true),
  /** At the account level rather than in My Drive (when there is an account level). */
  accountView: true,
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

// Google hands a page without a server only short-lived tokens (an hour), never refresh tokens.
// So the token is kept until it expires, and reloading within the hour needs no sign-in; after
// that, the account is remembered, and signing in again is one click on a popup that asks nothing.
const SESSION_KEY = 'session';
const EXPIRY_MARGIN = 60_000;

/** The kept session: `{ token, expiresAt, email }`, any of them possibly missing. */
const session = {
  get: () => storage.get(SESSION_KEY, null) ?? {},
  set: (fields) => storage.set(SESSION_KEY, { ...session.get(), ...fields }),
  clear: () => storage.set(SESSION_KEY, null),
  validToken() {
    const { token, expiresAt } = session.get();
    return token && expiresAt - EXPIRY_MARGIN > Date.now() ? token : null;
  },
};

function showSignIn() {
  const { email } = session.get();
  $('sign-in').textContent = email ? `Continue as ${email}` : 'Sign in with Google';
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
    const { token, expiresAt } = await requestAccessToken(clientId, { hint: session.get().email });
    state.token = token;
    session.set({ token, expiresAt });
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
  if (state.source === 'drive') session.clear();
  showSignIn();
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
  Object.assign(state, {
    source: 'demo', rootId, rootLink: null, files, loading: false, quota: demoQuota(files), zoom: [], accountView: true,
    foreignFolders: demoForeignFolders(),
  });
  $('account-name').textContent = '';
  rebuild();
  showPanel(true);
}

async function startDrive() {
  state.abort?.abort();
  const abort = new AbortController();
  Object.assign(state, {
    source: 'drive', abort, files: [], loading: true, quota: null, zoom: [], accountView: true, withTrashed: null, withoutTrashed: null,
    foreignFolders: new Map(),
  });
  $('account-name').textContent = '';
  showPanel(true);
  try {
    const [about, root] = await Promise.all([fetchAbout(state.token), fetchRoot(state.token)]);
    if (abort.signal.aborted) return;
    state.quota = about.storageQuota;
    $('account-name').textContent = about.user?.emailAddress ?? '';
    if (about.user?.emailAddress) session.set({ email: about.user.emailAddress });
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
    await resolveForeignFolders(abort.signal);
    if (abort.signal.aborted) return;
    state.loading = false;
    rebuild();
  } catch (error) {
    if (error.name === 'AbortError' || abort.signal.aborted) return;
    state.loading = false;
    if (error.status === 401) {
      state.source = null;
      state.token = null;
      session.set({ token: null, expiresAt: null });
      showSignIn();
      showPanel(false);
      showError('Your Google session expired: sign in again.');
    } else {
      render();
      $('caption').textContent = error.message;
    }
  }
}

/** Names the folders other people own that hold your files, a few requests at a time. */
async function resolveForeignFolders(signal) {
  const listed = new Set(state.files.map((f) => f.id));
  const missing = [...new Set(state.files.map((f) => f.parents?.[0]).filter((id) => id && id !== state.rootId && !listed.has(id)))];
  const queue = missing.filter((id) => !state.foreignFolders.has(id));
  async function worker() {
    while (queue.length && !signal.aborted) {
      const id = queue.shift();
      state.foreignFolders.set(id, await fetchFolderInfo(state.token, id));
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
}

function rebuild() {
  state.withTrashed = buildTree(state.files, {
    rootId: state.rootId, rootLink: state.rootLink ?? null, foreignFolders: state.foreignFolders,
  });
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

/** The account level above My Drive, or null when the toggles leave My Drive alone. */
function currentAccount() {
  return buildAccount(currentTree(), state.quota, { mail: state.showMail, free: state.showFree });
}

/**
 * Nodes from the root down to the zoomed folder; the zoom shrinks to what still exists.
 * `state.zoom` holds the ids below My Drive; the account level, when there is one, sits above it.
 */
function zoomPath() {
  const tree = currentTree();
  const path = [tree];
  for (const id of state.zoom) {
    const child = path.at(-1).children.find((c) => c.id === id && c.isDirectory);
    if (!child) break;
    path.push(child);
  }
  const account = currentAccount();
  if (!account) return path;
  return state.accountView ? [account] : [account, ...path];
}

function zoomTo(node) {
  state.hovered = null;
  if (node.id === ACCOUNT_ID) {
    state.accountView = true;
  } else {
    const path = findPath(currentTree(), node.id);
    if (!path) return;
    state.zoom = path.slice(1).map((n) => n.id);
    state.accountView = false;
  }
  render();
}

function zoomOut() {
  if (state.zoom.length === 0 && !(currentAccount() && !state.accountView)) return;
  leaving(() => {
    if (state.zoom.length > 0) state.zoom = state.zoom.slice(0, -1);
    else state.accountView = true;
  });
}

/** Goes to the `i`th node of the current path. */
function zoomToPathIndex(i) {
  const offset = currentAccount() ? 1 : 0;
  leaving(() => {
    if (i < offset) {
      state.accountView = true;
    } else {
      state.accountView = false;
      state.zoom = state.zoom.slice(0, i - offset);
    }
  });
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
      button.addEventListener('click', () => zoomToPathIndex(i));
      crumbs.append(button);
    } else {
      crumbs.append(el('span', { className: 'current', textContent: node.name }));
    }
  });
  if (current.link) {
    const label = current.id === ACCOUNT_ID ? 'Open in Google One ↗' : 'Open in Drive ↗';
    crumbs.append(el('a', { className: 'open', href: inAccount(current.link), target: '_blank', rel: 'noopener', textContent: label }));
  }

  // A folder's usage counts the folder itself; My Drive's already leaves itself out, and virtual
  // folders count as none.
  const folders = current.virtual || current.id === currentTree().id ? total.folders : total.folders - 1;
  $('counts').textContent =
    `${formatCount(current.children.length)} items · ${formatCount(total.files)} files · ${formatCount(folders)} folders`;
  $('description').textContent = current.description ?? '';
  $('description').hidden = !current.description;
  // The account's total is what is used: its free space is not.
  const free = current.id === ACCOUNT_ID ? current.children.find((c) => c.kind === 'free')?.usage.bytes ?? 0 : 0;
  $('total-bytes').textContent = formatBytes(total.bytes - free);
  $('spinner').hidden = !state.loading;
  const trash = state.includeTrashed ? 'trash included' : 'trash excluded';
  const limit = state.quota?.limit ? Number(state.quota.limit) : null;
  $('caption').textContent = state.loading
    ? `listing… ${formatCount(state.files.length)} items so far`
    : current.id === ACCOUNT_ID
      ? `used${limit ? ` of ${formatBytes(limit)}` : ''}, Drive's ${trash}`
      : `owned by you, ${trash}`;
  // The account toggles, when the quota tells what they would show.
  const { mail, free: freeBytes } = accountBytes(state.quota);
  $('mail-toggle').hidden = !(mail > 0);
  $('free-toggle').hidden = !(freeBytes > 0);
  $('show-mail').checked = state.showMail;
  $('show-free').checked = state.showFree;
  $('quota').textContent = state.quota ? quotaText(state.quota) : '';
  $('show-trashed').checked = state.includeTrashed;
  $('shallow').checked = state.shallow;
}

/**
 * The account's storage, which Drive shares with Gmail and Google Photos: the treemap only shows the
 * Drive part, so the rest is named apart.
 */
function quotaText({ limit, usage, usageInDrive }) {
  const used = limit ? `${formatBytes(Number(usage))} of ${formatBytes(Number(limit))} used` : `${formatBytes(Number(usage))} used`;
  if (usageInDrive == null) return used;
  const others = Math.max(0, Number(usage) - Number(usageInDrive));
  return `In Drive ${formatBytes(Number(usageInDrive))} · Gmail & Photos ${formatBytes(others)} · ${used}`;
}

/** Stacked bar of bytes per file category, largest first, with its legend. */
function renderKinds() {
  // Largest first, but the free space last: it is what is left, not a use.
  const kinds = Object.entries(scan.bytesByKind).filter(([, b]) => b > 0)
    .sort((a, b) => (a[0] === 'free') - (b[0] === 'free') || b[1] - a[1]);
  const total = Math.max(1, kinds.reduce((s, [, b]) => s + b, 0));
  const bar = $('kind-bar');
  const legend = $('kind-legend');
  bar.replaceChildren();
  legend.replaceChildren();
  for (const [kind, bytes] of kinds) {
    const segment = el('div', { title: KIND_LABELS[kind] });
    segment.style.width = `${(100 * bytes) / total}%`;
    segment.style.background = kind === 'free' ? 'none' : KIND_COLORS[kind];
    segment.classList.toggle('free', kind === 'free');
    segment.dataset.kind = kind;
    const dot = el('span', { className: 'dot' });
    dot.style.background = kind === 'free' ? 'none' : KIND_COLORS[kind];
    dot.classList.toggle('free', kind === 'free');
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
  const key = [
    state.revision, state.includeTrashed, state.shallow, state.zoom.join('/'), state.accountView, state.showMail,
    state.showFree, JSON.stringify(state.quota), width, height, dpr,
  ].join('|');
  if (key === layoutKey) return;
  layoutKey = key;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  tiles = width > 0 && height > 0 ? layoutTreemap(scan.root, { x: 0, y: 0, w: width, h: height }, { shallow: state.shallow }) : [];
  if (tiles.length && state.hovered >= tiles.length) state.hovered = null;
  // Drawn tiles big enough for an icon (folders too, as in shallow mode).
  icons = [];
  tiles.forEach((tile, index) => {
    const side = Math.min(MAX_ICON_SIDE, Math.min(tile.w, tile.h) - 8);
    if (!tile.isLeaf || !tile.node || tile.bytes <= 0 || side < 16) return;
    // Trashed files keep their type's icon, with a small trash can on it.
    const badge = tile.node.trashed && !tile.node.virtual ? iconUrl('trash') : null;
    icons.push({ index, x: tile.x + 4, y: tile.y + 4, side, src: iconUrl(iconName(tile.node)), badge });
  });
  const empty = !state.loading && scan.root.children.every((c) => c.usage.bytes === 0);
  $('treemap').classList.toggle('empty', empty);
}

function image(src) {
  let img = images.get(src);
  if (!img) {
    img = new Image();
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
  if (zooming) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  tiles.forEach((tile, index) => {
    if (tile.isLeaf) {
      if (tile.bytes <= 0) return;
      if (tile.kind === 'free') {
        // Free space: an empty, dashed outline.
        context.save();
        context.setLineDash([6, 4]);
        strokeInside(tile, 'rgba(255, 255, 255, 0.35)');
        context.restore();
        return;
      }
      paintTile(tile, () => context.rect(tile.x, tile.y, tile.w, tile.h));
    } else if (index > 0) {
      // The border fills the inset that layoutTreemap leaves around the folder's content.
      strokeInside(tile, FOLDER_COLOR);
    }
  });
  // White glyphs, with a soft shadow: they read on every tile colour.
  context.save();
  setGlyphShadow();
  context.globalAlpha = ICON_OPACITY;
  for (const icon of icons) {
    const img = image(icon.src);
    if (img) context.drawImage(img, icon.x, icon.y, icon.side, icon.side);
    const badge = icon.badge && image(icon.badge);
    if (badge) drawBadge(badge, icon);
  }
  context.globalAlpha = 1;
  if (!state.hoveredKind && state.hovered != null) drawLabel(topLevelIndex(state.hovered));
  context.restore();
  // Hovering a bar category outlines all its files; hovering the treemap outlines what a click
  // there opens: the current folder's child under the pointer, not a file deeper inside it.
  const outlined = state.hoveredKind
    ? tiles.filter((t) => t.isLeaf && !t.isDirectory && t.smallFiles === 0 && t.bytes > 0 && t.kind === state.hoveredKind)
    : state.hovered != null ? [tiles[topLevelIndex(state.hovered)]] : [];
  // On a folder this exactly repaints its border in white.
  for (const tile of outlined) strokeInside(tile, 'white');
}

/** Fills `path` (a function tracing it) with the tile's colour: its gradient, darkened if trashed. */
function paintTile(tile, path) {
  const [from, to] = gradientFor(tile);
  const gradient = context.createLinearGradient(tile.x, tile.y, tile.x + tile.w, tile.y + tile.h);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  for (const fill of tile.node?.trashed ? [gradient, TRASHED_SHADE] : [gradient]) {
    context.fillStyle = fill;
    context.beginPath();
    path();
    context.fill();
  }
}

/**
 * A small glyph on the icon's bottom-right corner. The tile's own colour is painted under it first,
 * so the icon does not show through; the glyph's shadow makes a halo around it.
 */
function drawBadge(img, icon) {
  const tile = tiles[icon.index];
  const radius = icon.side * 0.3;
  const cx = icon.x + icon.side - radius * 0.4;
  const cy = icon.y + icon.side - radius * 0.4;
  context.save();
  context.shadowColor = 'transparent';
  context.globalAlpha = 1;
  paintTile(tile, () => context.arc(cx, cy, radius, 0, 2 * Math.PI));
  context.restore();
  const side = radius * 1.5;
  context.drawImage(img, cx - side / 2, cy - side / 2, side, side);
}

function setGlyphShadow() {
  context.shadowColor = GLYPH_SHADOW.color;
  context.shadowBlur = GLYPH_SHADOW.blur;
  context.shadowOffsetY = GLYPH_SHADOW.offsetY;
}

/** The hovered tile's name under its icon, in the icon's colour, when the tile has room for it. */
function drawLabel(index) {
  const icon = icons.find((i) => i.index === index);
  if (!icon) return;
  const tile = tiles[index];
  // Below the badge too, which sticks out of the icon's corner.
  const top = icon.y + icon.side + LABEL_PADDING.top + (icon.badge ? icon.side * 0.18 : 0);
  const left = tile.x + LABEL_PADDING.left;
  const maxWidth = tile.w - LABEL_PADDING.left - 4;
  if (top + LABEL_FONT_SIZE > tile.y + tile.h - 2 || maxWidth < 24) return;
  context.font = `600 ${LABEL_FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  context.textBaseline = 'top';
  context.fillStyle = `rgba(255, 255, 255, ${LABEL_OPACITY})`;
  context.fillText(ellipsize(tile.name, maxWidth), left, top);
}

/** `text` cut to fit `maxWidth` in the current font, with an ellipsis. */
function ellipsize(text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (context.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low)}…`;
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
  canvas.style.cursor = clickAction(index) ? 'pointer' : 'default';
  draw();
  renderStatus();
});

canvas.addEventListener('mouseleave', () => {
  state.hovered = null;
  draw();
  renderStatus();
});

// Entering a folder zooms into it: the folder's tile grows to fill the treemap, its new layout
// drawn in it, while the old view swells around it and fades out. Going up zooms back out.
const ZOOM_DURATION = 300;
let zooming = false;
let zoomFrame = 0;

function zoomInto(tile) {
  const from = { x: tile.x, y: tile.y, w: tile.w, h: tile.h };
  const before = snapshot();
  zoomTo(tile.node);
  const after = before && animates() && snapshot();
  if (after) animateZoom(before, after, from);
}

/**
 * Goes up to an ancestor (`change` updates the zoom), zooming out: the folder left shrinks back
 * into its tile in the ancestor, which settles around it.
 */
function leaving(change) {
  const left = zoomPath().map((node) => node.id);
  const before = snapshot();
  state.hovered = null;
  change();
  render();
  // The ancestor's child that holds the folder left: where it shrinks to.
  const child = left[zoomPath().length];
  const tile = tiles.find((t) => t.parent === 0 && t.node?.id === child);
  const after = before && tile && animates() && snapshot();
  if (after) animateZoom(after, before, tile, { out: true });
}

const animates = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A copy of the canvas as it is drawn now. */
function snapshot() {
  if (!canvas.width || !canvas.height) return null;
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d').drawImage(canvas, 0, 0);
  return copy;
}

/**
 * Animates between a folder's view (`inner`) and its parent's (`outer`), where the folder fills
 * `from`: zooming in, `inner` grows from `from` to the whole treemap while `outer` swells around it
 * and fades out; zooming `out`, the same backwards.
 */
function animateZoom(outer, inner, from, { out = false } = {}) {
  cancelAnimationFrame(zoomFrame);
  zooming = true;
  const width = canvas.width;
  const height = canvas.height;
  // From CSS pixels, which tiles use, to the canvas's own.
  const k = width / canvas.getBoundingClientRect().width;
  const start = { x: from.x * k, y: from.y * k, w: from.w * k, h: from.h * k };
  const startTime = performance.now();
  const ease = (t) => 1 - (1 - t) ** 3;
  const frame = (now) => {
    const t = Math.min(1, (now - startTime) / ZOOM_DURATION);
    const e = out ? 1 - ease(t) : ease(t);
    const r = {
      x: start.x * (1 - e), y: start.y * (1 - e),
      w: start.w + (width - start.w) * e, h: start.h + (height - start.h) * e,
    };
    const sx = r.w / start.w;
    const sy = r.h / start.h;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.globalAlpha = 1 - e;
    context.drawImage(outer, r.x - start.x * sx, r.y - start.y * sy, width * sx, height * sy);
    context.globalAlpha = Math.min(1, 0.35 + e);
    context.drawImage(inner, r.x, r.y, r.w, r.h);
    context.restore();
    if (t < 1) {
      zoomFrame = requestAnimationFrame(frame);
    } else {
      zooming = false;
      draw();
    }
  };
  zoomFrame = requestAnimationFrame(frame);
}

/** The current folder's child that holds tile `index` (the tile itself when it is one). */
function topLevelIndex(index) {
  while (tiles[index].parent > 0) index = tiles[index].parent;
  return index;
}

/**
 * What a click on tile `index` does: anywhere inside a folder enters that folder, one level per
 * click; a file right in the current folder opens that folder in Drive, where it is one click from
 * deletion, as quicker-look reveals a file in Finder. (Drive has no link that also selects the file.)
 */
function clickAction(index) {
  if (index == null) return null;
  const top = tiles[topLevelIndex(index)];
  if (top.isDirectory && top.node) return () => zoomInto(top);
  // The account's blocks: Gmail & Photos opens Google One, the free space does nothing.
  if (top.node?.virtual) return top.node.link ? () => openInAccount(top.node.link) : null;
  const folder = top.smallFiles === 0 && top.node && folderLinkOf(top.node);
  return folder ? () => openInAccount(folder) : null;
}

/**
 * `url` in the signed-in account: with several Google accounts signed in, Google opens its links in
 * the browser's default one unless `authuser` names another.
 */
function inAccount(url) {
  const { email } = session.get();
  if (state.source !== 'drive' || !email) return url;
  try {
    const link = new URL(url);
    if (!/(^|\.)google\.com$/.test(link.hostname)) return url;
    link.searchParams.set('authuser', email);
    return link.href;
  } catch {
    return url;
  }
}

function openInAccount(url) {
  window.open(inAccount(url), '_blank', 'noopener');
}

/** Where Drive shows a file of the current folder: the folder itself, or the trash. */
function folderLinkOf(node) {
  if (node.trashed) return state.source === 'drive' ? DRIVE_TRASH : null;
  return zoomPath().at(-1).link;
}

canvas.addEventListener('click', (event) => clickAction(pointerTile(event))?.());

document.addEventListener('keydown', (event) => {
  if ($('panel').hidden || event.target.closest?.('input, textarea')) return;
  if (event.key === 'Escape' || event.key === 'Backspace') zoomOut();
});

$('show-trashed').addEventListener('change', (event) => {
  state.includeTrashed = event.target.checked;
  storage.set('includeTrashed', state.includeTrashed);
  render();
});

for (const [id, key] of [['show-mail', 'showMail'], ['show-free', 'showFree']]) {
  $(id).addEventListener('change', (event) => {
    state[key] = event.target.checked;
    storage.set(key, state[key]);
    render();
  });
}

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

// For the tests and for sharing: `?demo` opens the demo straight away. Otherwise a token still
// valid from an earlier visit opens the drive straight away.
showSignIn();
if (new URLSearchParams(location.search).has('demo')) {
  startDemo();
} else if (session.validToken()) {
  state.token = session.validToken();
  startDrive();
}
