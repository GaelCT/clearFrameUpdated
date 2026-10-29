export type DiffOp = { type: 'equal' | 'insert' | 'delete'; text: string };

function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Word-level diff using a longest-common-subsequence table. Prompts are short,
 * so the O(n*m) table is fine; very long inputs fall back to a whole-text replace.
 */
export function diffWords(before: string, after: string): DiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    return compact([
      { type: 'delete', text: before },
      { type: 'insert', text: after },
    ]);
  }

  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ type: 'delete', text: a[i] });
      i++;
    } else {
      ops.push({ type: 'insert', text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'delete', text: a[i++] });
  while (j < m) ops.push({ type: 'insert', text: b[j++] });
  return compact(ops);
}

function compact(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (const op of ops) {
    if (!op.text) continue;
    const last = out[out.length - 1];
    if (last && last.type === op.type) last.text += op.text;
    else out.push({ ...op });
  }
  return out;
}

export function diffStats(ops: DiffOp[]): { inserted: number; deleted: number } {
  let inserted = 0;
  let deleted = 0;
  for (const op of ops) {
    const words = op.text.trim() ? op.text.trim().split(/\s+/).length : 0;
    if (op.type === 'insert') inserted += words;
    if (op.type === 'delete') deleted += words;
  }
  return { inserted, deleted };
}
