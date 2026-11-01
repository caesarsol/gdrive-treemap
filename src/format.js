// Byte counts as macOS's ByteCountFormatter writes them in its `.file` style (decimal units).

const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'];
const DECIMALS = [0, 1, 2, 2, 2];

export function formatBytes(bytes) {
  if (bytes === 0) return 'Zero KB';
  if (Math.abs(bytes) < 1000) return `${bytes} ${Math.abs(bytes) === 1 ? 'byte' : 'bytes'}`;
  let value = bytes / 1000;
  let unit = 0;
  while (Math.abs(value) >= 999.5 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toLocaleString('en-US', { maximumFractionDigits: DECIMALS[unit] })} ${UNITS[unit]}`;
}

export const formatCount = (n) => n.toLocaleString('en-US');
