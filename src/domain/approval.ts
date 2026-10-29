import type { Correction, Finding, PromptVersion } from './schemas';

export type ApprovalState =
  | { kind: 'none' }
  | { kind: 'current'; version: PromptVersion }
  | { kind: 'stale'; version: PromptVersion; reasons: string[] };

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

export function latestVersion(correction: Correction): PromptVersion | null {
  return correction.versions.length ? correction.versions[correction.versions.length - 1] : null;
}

/**
 * An approval is only valid for the exact text and finding list that was
 * reviewed. Any later edit, or a change in the addressed findings' decisions,
 * makes it stale and requires a fresh approval.
 */
export function getApprovalState(correction: Correction, findings: readonly Finding[]): ApprovalState {
  const version = latestVersion(correction);
  if (!version) return { kind: 'none' };
  const reasons: string[] = [];
  if (version.text !== correction.draftText) reasons.push('The proposed prompt was edited after approval.');
  if (version.originalPrompt !== correction.originalPrompt) reasons.push('The original prompt changed after approval.');
  if (!sameSet(version.addressedFindingIds, correction.addressedFindingIds)) {
    reasons.push('The set of addressed findings changed after approval.');
  }
  const byId = new Map(findings.map((f) => [f.id, f]));
  const noLongerConfirmed = version.addressedFindingIds.filter((id) => byId.get(id)?.reviewState !== 'confirmed');
  if (noLongerConfirmed.length) {
    reasons.push(
      noLongerConfirmed.length === 1
        ? 'An addressed finding is no longer confirmed.'
        : `${noLongerConfirmed.length} addressed findings are no longer confirmed.`,
    );
  }
  return reasons.length ? { kind: 'stale', version, reasons } : { kind: 'current', version };
}

export function canApprove(correction: Correction, findings: readonly Finding[]): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!correction.draftText.trim()) reasons.push('Write a proposed prompt first.');
  const byId = new Map(findings.map((f) => [f.id, f]));
  const confirmed = correction.addressedFindingIds.filter((id) => byId.get(id)?.reviewState === 'confirmed');
  if (confirmed.length === 0) reasons.push('Select at least one confirmed finding that this correction addresses.');
  if (confirmed.length !== correction.addressedFindingIds.length) {
    reasons.push('Remove findings that are no longer confirmed from the addressed list.');
  }
  const state = getApprovalState(correction, findings);
  if (state.kind === 'current') reasons.push('This exact version is already approved.');
  return { ok: reasons.length === 0, reasons };
}

export async function sha256Hex(text: string): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
