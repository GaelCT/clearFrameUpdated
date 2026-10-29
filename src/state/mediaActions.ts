import { create } from 'zustand';
import { newId, nowIso } from '../domain/ids';
import type { Asset, AssetKind, Project, Take } from '../domain/schemas';
import { nextTakeNumber } from '../domain/status';
import { getSessionBlob, registerBlob, releaseAsset } from '../media/mediaRegistry';
import { probeVideoFile, type ProbeOutcome } from '../media/probe';
import { deleteBlobs, saveBlob } from '../persistence/repository';
import { getProject, mutateProject, useStorageHealth } from './projectStore';
import { useSettings } from './settingsStore';
import { pushToast } from './toastStore';
import { selectTake } from './uiStore';

/** Assets whose blob is currently being written to browser storage. */
export const usePersisting = create<{ ids: Record<string, true> }>(() => ({ ids: {} }));

/** Files being probed right now, for import progress. */
export const useImportProgress = create<{ active: string[] }>(() => ({ active: [] }));

export interface ImportReport {
  imported: { fileName: string; assetId: string; playable: boolean; message: string | null }[];
  rejected: { fileName: string; reason: string }[];
}

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function assetFromProbe(id: string, file: File, kind: AssetKind, probe: ProbeOutcome): Asset {
  return {
    id,
    kind,
    displayName: baseName(file.name),
    fileName: file.name,
    mimeType: probe.mimeType || file.type || 'application/octet-stream',
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
  };
}

export async function probeWithProgress(file: File): Promise<ProbeOutcome> {
  useImportProgress.setState((s) => ({ active: [...s.active, file.name] }));
  try {
    return await probeVideoFile(file);
  } finally {
    useImportProgress.setState((s) => {
      const i = s.active.indexOf(file.name);
      return { active: i < 0 ? s.active : [...s.active.slice(0, i), ...s.active.slice(i + 1)] };
    });
  }
}

/** Writes the blob to IndexedDB when allowed, and records the outcome on the asset. */
export async function persistAssetBlob(assetId: string, blob: Blob): Promise<void> {
  if (!useSettings.getState().storeVideosInBrowser) {
    mutateProject((p) => {
      const a = p.assets.find((x) => x.id === assetId);
      if (a) {
        a.storage = 'session-only';
        a.storageError = 'Saving videos in browser storage is turned off in Settings.';
      }
    });
    return;
  }
  if (!useStorageHealth.getState().available) {
    mutateProject((p) => {
      const a = p.assets.find((x) => x.id === assetId);
      if (a) {
        a.storage = 'session-only';
        a.storageError = 'Browser storage is unavailable.';
      }
    });
    return;
  }
  usePersisting.setState((s) => ({ ids: { ...s.ids, [assetId]: true } }));
  try {
    await saveBlob(assetId, blob);
    mutateProject((p) => {
      const a = p.assets.find((x) => x.id === assetId);
      if (a && a.storage !== 'backend') {
        a.storage = 'browser-storage';
        a.storageError = null;
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    mutateProject((p) => {
      const a = p.assets.find((x) => x.id === assetId);
      if (a) {
        a.storage = 'session-only';
        a.storageError = message;
      }
    });
    pushToast({
      tone: 'warning',
      title: 'Video kept for this session only',
      message: `${message} You will need to reattach it after reloading.`,
    });
  } finally {
    usePersisting.setState((s) => {
      const ids = { ...s.ids };
      delete ids[assetId];
      return { ids };
    });
  }
}

export type GeneratedTarget = { mode: 'new-shots' } | { mode: 'shot'; shotId: string };

export async function importGeneratedVideos(files: File[], target: GeneratedTarget): Promise<ImportReport> {
  const report: ImportReport = { imported: [], rejected: [] };
  let lastSelection: { shotId: string; takeId: string } | null = null;
  for (const file of files) {
    const probe = await probeWithProgress(file);
    if (!probe.accepted) {
      report.rejected.push({ fileName: file.name, reason: probe.rejectReason ?? 'Rejected' });
      continue;
    }
    const project = getProject();
    if (!project) break;
    const assetId = newId('ast');
    registerBlob(assetId, file);
    const asset = assetFromProbe(assetId, file, 'generated', probe);
    const takeId = newId('tk');
    let shotId: string;
    if (target.mode === 'shot' && project.shots.some((s) => s.id === target.shotId)) {
      shotId = target.shotId;
    } else {
      shotId = newId('sht');
    }
    const createShot = !project.shots.some((s) => s.id === shotId);
    mutateProject((p) => {
      p.assets.push(asset);
      if (createShot) {
        p.shots.push({
          id: shotId,
          name: `Shot ${p.shots.length + 1} – ${asset.displayName}`,
          description: '',
          referenceAssetId: null,
          referenceOffsetSec: 0,
          createdAt: nowIso(),
        });
      }
      p.takes.push({
        id: takeId,
        shotId,
        number: nextTakeNumber(p as Project, shotId),
        assetId,
        generationPrompt: '',
        parentTakeId: null,
        correctionId: null,
        promptVersionId: null,
        recheck: [],
        acceptance: null,
        acceptanceHistory: [],
        createdAt: nowIso(),
      });
    });
    lastSelection = { shotId, takeId };
    report.imported.push({
      fileName: file.name,
      assetId,
      playable: probe.playback.status === 'playable',
      message: probe.playback.message,
    });
    void persistAssetBlob(assetId, file);
  }
  if (lastSelection) selectTake(lastSelection.shotId, lastSelection.takeId);
  return report;
}

export async function importReferenceVideo(file: File, shotId: string): Promise<ImportReport> {
  const report: ImportReport = { imported: [], rejected: [] };
  const probe = await probeWithProgress(file);
  if (!probe.accepted) {
    report.rejected.push({ fileName: file.name, reason: probe.rejectReason ?? 'Rejected' });
    return report;
  }
  const project = getProject();
  const shot = project?.shots.find((s) => s.id === shotId);
  if (!project || !shot) {
    report.rejected.push({ fileName: file.name, reason: 'The shot no longer exists.' });
    return report;
  }
  const previous = shot.referenceAssetId;
  const assetId = newId('ast');
  registerBlob(assetId, file);
  const asset = assetFromProbe(assetId, file, 'reference', probe);
  mutateProject((p) => {
    p.assets.push(asset);
    const s = p.shots.find((x) => x.id === shotId);
    if (s) s.referenceAssetId = assetId;
    if (previous) p.assets = p.assets.filter((a) => a.id !== previous);
  });
  if (previous) await discardAssetData([previous]);
  report.imported.push({ fileName: file.name, assetId, playable: probe.playback.status === 'playable', message: probe.playback.message });
  void persistAssetBlob(assetId, file);
  return report;
}

/** Revokes URLs and deletes stored blobs for assets no longer in the project. */
async function discardAssetData(assetIds: string[]): Promise<void> {
  assetIds.forEach(releaseAsset);
  if (!useStorageHealth.getState().available) return;
  try {
    await deleteBlobs(assetIds);
  } catch (err) {
    pushToast({
      tone: 'warning',
      title: 'Stored video not deleted',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Swaps the file behind an asset, keeping its ID (and so its take, findings,
 * and history). Also used to reattach a file that is missing after reload.
 */
export async function replaceAssetFile(assetId: string, file: File): Promise<{ ok: boolean; message: string | null }> {
  const probe = await probeWithProgress(file);
  if (!probe.accepted) return { ok: false, message: probe.rejectReason };
  const project = getProject();
  const existing = project?.assets.find((a) => a.id === assetId);
  if (!existing) return { ok: false, message: 'The asset no longer exists.' };
  registerBlob(assetId, file);
  mutateProject((p) => {
    const a = p.assets.find((x) => x.id === assetId);
    if (!a) return;
    a.fileName = file.name;
    a.mimeType = probe.mimeType || file.type || a.mimeType;
    a.sizeBytes = file.size;
    a.lastModified = Number.isFinite(file.lastModified) ? file.lastModified : null;
    a.importedAt = nowIso();
    a.media = probe.media;
    a.playback = probe.playback;
    a.storage = 'session-only';
    a.storageError = null;
    a.bundledUrl = null;
    // Any copy a backend holds is of the old file.
    a.backendAssetId = null;
    a.backendAdapterId = null;
  });
  void persistAssetBlob(assetId, file);
  return { ok: true, message: probe.playback.message };
}

export function fileMatchesAsset(asset: Asset, file: File): boolean {
  return asset.fileName === file.name && asset.sizeBytes === file.size;
}

export function renameAsset(assetId: string, displayName: string): void {
  const name = displayName.trim();
  if (!name) return;
  mutateProject((p) => {
    const a = p.assets.find((x) => x.id === assetId);
    if (a) a.displayName = name;
  });
}

/** Removes a take with its video, findings, runs, and corrections. */
export async function removeTake(takeId: string): Promise<void> {
  const project = getProject();
  const take = project?.takes.find((t) => t.id === takeId);
  if (!project || !take) return;
  const assetIds = take.assetId ? [take.assetId] : [];
  mutateProject((p) => {
    p.takes = p.takes.filter((t) => t.id !== takeId);
    p.findings = p.findings.filter((f) => f.takeId !== takeId);
    p.runs = p.runs.filter((r) => r.takeId !== takeId);
    p.corrections = p.corrections.filter((c) => c.takeId !== takeId);
    p.assets = p.assets.filter((a) => !assetIds.includes(a.id));
    for (const t of p.takes) {
      if (t.parentTakeId === takeId) {
        t.parentTakeId = null;
        t.correctionId = null;
        t.promptVersionId = null;
        t.recheck = [];
      }
    }
  });
  await discardAssetData(assetIds);
  const next = getProject();
  const sibling = next?.takes.find((t) => t.shotId === take.shotId);
  selectTake(take.shotId, sibling?.id ?? null);
}

export async function removeReference(shotId: string): Promise<void> {
  const shot = getProject()?.shots.find((s) => s.id === shotId);
  const assetId = shot?.referenceAssetId;
  if (!assetId) return;
  mutateProject((p) => {
    const s = p.shots.find((x) => x.id === shotId);
    if (s) {
      s.referenceAssetId = null;
      s.referenceOffsetSec = 0;
    }
    p.assets = p.assets.filter((a) => a.id !== assetId);
  });
  await discardAssetData([assetId]);
}

export function addShot(name?: string): string {
  const id = newId('sht');
  mutateProject((p) => {
    p.shots.push({
      id,
      name: name?.trim() || `Shot ${p.shots.length + 1}`,
      description: '',
      referenceAssetId: null,
      referenceOffsetSec: 0,
      createdAt: nowIso(),
    });
  });
  return id;
}

export function updateShot(shotId: string, patch: { name?: string; description?: string }): void {
  mutateProject((p) => {
    const s = p.shots.find((x) => x.id === shotId);
    if (!s) return;
    if (patch.name !== undefined && patch.name.trim()) s.name = patch.name.trim();
    if (patch.description !== undefined) s.description = patch.description;
  });
}

export async function removeShot(shotId: string): Promise<void> {
  const project = getProject();
  if (!project) return;
  const takes = project.takes.filter((t) => t.shotId === shotId);
  for (const t of takes) await removeTake(t.id);
  await removeReference(shotId);
  mutateProject((p) => {
    p.shots = p.shots.filter((s) => s.id !== shotId);
  });
  const first = getProject()?.shots[0];
  if (first) selectTake(first.id, getProject()?.takes.find((t) => t.shotId === first.id)?.id ?? null);
}

export function setReferenceOffset(shotId: string, offsetSec: number): void {
  if (!Number.isFinite(offsetSec)) return;
  mutateProject((p) => {
    const s = p.shots.find((x) => x.id === shotId);
    if (s) s.referenceOffsetSec = Math.round(offsetSec * 1000) / 1000;
  });
}

/** Moves a take (and everything attached to it) to another shot. */
export function moveTakeToShot(takeId: string, shotId: string): void {
  const project = getProject();
  const take = project?.takes.find((t) => t.id === takeId);
  if (!project || !take || take.shotId === shotId || !project.shots.some((s) => s.id === shotId)) return;
  mutateProject((p) => {
    const t = p.takes.find((x) => x.id === takeId) as Take | undefined;
    if (!t) return;
    t.number = nextTakeNumber(p as Project, shotId);
    t.shotId = shotId;
    for (const f of p.findings) if (f.takeId === takeId) f.shotId = shotId;
    for (const r of p.runs) if (r.takeId === takeId) r.shotId = shotId;
    for (const c of p.corrections) if (c.takeId === takeId) c.shotId = shotId;
  });
  selectTake(shotId, takeId);
}

export function setTakePrompt(takeId: string, prompt: string): void {
  mutateProject((p) => {
    const t = p.takes.find((x) => x.id === takeId);
    if (t) t.generationPrompt = prompt;
  });
}

/** Re-attempts saving an in-memory file to browser storage. */
export async function retryPersist(assetId: string): Promise<void> {
  const blob = getSessionBlob(assetId);
  if (!blob) {
    pushToast({ tone: 'warning', title: 'File not in memory', message: 'Reattach the file to save it.' });
    return;
  }
  await persistAssetBlob(assetId, blob);
}
