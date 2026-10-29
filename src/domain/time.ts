/** Formats seconds as mm:ss.cc, or h:mm:ss.cc for clips of an hour or more. */
export function formatTime(totalSec: number | null | undefined, opts: { fraction?: 0 | 1 | 2 | 3 } = {}): string {
  if (totalSec == null || !Number.isFinite(totalSec)) return '--:--';
  const fraction = opts.fraction ?? 2;
  const negative = totalSec < 0;
  const scale = 10 ** fraction;
  // Round once at the target precision so 59.999 becomes 1:00.00, not 0:60.00.
  const ticks = Math.round(Math.abs(totalSec) * scale);
  const wholeSec = Math.floor(ticks / scale);
  const frac = ticks % scale;
  const h = Math.floor(wholeSec / 3600);
  const m = Math.floor((wholeSec % 3600) / 60);
  const s = wholeSec % 60;
  const ss = String(s).padStart(2, '0');
  const fracPart = fraction > 0 ? `.${String(frac).padStart(fraction, '0')}` : '';
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}${fracPart}` : `${String(m).padStart(2, '0')}:${ss}${fracPart}`;
  return negative ? `-${body}` : body;
}

/** Spoken form for screen readers, e.g. "3.25 seconds" or "1 minute 4.5 seconds". */
export function describeTime(totalSec: number): string {
  if (!Number.isFinite(totalSec)) return 'unknown time';
  const m = Math.floor(totalSec / 60);
  const s = Math.round((totalSec - m * 60) * 100) / 100;
  if (m === 0) return `${s} seconds`;
  return `${m} minute${m === 1 ? '' : 's'} ${s} seconds`;
}

/**
 * Parses "12", "12.5", "1:02.25", or "1:02:03.5". Returns null when the input
 * is not a valid non-negative time.
 */
export function parseTime(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  if (!/^\d+(?::\d+){0,2}(?:\.\d+)?$/.test(text)) return null;
  const parts = text.split(':');
  const secondsPart = Number(parts.pop());
  if (!Number.isFinite(secondsPart)) return null;
  let total = secondsPart;
  let multiplier = 60;
  while (parts.length) {
    const value = Number(parts.pop());
    if (!Number.isInteger(value)) return null;
    total += value * multiplier;
    multiplier *= 60;
  }
  // Minutes and seconds fields after the first must be < 60.
  const fields = text.split(':');
  if (fields.length > 1) {
    const last = Number(fields[fields.length - 1]);
    if (last >= 60) return null;
    if (fields.length === 3 && Number(fields[1]) >= 60) return null;
  }
  return total;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return 'Unknown';
  return formatTime(sec, { fraction: sec < 60 ? 2 : 0 });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
