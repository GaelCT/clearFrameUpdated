import { canApprove, sha256Hex } from '../domain/approval';
import { draftCorrectionFromTemplates } from '../domain/correctionTemplates';
import { newId, nowIso } from '../domain/ids';
import { buildRegenerationRequest, regenerationFileName, type RegenerationRequest } from '../domain/regenerationRequest';
import type { Correction } from '../domain/schemas';
import { getProject, mutateProject } from './projectStore';

export function correctionForTake(takeId: string): Correction | null {
  return getProject()?.corrections.find((c) => c.takeId === takeId) ?? null;
}

export function startCorrection(takeId: string): string | null {
  const project = getProject();
  const take = project?.takes.find((t) => t.id === takeId);
  if (!project || !take) return null;
  const existing = project.corrections.find((c) => c.takeId === takeId);
  if (existing) return existing.id;
  const confirmed = project.findings.filter((f) => f.takeId === takeId && f.reviewState === 'confirmed');
  const now = nowIso();
  const correction: Correction = {
    id: newId('cor'),
    shotId: take.shotId,
    takeId,
    originalPrompt: take.generationPrompt,
    draftText: draftCorrectionFromTemplates(take.generationPrompt, confirmed),
    draftSource: 'template',
    addressedFindingIds: confirmed.map((f) => f.id),
    versions: [],
    exports: [],
    createdAt: now,
    updatedAt: now,
  };
  mutateProject((p) => {
    p.corrections.push(correction);
  });
  return correction.id;
}

function withCorrection(id: string, fn: (c: Correction) => void): void {
  mutateProject((p) => {
    const c = p.corrections.find((x) => x.id === id);
    if (c) {
      fn(c as Correction);
      c.updatedAt = nowIso();
    }
  });
}

export function setDraftText(correctionId: string, text: string): void {
  withCorrection(correctionId, (c) => {
    if (c.draftText === text) return;
    c.draftText = text;
    c.draftSource = c.draftSource === 'template' || c.draftSource === 'template-edited' ? 'template-edited' : 'manual';
  });
}

export function redraftFromTemplates(correctionId: string): void {
  const project = getProject();
  const correction = project?.corrections.find((c) => c.id === correctionId);
  if (!project || !correction) return;
  const findings = project.findings.filter((f) => correction.addressedFindingIds.includes(f.id) && f.reviewState === 'confirmed');
  withCorrection(correctionId, (c) => {
    c.draftText = draftCorrectionFromTemplates(c.originalPrompt, findings);
    c.draftSource = 'template';
  });
}

export function setAddressedFindings(correctionId: string, ids: string[]): void {
  withCorrection(correctionId, (c) => {
    c.addressedFindingIds = ids;
  });
}

export function setOriginalPrompt(correctionId: string, prompt: string): void {
  withCorrection(correctionId, (c) => {
    c.originalPrompt = prompt;
  });
}

export async function approveCurrentDraft(correctionId: string): Promise<{ ok: boolean; reasons: string[] }> {
  const project = getProject();
  const correction = project?.corrections.find((c) => c.id === correctionId);
  if (!project || !correction) return { ok: false, reasons: ['Correction not found.'] };
  const findings = project.findings.filter((f) => f.takeId === correction.takeId);
  const check = canApprove(correction, findings);
  if (!check.ok) return check;
  // Snapshot exactly what the reviewer is looking at now.
  const text = correction.draftText;
  const sha = await sha256Hex(text);
  const after = getProject()?.corrections.find((c) => c.id === correctionId);
  if (!after || after.draftText !== text) {
    return { ok: false, reasons: ['The draft changed while approving. Review it and approve again.'] };
  }
  withCorrection(correctionId, (c) => {
    c.versions.push({
      id: newId('pv'),
      number: c.versions.length + 1,
      text,
      originalPrompt: c.originalPrompt,
      addressedFindingIds: [...c.addressedFindingIds],
      draftSource: c.draftSource,
      approvedAt: nowIso(),
      sha256: sha,
    });
  });
  return { ok: true, reasons: [] };
}

export function previewRegenerationRequest(correctionId: string): { request: RegenerationRequest | null; error: string | null } {
  const project = getProject();
  const correction = project?.corrections.find((c) => c.id === correctionId);
  if (!project || !correction) return { request: null, error: 'Correction not found.' };
  try {
    return { request: buildRegenerationRequest(project, correction), error: null };
  } catch (err) {
    return { request: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportRegenerationRequest(correctionId: string): { ok: boolean; error: string | null; fileName?: string } {
  const project = getProject();
  const correction = project?.corrections.find((c) => c.id === correctionId);
  if (!project || !correction) return { ok: false, error: 'Correction not found.' };
  let request: RegenerationRequest;
  try {
    request = buildRegenerationRequest(project, correction);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const fileName = regenerationFileName(project, correction, request.approvedPrompt.version);
  downloadJson(fileName, request);
  withCorrection(correctionId, (c) => {
    c.exports.push({ at: request.exportedAt, versionId: request.approvedPrompt.versionId, requestId: request.requestId, fileName });
  });
  return { ok: true, error: null, fileName };
}
