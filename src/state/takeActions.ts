import { latestVersion } from '../domain/approval';
import { categoryLabel } from '../domain/categories';
import { newId, nowIso } from '../domain/ids';
import type { Finding, RecheckStatus } from '../domain/schemas';
import { nextTakeNumber } from '../domain/status';
import { registerBlob } from '../media/mediaRegistry';
import { getProject, mutateProject } from './projectStore';
import { persistAssetBlob, probeWithProgress } from './mediaActions';
import { selectTake } from './uiStore';

/**
 * Imports a regenerated video as a new take linked to its parent take and,
 * when available, the approved prompt version it was generated from.
 * Earlier confirmed findings are queued for re-check; none are marked fixed.
 */
export async function importRetake(
  parentTakeId: string,
  file: File,
  link: { correctionId: string | null; versionId: string | null },
): Promise<{ ok: boolean; message: string | null; takeId?: string }> {
  const probe = await probeWithProgress(file);
  if (!probe.accepted) return { ok: false, message: probe.rejectReason };
  const project = getProject();
  const parent = project?.takes.find((t) => t.id === parentTakeId);
  if (!project || !parent) return { ok: false, message: 'The parent take no longer exists.' };
  const correction = link.correctionId ? project.corrections.find((c) => c.id === link.correctionId) : undefined;
  const version = correction?.versions.find((v) => v.id === link.versionId) ?? null;
  const parentConfirmed = project.findings.filter((f) => f.takeId === parentTakeId && f.reviewState === 'confirmed');
  const assetId = newId('ast');
  const takeId = newId('tk');
  registerBlob(assetId, file);
  const dot = file.name.lastIndexOf('.');
  mutateProject((p) => {
    p.assets.push({
      id: assetId,
      kind: 'generated',
      displayName: dot > 0 ? file.name.slice(0, dot) : file.name,
      fileName: file.name,
      mimeType: probe.mimeType || file.type,
      sizeBytes: file.size,
      lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null,
      importedAt: nowIso(),
      storage: 'session-only',
      storageError: null,
      bundledUrl: null,
      backendAssetId: null,
      backendAdapterId: null,
      media: probe.media,
      playback: probe.playback,
    });
    p.takes.push({
      id: takeId,
      shotId: parent.shotId,
      number: nextTakeNumber(p as typeof project, parent.shotId),
      assetId,
      generationPrompt: version?.text ?? parent.generationPrompt,
      parentTakeId,
      correctionId: correction?.id ?? null,
      promptVersionId: version?.id ?? null,
      recheck: parentConfirmed.map((f) => ({
        parentFindingId: f.id,
        status: 'pending' as const,
        note: '',
        decidedAt: null,
        followUpFindingId: null,
      })),
      acceptance: null,
      acceptanceHistory: [],
      createdAt: nowIso(),
    });
  });
  // Persist via the same path as other imports (sets storage status).
  void persistAssetBlob(assetId, file);
  selectTake(parent.shotId, takeId);
  return { ok: true, message: probe.playback.message, takeId };
}

export function defaultRetakeLink(parentTakeId: string): { correctionId: string | null; versionId: string | null } {
  const correction = getProject()?.corrections.find((c) => c.takeId === parentTakeId);
  const version = correction ? latestVersion(correction) : null;
  return { correctionId: correction?.id ?? null, versionId: version?.id ?? null };
}

export function setRecheckStatus(takeId: string, parentFindingId: string, status: RecheckStatus, note?: string): void {
  const project = getProject();
  const take = project?.takes.find((t) => t.id === takeId);
  const parentFinding = project?.findings.find((f) => f.id === parentFindingId);
  if (!project || !take || !parentFinding) return;
  const item = take.recheck.find((r) => r.parentFindingId === parentFindingId);
  if (!item) return;
  let followUp: Finding | null = null;
  if (status === 'still-present' && !item.followUpFindingId) {
    const now = nowIso();
    followUp = {
      id: newId('fnd'),
      shotId: take.shotId,
      takeId,
      runId: null,
      category: parentFinding.category,
      description: `Still present after retake: ${parentFinding.description || categoryLabel(parentFinding.category)}`,
      startSec: parentFinding.startSec,
      endSec: parentFinding.endSec,
      annotations: [],
      evidenceFrames: [],
      origin: 'manual',
      confidence: null,
      detector: null,
      reviewState: 'confirmed',
      notes: note ?? '',
      history: [
        { id: newId('evt'), at: now, action: 'created', fromState: null, toState: 'candidate', detail: 'Re-check: issue persists' },
        { id: newId('evt'), at: now, action: 'confirmed', fromState: 'candidate', toState: 'confirmed', detail: 'Confirmed during re-check' },
      ],
      recheckOfFindingId: parentFindingId,
      createdAt: now,
      updatedAt: now,
    };
  }
  mutateProject((p) => {
    const t = p.takes.find((x) => x.id === takeId);
    const r = t?.recheck.find((x) => x.parentFindingId === parentFindingId);
    if (!t || !r) return;
    r.status = status;
    r.decidedAt = status === 'pending' ? null : nowIso();
    if (note !== undefined) r.note = note;
    if (followUp) {
      p.findings.push(followUp);
      r.followUpFindingId = followUp.id;
    }
  });
}

export function setRecheckNote(takeId: string, parentFindingId: string, note: string): void {
  mutateProject((p) => {
    const r = p.takes.find((x) => x.id === takeId)?.recheck.find((x) => x.parentFindingId === parentFindingId);
    if (r) r.note = note;
  });
}

export interface AcceptanceCheck {
  blockers: string[];
  warnings: string[];
}

export function acceptanceCheck(takeId: string): AcceptanceCheck {
  const project = getProject();
  const take = project?.takes.find((t) => t.id === takeId);
  if (!project || !take) return { blockers: ['Take not found.'], warnings: [] };
  const findings = project.findings.filter((f) => f.takeId === takeId);
  const runs = project.runs.filter((r) => r.takeId === takeId);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const candidates = findings.filter((f) => f.reviewState === 'candidate').length;
  if (candidates) blockers.push(`${candidates} candidate finding${candidates === 1 ? ' needs' : 's need'} a decision.`);
  const pending = take.recheck.filter((r) => r.status === 'pending').length;
  if (pending) blockers.push(`${pending} earlier finding${pending === 1 ? '' : 's'} from the parent take still need${pending === 1 ? 's' : ''} a re-check.`);
  if (runs.some((r) => r.status === 'running' || r.status === 'queued')) blockers.push('A review is still running.');
  const confirmed = findings.filter((f) => f.reviewState === 'confirmed').length;
  if (confirmed) warnings.push(`${confirmed} confirmed issue${confirmed === 1 ? ' remains' : 's remain'} on this take.`);
  const completed = runs.filter((r) => r.status === 'completed');
  if (completed.length === 0) warnings.push('No review run has completed on this take. Acceptance rests on your manual review.');
  else if (completed.every((r) => r.simulated)) {
    warnings.push('Only simulated (demo) review runs have completed on this take. No real analysis has been performed.');
  }
  const asset = take.assetId ? project.assets.find((a) => a.id === take.assetId) : undefined;
  if (asset?.playback.status === 'unsupported') warnings.push('This take’s file cannot be played in this browser.');
  return { blockers, warnings };
}

export function acceptTake(takeId: string, note: string): boolean {
  if (acceptanceCheck(takeId).blockers.length) return false;
  mutateProject((p) => {
    const t = p.takes.find((x) => x.id === takeId);
    if (!t) return;
    const at = nowIso();
    t.acceptance = { acceptedAt: at, note };
    t.acceptanceHistory.push({ at, action: 'accepted', note });
  });
  return true;
}

export function reopenTake(takeId: string, note: string): void {
  mutateProject((p) => {
    const t = p.takes.find((x) => x.id === takeId);
    if (!t || !t.acceptance) return;
    t.acceptance = null;
    t.acceptanceHistory.push({ at: nowIso(), action: 'reopened', note });
  });
}
