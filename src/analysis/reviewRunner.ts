/**
 * Runs reviews through the active AnalysisService and records the outcome in
 * the project: run status and progress, then validated findings. Components
 * never call a service directly; they read runs and findings from the store.
 */
import { newId, nowIso } from '../domain/ids';
import type { AnalysisErrorInfo, AnalysisRun, Asset, Finding } from '../domain/schemas';
import { getSessionBlob } from '../media/mediaRegistry';
import { loadBlob } from '../persistence/repository';
import { getProject, mutateProject } from '../state/projectStore';
import { pushToast } from '../state/toastStore';
import { AnalysisResultSchema, AnalysisServiceError, type AnalysisService, type AnalyzerFinding, type ReviewEvent } from './contract';
import { getAnalysisService } from './registry';

interface ActiveRun {
  projectId: string;
  service: AnalysisService;
  serviceRunId: string | null;
  cancelRequested: boolean;
}

const active = new Map<string, ActiveRun>();

function toErrorInfo(err: unknown): AnalysisErrorInfo {
  if (err instanceof AnalysisServiceError) return err.info;
  return {
    code: 'unexpected',
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
  };
}

function updateRun(projectId: string, runId: string, patch: Partial<AnalysisRun>): void {
  if (getProject()?.id !== projectId) return;
  mutateProject((p) => {
    const run = p.runs.find((r) => r.id === runId);
    if (run) Object.assign(run, patch);
  });
}

function finishRun(projectId: string, runId: string, patch: Partial<AnalysisRun>): void {
  active.delete(runId);
  updateRun(projectId, runId, { ...patch, finishedAt: nowIso() });
}

async function blobForAsset(asset: Asset): Promise<Blob> {
  const inMemory = getSessionBlob(asset.id);
  if (inMemory) return inMemory;
  if (asset.storage === 'browser-storage') {
    const stored = await loadBlob(asset.id);
    if (stored) return stored;
  }
  if (asset.storage === 'bundled' && asset.bundledUrl) {
    const res = await fetch(asset.bundledUrl);
    if (!res.ok) throw new Error(`Could not load ${asset.fileName} (HTTP ${res.status}).`);
    return res.blob();
  }
  throw new AnalysisServiceError({
    code: 'media-missing',
    message: `${asset.displayName} is not available in this session. Reattach the file, then run the review again.`,
    retryable: true,
  });
}

/** Uploads an asset to the service once and remembers the returned asset ID. */
async function ensureImported(service: AnalysisService, asset: Asset): Promise<string> {
  if (asset.backendAdapterId === service.info.id && asset.backendAssetId) return asset.backendAssetId;
  const file = await blobForAsset(asset);
  const { backendAssetId } = await service.importAsset({
    localAssetId: asset.id,
    kind: asset.kind,
    file,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
  });
  mutateProject((p) => {
    const a = p.assets.find((x) => x.id === asset.id);
    if (a) {
      a.backendAssetId = backendAssetId;
      a.backendAdapterId = service.info.id;
    }
  });
  return backendAssetId;
}

function toFinding(
  af: AnalyzerFinding,
  ctx: { runId: string; shotId: string; takeId: string; simulated: boolean; duration: number | null },
): Finding {
  const now = nowIso();
  const max = ctx.duration ?? Number.POSITIVE_INFINITY;
  const start = Math.min(af.startSec, max);
  const end = Math.max(start, Math.min(af.endSec, max));
  const annotationSource = ctx.simulated ? 'simulation' : 'analyzer';
  return {
    id: newId('fnd'),
    shotId: ctx.shotId,
    takeId: ctx.takeId,
    runId: ctx.runId,
    category: af.category,
    description: af.description,
    startSec: start,
    endSec: end,
    annotations: (af.annotations ?? []).map((a) =>
      a.type === 'box'
        ? {
            id: newId('ann'),
            type: 'box' as const,
            x: a.x,
            y: a.y,
            w: a.w,
            h: a.h,
            startSec: a.startSec ?? null,
            endSec: a.endSec ?? null,
            label: a.label ?? null,
            source: annotationSource,
          }
        : {
            id: newId('ann'),
            type: 'polygon' as const,
            points: a.points,
            startSec: a.startSec ?? null,
            endSec: a.endSec ?? null,
            label: a.label ?? null,
            source: annotationSource,
          },
    ),
    evidenceFrames: (af.evidenceFrames ?? []).map((e) => ({
      id: newId('evf'),
      timeSec: Math.min(e.timeSec, max),
      caption: e.caption,
      imageAssetId: e.imageAssetId ?? null,
      source: annotationSource,
    })),
    // A simulated service can never claim a model or measured origin.
    origin: ctx.simulated ? 'simulation' : af.origin,
    // Simulated confidence would be meaningless, so it is dropped.
    confidence: ctx.simulated ? null : (af.confidence ?? null),
    detector: af.detector ?? null,
    reviewState: 'candidate',
    notes: '',
    history: [
      {
        id: newId('evt'),
        at: now,
        action: 'created',
        fromState: null,
        toState: 'candidate',
        detail: ctx.simulated ? 'Simulated by demo analysis' : `From analysis run`,
      },
    ],
    recheckOfFindingId: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function handleEvent(projectId: string, runId: string, event: ReviewEvent): Promise<void> {
  const entry = active.get(runId);
  if (!entry) return;
  switch (event.type) {
    case 'progress':
      updateRun(projectId, runId, {
        status: 'running',
        progress: Math.min(1, Math.max(0, event.progress)),
        message: event.message,
      });
      return;
    case 'canceled':
      finishRun(projectId, runId, { status: 'canceled', message: 'Canceled by reviewer' });
      return;
    case 'failed':
      finishRun(projectId, runId, { status: 'failed', message: null, error: event.error });
      return;
    case 'completed': {
      if (!entry.serviceRunId) return;
      try {
        const raw = await entry.service.getResult(entry.serviceRunId);
        const parsed = AnalysisResultSchema.safeParse(raw);
        if (!parsed.success) {
          finishRun(projectId, runId, {
            status: 'failed',
            message: null,
            error: {
              code: 'invalid-result',
              message: `The analysis service returned results ClearFrame could not read: ${parsed.error.issues[0]?.message ?? 'invalid data'}.`,
              retryable: false,
            },
          });
          return;
        }
        const project = getProject();
        if (!project || project.id !== projectId) return;
        const run = project.runs.find((r) => r.id === runId);
        const take = run ? project.takes.find((t) => t.id === run.takeId) : undefined;
        if (!run || !take) return;
        const asset = take.assetId ? project.assets.find((a) => a.id === take.assetId) : undefined;
        const ctx = {
          runId,
          shotId: take.shotId,
          takeId: take.id,
          simulated: run.simulated,
          duration: asset?.media.durationSec ?? null,
        };
        const findings = parsed.data.findings.map((f) => toFinding(f, ctx));
        active.delete(runId);
        mutateProject((p) => {
          p.findings.push(...findings);
          const r = p.runs.find((x) => x.id === runId);
          if (r) {
            r.status = 'completed';
            r.progress = 1;
            r.message = null;
            r.finishedAt = nowIso();
            r.findingCount = findings.length;
            r.warnings = parsed.data.warnings ?? [];
          }
        });
      } catch (err) {
        finishRun(projectId, runId, { status: 'failed', message: null, error: toErrorInfo(err) });
      }
      return;
    }
  }
}

export function isRunActive(runId: string): boolean {
  return active.has(runId);
}

export async function startReview(takeId: string, checks: string[]): Promise<string | null> {
  const project = getProject();
  const take = project?.takes.find((t) => t.id === takeId);
  const shot = take ? project?.shots.find((s) => s.id === take.shotId) : undefined;
  const asset = take?.assetId ? project?.assets.find((a) => a.id === take.assetId) : undefined;
  if (!project || !take || !shot) return null;
  if (!asset) {
    pushToast({ tone: 'error', title: 'No video for this take', message: 'Attach a video before running a review.' });
    return null;
  }
  if (project.runs.some((r) => r.takeId === takeId && (r.status === 'running' || r.status === 'queued'))) {
    pushToast({ tone: 'info', title: 'A review is already running for this take' });
    return null;
  }

  const service = getAnalysisService();
  const runId = newId('run');
  const projectId = project.id;
  const run: AnalysisRun = {
    id: runId,
    shotId: shot.id,
    takeId,
    adapterId: service.info.id,
    adapterLabel: service.info.label,
    simulated: service.info.simulated,
    serviceRunId: null,
    checks,
    status: 'queued',
    progress: 0,
    message: 'Preparing…',
    startedAt: nowIso(),
    finishedAt: null,
    error: null,
    findingCount: null,
    warnings: [],
  };
  mutateProject((p) => {
    p.runs.push(run);
    p.reviewConfig.checks = checks;
  });
  const entry: ActiveRun = { projectId, service, serviceRunId: null, cancelRequested: false };
  active.set(runId, entry);

  try {
    const generatedId = await ensureImported(service, asset);
    const refAsset = shot.referenceAssetId ? project.assets.find((a) => a.id === shot.referenceAssetId) : undefined;
    let reference = null;
    if (refAsset) {
      try {
        reference = {
          backendAssetId: await ensureImported(service, refAsset),
          offsetSec: shot.referenceOffsetSec,
          durationSec: refAsset.media.durationSec,
        };
      } catch (err) {
        // Reference footage is optional; continue without it but say so.
        updateRun(projectId, runId, { warnings: [`Reference footage was not sent: ${toErrorInfo(err).message}`] });
      }
    }
    if (entry.cancelRequested) {
      finishRun(projectId, runId, { status: 'canceled', message: 'Canceled by reviewer' });
      return runId;
    }
    const current = getProject();
    const submitted = await service.submitReview(
      {
        projectId,
        shotId: shot.id,
        takeId,
        generated: {
          backendAssetId: generatedId,
          durationSec: asset.media.durationSec,
          width: asset.media.width,
          height: asset.media.height,
        },
        reference,
        scriptText: current?.script.text ?? '',
        generationPrompt: take.generationPrompt,
        checks,
      },
      (event) => void handleEvent(projectId, runId, event),
    );
    entry.serviceRunId = submitted.serviceRunId;
    updateRun(projectId, runId, { serviceRunId: submitted.serviceRunId, status: 'running' });
    if (entry.cancelRequested) await service.cancelReview(submitted.serviceRunId);
  } catch (err) {
    finishRun(projectId, runId, { status: 'failed', message: null, error: toErrorInfo(err) });
  }
  return runId;
}

export async function cancelReview(runId: string): Promise<void> {
  const entry = active.get(runId);
  if (!entry) return;
  entry.cancelRequested = true;
  updateRun(entry.projectId, runId, { message: 'Canceling…' });
  if (entry.serviceRunId) {
    try {
      await entry.service.cancelReview(entry.serviceRunId);
    } catch (err) {
      pushToast({ tone: 'error', title: 'Could not cancel the review', message: toErrorInfo(err).message });
    }
  }
}

/** Called when the project closes: cancel at the service and record it. */
export function cancelActiveRunsForClose(): void {
  const project = getProject();
  for (const [runId, entry] of active) {
    if (entry.serviceRunId) void entry.service.cancelReview(entry.serviceRunId).catch(() => undefined);
    if (project?.id === entry.projectId) {
      mutateProject((p) => {
        const r = p.runs.find((x) => x.id === runId);
        if (r && (r.status === 'running' || r.status === 'queued')) {
          r.status = 'canceled';
          r.message = 'Canceled when the project was closed';
          r.finishedAt = nowIso();
        }
      });
    }
    active.delete(runId);
  }
}
