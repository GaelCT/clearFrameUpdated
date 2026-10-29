export type IdPrefix = 'prj' | 'ast' | 'sht' | 'tk' | 'run' | 'fnd' | 'cor' | 'pv' | 'ann' | 'evf' | 'evt' | 'req';

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts. IDs only need to be unique locally.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}-${uuid()}`;
}

/** Short form for display. The full ID is always used in data and exports. */
export function shortId(id: string): string {
  const dash = id.indexOf('-');
  if (dash < 0) return id.slice(0, 8);
  return `${id.slice(0, dash)}-${id.slice(dash + 1, dash + 7)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
