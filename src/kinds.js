// File categories and colours, after quicker-look's FileKind (UTType rules there, MIME types here).

export const KINDS = ['image', 'video', 'audio', 'archive', 'code', 'document', 'other'];

export const KIND_LABELS = {
  image: 'Images', video: 'Videos', audio: 'Audio', archive: 'Archives',
  code: 'Code', document: 'Documents', other: 'Other',
};

// macOS dark-appearance system colours, as the Quick Look panel draws them.
export const KIND_COLORS = {
  image: '#ff99c4', // hue 0.93, saturation 0.4, brightness 1
  video: '#bf5af2', // systemPurple
  audio: '#ff9f0a', // systemOrange
  archive: '#ac8e68', // systemBrown
  code: '#ffd60a', // systemYellow
  document: '#30d158', // systemGreen
  other: '#b3b3b3', // white 0.7
};

// Azure is reserved for folders (borders, and blocks too small to subdivide): no file colour is blue.
export const FOLDER_COLOR = '#66bfff';
export const SMALL_FILES_COLOR = '#666666';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

const CODE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'jsx', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
  'html', 'htm', 'json', 'xml', 'yaml', 'yml', 'toml', 'plist', 'py', 'rb', 'go', 'rs', 'swift', 'kt',
  'java', 'c', 'h', 'cc', 'cpp', 'hpp', 'm', 'mm', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql', 'r', 'ipynb',
  'lua', 'pl', 'scala', 'dart', 'ex', 'exs', 'clj', 'hs', 'gradle', 'ini', 'cfg', 'conf',
]);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'dmg', 'iso', 'zst', 'lz4']);
const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'txt', 'md', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'key', 'numbers', 'pages',
  'odt', 'ods', 'odp', 'csv', 'tsv', 'epub',
]);

const ARCHIVE_MIMES = [
  'application/zip', 'application/x-zip', 'application/x-tar', 'application/gzip', 'application/x-gzip',
  'application/x-7z-compressed', 'application/x-rar', 'application/vnd.rar', 'application/x-bzip2',
  'application/x-xz', 'application/x-apple-diskimage', 'application/x-iso9660-image', 'application/zstd',
];
const CODE_MIMES = [
  'application/json', 'application/javascript', 'text/javascript', 'application/xml', 'text/xml', 'text/html',
  'text/css', 'application/x-yaml', 'text/x-', 'application/x-sh', 'application/x-python',
  'application/vnd.google-apps.script', 'application/x-ipynb+json',
];
const DOCUMENT_MIMES = [
  'application/pdf', 'text/', 'application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation', 'application/vnd.google-apps.form', 'application/msword',
  'application/vnd.openxmlformats-officedocument', 'application/vnd.ms-', 'application/vnd.oasis.opendocument',
  'application/epub+zip', 'application/rtf', 'application/vnd.apple.',
];

/** Entries are MIME types or prefixes of them (`text/`, `application/vnd.ms-`). */
const matches = (mime, prefixes) => prefixes.some((p) => mime.startsWith(p));

const kindCache = new Map();

/** Category of a Drive file, from its MIME type with the extension as a fallback. Memoised. */
export function fileKind({ name = '', mimeType = '' }) {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  const key = `${mimeType}|${ext}`;
  let kind = kindCache.get(key);
  if (kind) return kind;
  kind = classify(mimeType, ext);
  kindCache.set(key, kind);
  return kind;
}

// First matching rule wins: source code is often text/*, so it must precede documents.
function classify(mime, ext) {
  if (mime.startsWith('image/') || mime === 'application/vnd.google-apps.drawing' || mime === 'application/vnd.google-apps.photo') return 'image';
  if (mime.startsWith('video/') || mime === 'application/vnd.google-apps.video') return 'video';
  if (mime.startsWith('audio/') || mime === 'application/vnd.google-apps.audio') return 'audio';
  if (matches(mime, ARCHIVE_MIMES) || ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
  if (matches(mime, CODE_MIMES) || CODE_EXTENSIONS.has(ext)) return 'code';
  if (matches(mime, DOCUMENT_MIMES) || DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  return 'other';
}

/** Adds the bytes of every file below `node` to its category's total. */
export function addBytesByKind(node, totals) {
  if (node.isDirectory) {
    for (const child of node.children) addBytesByKind(child, totals);
  } else {
    const kind = fileKind(node);
    totals[kind] = (totals[kind] || 0) + node.usage.bytes;
  }
  return totals;
}

/**
 * Top-left to bottom-right with a small hue and brightness shift: vivid rather than shaded,
 * but enough contrast at the edges to separate adjacent tiles of the same colour.
 */
export function cushion(hex) {
  const [h, s, v] = rgbToHsv(...hexToRgb(hex));
  const shifted = (dh, dv) => hsvToCss((h + dh + 1) % 1, Math.min(s * 1.15, 1), Math.min(Math.max(v + dv, 0), 1));
  return [shifted(-0.04, 0.1), shifted(0.04, -0.12)];
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h / 6, max ? d / max : 0, max];
}

function hsvToCss(h, s, v) {
  const f = (n) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `rgb(${f(5)}, ${f(3)}, ${f(1)})`;
}
