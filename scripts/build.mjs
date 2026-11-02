// Builds the static site into _site/ for deployment: `GOOGLE_CLIENT_ID=… node scripts/build.mjs`.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { configScript } from './config.mjs';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '_site');

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const entry of ['index.html', 'style.css', 'src', 'privacy-and-tos']) {
  cpSync(join(root, entry), join(out, entry), { recursive: true });
}
writeFileSync(join(out, 'config.js'), configScript());
console.log(`Built ${out}${process.env.GOOGLE_CLIENT_ID ? '' : ' (no GOOGLE_CLIENT_ID: the page will ask for a client ID)'}`);
