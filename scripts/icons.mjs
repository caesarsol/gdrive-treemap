// Copies the icons src/icons.js uses from Phosphor Icons (MIT, a dev dependency) into assets/icons/.
// Run after changing the icon mapping: `node scripts/icons.mjs`.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// src/icons.js reads import.meta.url, which works in Node too.
const { ICON_NAMES } = await import('../src/icons.js');

// The package's exports hide its assets from require.resolve: read them from node_modules.
const phosphor = resolve(import.meta.dirname, '../node_modules/@phosphor-icons/core');
const out = resolve(import.meta.dirname, '../assets/icons');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const name of ICON_NAMES) {
  const svg = readFileSync(join(phosphor, 'assets/duotone', `${name}-duotone.svg`), 'utf8')
    // A size of their own, which canvas needs to draw them in every browser, and an explicit colour,
    // since currentColor means nothing in an image.
    .replace('<svg ', '<svg width="256" height="256" ')
    .replace('fill="currentColor"', 'fill="#000"');
  writeFileSync(join(out, `${name}.svg`), svg);
}
copyFileSync(join(phosphor, 'LICENSE'), join(out, 'LICENSE'));
console.log(`${ICON_NAMES.length} icons in ${out}`);
