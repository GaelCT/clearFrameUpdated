import type { Draft } from 'immer';
import { newId, nowIso } from '../domain/ids';
import type { BoxAnnotation, DecisionAction, Finding, ReviewState } from '../domain/schemas';
import { formatTime } from '../domain/time';
import { getProject, mutateProject } from './projectStore';
import { selectFinding } from './uiStore';

function record(f: Draft<Finding>, action: DecisionAction, detail: string | null, from: ReviewState | null = null, to: ReviewState | null = null) {
  const at = nowIso();
  f.history.push({ id: newId('evt'), at, action, fromState: from, toState: to, detail });
  f.updatedAt = at;
}

function withFinding(findingId: string, fn: (f: Draft<Finding>) => void): void {
  mutateProject((p) => {
    const f = p.findings.find((x) => x.id === findingId);
    if (f) fn(f);
  });
}

function takeDuration(takeId: string): number | null {
  const p = getProject();
  const take = p?.takes.find((t) => t.id === takeId);
  const asset = take?.assetId ? p?.assets.find((a) => a.id === take.assetId) : undefined;
  return asset?.media.durationSec ?? null;
}

export function normalizeInterval(startSec: number, endSec: number, duration: number | null): [number, number] {
  const max = duration ?? Number.POSITIVE_INFINITY;
  let s = Math.max(0, Math.min(startSec, max));
  let e = Math.max(0, Math.min(endSec, max));
  if (e < s) [s, e] = [e, s];
  return [Math.round(s * 1000) / 1000, Math.round(e * 1000) / 1000];
}

export function addManualFinding(input: {
  takeId: string;
  category: string;
  description: string;
  startSec: number;
  endSec: number;
}): string | null {
  const project = getProject();
  const take = project?.takes.find((t) => t.id === input.takeId);
  if (!project || !take) return null;
  const [startSec, endSec] = normalizeInterval(input.startSec, input.endSec, takeDuration(take.id));
  const now = nowIso();
  const finding: Finding = {
    id: newId('fnd'),
    shotId: take.shotId,
    takeId: take.id,
    runId: null,
    category: input.category,
    description: input.description,
    startSec,
    endSec,
    annotations: [],
    evidenceFrames: [],
    origin: 'manual',
    confidence: null,
    detector: null,
    reviewState: 'candidate',
    notes: '',
    history: [{ id: newId('evt'), at: now, action: 'created', fromState: null, toState: 'candidate', detail: 'Manual finding' }],
    recheckOfFindingId: null,
    createdAt: now,
    updatedAt: now,
  };
  mutateProject((p) => {
    p.findings.push(finding);
  });
  selectFinding(finding.id);
  return finding.id;
}

export function setFindingState(findingId: string, state: ReviewState, detail: string | null = null): void {
  withFinding(findingId, (f) => {
    if (f.reviewState === state) return;
    const from = f.reviewState;
    f.reviewState = state;
    const action: DecisionAction = state === 'confirmed' ? 'confirmed' : state === 'dismissed' ? 'dismissed' : 'reopened';
    record(f, action, detail, from, state);
  });
}

/**
 * Updates a finding's interval. Pass `recordFrom` once an edit is finished
 * (for example at the end of a drag) to log it in the decision history.
 */
export function updateFindingInterval(
  findingId: string,
  startSec: number,
  endSec: number,
  recordFrom?: { startSec: number; endSec: number },
): void {
  const project = getProject();
  const finding = project?.findings.find((f) => f.id === findingId);
  if (!finding) return;
  const [s, e] = normalizeInterval(startSec, endSec, takeDuration(finding.takeId));
  withFinding(findingId, (f) => {
    f.startSec = s;
    f.endSec = e;
    f.updatedAt = nowIso();
    if (recordFrom && (recordFrom.startSec !== s || recordFrom.endSec !== e)) {
      record(
        f,
        'interval-edited',
        `${formatTime(recordFrom.startSec)}–${formatTime(recordFrom.endSec)} → ${formatTime(s)}–${formatTime(e)}`,
      );
    }
  });
}

/** Live description edit while typing, without a history entry. Call updateFindingDetails when done. */
export function setFindingDescriptionDraft(findingId: string, description: string): void {
  withFinding(findingId, (f) => {
    f.description = description;
  });
}

export function updateFindingDetails(findingId: string, patch: { category?: string; description?: string }): void {
  withFinding(findingId, (f) => {
    const changes: string[] = [];
    if (patch.category !== undefined && patch.category !== f.category) {
      changes.push(`category ${f.category} → ${patch.category}`);
      f.category = patch.category;
    }
    if (patch.description !== undefined && patch.description !== f.description) {
      changes.push('description');
      f.description = patch.description;
    }
    if (changes.length) record(f, 'details-edited', `Edited ${changes.join(', ')}`);
  });
}

export function updateFindingNotes(findingId: string, notes: string, recordEdit: boolean): void {
  withFinding(findingId, (f) => {
    if (f.notes === notes && !recordEdit) return;
    f.notes = notes;
    f.updatedAt = nowIso();
    if (recordEdit) record(f, 'notes-edited', notes ? `Notes: “${notes.slice(0, 80)}${notes.length > 80 ? '…' : ''}”` : 'Notes cleared');
  });
}

export function addBoxAnnotation(
  findingId: string,
  rect: { x: number; y: number; w: number; h: number },
  label: string | null,
): void {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const annotation: BoxAnnotation = {
    id: newId('ann'),
    type: 'box',
    x,
    y,
    w: clamp01(Math.min(rect.w, 1 - x)),
    h: clamp01(Math.min(rect.h, 1 - y)),
    startSec: null,
    endSec: null,
    label,
    source: 'manual',
  };
  withFinding(findingId, (f) => {
    f.annotations.push(annotation);
    record(f, 'annotation-added', `Box region${label ? ` “${label}”` : ''}`);
  });
}

export function removeAnnotation(findingId: string, annotationId: string): void {
  withFinding(findingId, (f) => {
    const before = f.annotations.length;
    f.annotations = f.annotations.filter((a) => a.id !== annotationId);
    if (f.annotations.length !== before) record(f, 'annotation-removed', null);
  });
}

export function addEvidenceFrame(findingId: string, timeSec: number, caption: string): void {
  withFinding(findingId, (f) => {
    f.evidenceFrames.push({ id: newId('evf'), timeSec: Math.max(0, timeSec), caption, imageAssetId: null, source: 'manual' });
    f.evidenceFrames.sort((a, b) => a.timeSec - b.timeSec);
    record(f, 'evidence-added', `Frame at ${formatTime(timeSec)}`);
  });
}

export function removeEvidenceFrame(findingId: string, frameId: string): void {
  withFinding(findingId, (f) => {
    f.evidenceFrames = f.evidenceFrames.filter((e) => e.id !== frameId);
    record(f, 'evidence-removed', null);
  });
}

/** Only manual findings can be deleted; analyzer findings are dismissed instead. */
export function deleteManualFinding(findingId: string): void {
  const f = getProject()?.findings.find((x) => x.id === findingId);
  if (!f || f.origin !== 'manual') return;
  mutateProject((p) => {
    p.findings = p.findings.filter((x) => x.id !== findingId);
    for (const c of p.corrections) c.addressedFindingIds = c.addressedFindingIds.filter((id) => id !== findingId);
    for (const t of p.takes) {
      for (const r of t.recheck) if (r.followUpFindingId === findingId) r.followUpFindingId = null;
    }
  });
  selectFinding(null);
}
