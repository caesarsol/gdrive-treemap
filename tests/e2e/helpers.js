/**
 * Sweeps the pointer over the treemap until the status line reads `name` (and `folders`, the
 * path above it, when given), and returns that point in page coordinates, or null. It drives the
 * page as a user would, through mousemove events on the canvas, but without waiting between them.
 * Rows are swept a pixel at a time, so a folder's 2px border is never stepped over. Points are
 * whole pixels, as real clicks are, and must hit the canvas itself (not its rounded corners).
 */
export async function findTile(page, { name, folders }) {
  return page.evaluate(({ name, folders }) => {
    const canvas = document.getElementById('canvas');
    const box = canvas.getBoundingClientRect();
    const read = (id) => document.getElementById(id).textContent;
    for (let y = Math.ceil(box.top) + 2; y < box.bottom; y += 6) {
      for (let x = Math.ceil(box.left); x < box.right; x++) {
        canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
        if (read('status-name') === name && (folders === undefined || read('status-folders') === folders)
          && document.elementFromPoint(x, y) === canvas) {
          return { x, y };
        }
      }
    }
    return null;
  }, { name, folders });
}

/** "4.95 GB" → 4950000000: enough to compare totals, which formatBytes rounds. */
export function parseBytes(text) {
  const match = /([\d.,]+)\s*(bytes?|KB|MB|GB|TB|PB)/.exec(text);
  if (!match) return text.includes('Zero') ? 0 : NaN;
  const scale = { byte: 1, bytes: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15 }[match[2]];
  return Number(match[1].replace(/,/g, '')) * scale;
}
