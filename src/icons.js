// Icons drawn in the treemap's tiles: Phosphor Icons (duotone), vendored in assets/icons/ by
// scripts/icons.mjs. One per file type, from the extension, then the MIME type, then the category.

import { fileKind } from './kinds.js';

export const ICON_DIR = new URL('../assets/icons/', import.meta.url).href;

const BY_EXTENSION = {
  pdf: 'file-pdf',
  doc: 'file-doc', docx: 'file-doc', odt: 'file-doc', rtf: 'file-doc', pages: 'file-doc',
  xls: 'file-xls', xlsx: 'file-xls', ods: 'file-xls', numbers: 'file-xls',
  csv: 'file-csv', tsv: 'file-csv',
  ppt: 'file-ppt', pptx: 'file-ppt', odp: 'file-ppt', key: 'file-ppt',
  txt: 'file-txt', log: 'file-txt',
  md: 'file-md', markdown: 'file-md',
  epub: 'book-open', mobi: 'book-open',
  jpg: 'file-jpg', jpeg: 'file-jpg',
  png: 'file-png',
  svg: 'file-svg',
  psd: 'pen-nib', ai: 'pen-nib', sketch: 'pen-nib', fig: 'pen-nib', xd: 'pen-nib', afdesign: 'pen-nib', indd: 'pen-nib',
  obj: 'cube', stl: 'cube', fbx: 'cube', blend: 'cube', glb: 'cube', gltf: 'cube', '3ds': 'cube', c4d: 'cube',
  srt: 'subtitles', vtt: 'subtitles', ass: 'subtitles',
  zip: 'file-zip', tar: 'file-zip', gz: 'file-zip', tgz: 'file-zip', bz2: 'file-zip', xz: 'file-zip', '7z': 'file-zip', rar: 'file-zip', zst: 'file-zip',
  dmg: 'disc', iso: 'disc', img: 'disc',
  exe: 'app-window', msi: 'app-window', app: 'app-window', apk: 'app-window', ipa: 'app-window', deb: 'app-window', pkg: 'app-window',
  ttf: 'text-aa', otf: 'text-aa', woff: 'text-aa', woff2: 'text-aa',
  html: 'file-html', htm: 'file-html',
  css: 'file-css', scss: 'file-css', sass: 'file-css', less: 'file-css',
  js: 'file-js', mjs: 'file-js', cjs: 'file-js',
  jsx: 'file-jsx',
  ts: 'file-ts', mts: 'file-ts', cts: 'file-ts',
  tsx: 'file-tsx',
  py: 'file-py',
  rs: 'file-rs',
  c: 'file-c', h: 'file-c',
  cpp: 'file-cpp', cc: 'file-cpp', hpp: 'file-cpp',
  sql: 'file-sql',
  vue: 'file-vue',
  ini: 'file-ini', cfg: 'file-ini', conf: 'file-ini', toml: 'file-ini', yaml: 'file-ini', yml: 'file-ini', env: 'file-ini', plist: 'file-ini',
  sh: 'terminal-window', bash: 'terminal-window', zsh: 'terminal-window', ps1: 'terminal-window', bat: 'terminal-window',
  ipynb: 'notebook',
  db: 'database', sqlite: 'database', sqlite3: 'database', mdb: 'database', accdb: 'database',
  pem: 'key', crt: 'key', p12: 'key', pfx: 'key', gpg: 'key', asc: 'key',
  eml: 'envelope-simple', msg: 'envelope-simple', mbox: 'envelope-simple',
  ics: 'calendar-blank',
  lock: 'file-lock',
};

const BY_MIME = {
  'application/vnd.google-apps.document': 'file-doc',
  'application/vnd.google-apps.spreadsheet': 'file-xls',
  'application/vnd.google-apps.presentation': 'file-ppt',
  'application/vnd.google-apps.form': 'list-checks',
  'application/vnd.google-apps.drawing': 'pencil-simple',
  'application/vnd.google-apps.site': 'file-html',
  'application/vnd.google-apps.script': 'file-code',
  'application/pdf': 'file-pdf',
  'image/jpeg': 'file-jpg',
  'image/png': 'file-png',
  'image/svg+xml': 'file-svg',
};

const BY_KIND = {
  image: 'file-image', video: 'file-video', audio: 'file-audio', archive: 'file-zip',
  code: 'file-code', document: 'file-text', other: 'file',
};

/** Every icon name the app may draw: scripts/icons.mjs vendors exactly these. */
export const ICON_NAMES = [...new Set([
  'folder', 'folder-user', 'folder-dashed', 'envelope-simple', 'circle-dashed', ...Object.values(BY_EXTENSION), ...Object.values(BY_MIME), ...Object.values(BY_KIND),
])].sort();

/** The icon for a tree node: its type's, or a folder: someone else's for Elsewhere and its shared
 * folders, a dashed one for "No folder". */
export function iconName(node) {
  if (node.icon) return node.icon;
  if (node.isDirectory) return node.virtual ? (node.id === '__no-folder__' ? 'folder-dashed' : 'folder-user') : 'folder';
  const name = node.name ?? '';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return BY_EXTENSION[ext] ?? BY_MIME[node.mimeType] ?? BY_KIND[fileKind(node)];
}

export const iconUrl = (name) => `${ICON_DIR}${name}.svg`;
