/** Display formatting. Kept dumb and dependency-free. [dev-toolbar/ext/metrics] */

export const NOT_AVAILABLE = "NA";

export function formatBytes(bytes: number, digits = 0): string {
  if (!Number.isFinite(bytes)) return NOT_AVAILABLE;
  const sign = bytes < 0 ? "-" : "";
  let value = Math.abs(bytes);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = unit === 0 ? 0 : digits;
  return `${sign}${value.toFixed(precision)} ${units[unit] as string}`;
}

/** Signed, for "change over the last minute". */
export function formatBytesDelta(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes)) return NOT_AVAILABLE;
  const formatted = formatBytes(bytes, digits);
  return bytes > 0 ? `+${formatted}` : formatted;
}

export function formatMs(ms: number, digits = 0): string {
  if (!Number.isFinite(ms)) return NOT_AVAILABLE;
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(digits)} ms`;
}

export function formatPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return NOT_AVAILABLE;
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return NOT_AVAILABLE;
  return value.toLocaleString("en-US");
}

/** Trims a redacted URL for the chip/list without hiding the interesting end. */
export function shortenUrl(url: string, max = 64): string {
  if (url.length <= max) return url;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${url.slice(0, head)}…${url.slice(url.length - tail)}`;
}
