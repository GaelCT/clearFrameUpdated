/**
 * ClearFrame data contracts.
 *
 * These zod schemas are the single source of truth for persisted project
 * documents. TypeScript types are inferred from them so runtime validation
 * (IndexedDB reads, analyzer results, exports) and compile-time types agree.
 */
import { z } from 'zod';

export const PROJECT_SCHEMA_VERSION = 1;

const Id = z.string().min(1);
const IsoDate = z.string().min(1);
const Seconds = z.number().finite().nonnegative();

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const AssetKindSchema = z.enum(['generated', 'reference']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/**
 * Where the file bytes live.
 * - bundled:          shipped with the app (sample project), fetched by URL.
 * - browser-storage:  blob saved in this browser's IndexedDB.
 * - session-only:     held in memory for this tab only; must be reattached after reload.
 * - backend:          held by a local analysis backend, addressed by backendAssetId.
 */
export const AssetStorageSchema = z.enum(['bundled', 'browser-storage', 'session-only', 'backend']);
export type AssetStorage = z.infer<typeof AssetStorageSchema>;

export const PlaybackStatusSchema = z.enum(['unchecked', 'playable', 'unsupported']);
export type PlaybackStatus = z.infer<typeof PlaybackStatusSchema>;

export const MediaInfoSchema = z.object({
  durationSec: Seconds.nullable(),
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  hasVideoTrack: z.boolean().nullable(),
  container: z.string().nullable(),
});
export type MediaInfo = z.infer<typeof MediaInfoSchema>;

export const AssetSchema = z.object({
  id: Id,
  kind: AssetKindSchema,
  displayName: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  lastModified: z.number().nullable(),
  importedAt: IsoDate,
  storage: AssetStorageSchema,
  /** Why the blob could not be saved to browser storage, if it couldn't. */
  storageError: z.string().nullable(),
  /** URL for bundled sample media. */
  bundledUrl: z.string().nullable(),
  /** ID assigned by an analysis backend after upload. Never a filesystem path. */
  backendAssetId: z.string().nullable(),
  backendAdapterId: z.string().nullable(),
  media: MediaInfoSchema,
  playback: z.object({
    status: PlaybackStatusSchema,
    message: z.string().nullable(),
  }),
});
export type Asset = z.infer<typeof AssetSchema>;

// ---------------------------------------------------------------------------
// Shots and takes
// ---------------------------------------------------------------------------

export const ShotSchema = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  referenceAssetId: Id.nullable(),
  /** Reference time = generated time + offset. */
  referenceOffsetSec: z.number().finite(),
  createdAt: IsoDate,
});
export type Shot = z.infer<typeof ShotSchema>;

export const RecheckStatusSchema = z.enum(['pending', 'verified-fixed', 'still-present']);
export type RecheckStatus = z.infer<typeof RecheckStatusSchema>;

export const RecheckItemSchema = z.object({
  parentFindingId: Id,
  status: RecheckStatusSchema,
  note: z.string(),
  decidedAt: IsoDate.nullable(),
  /** Finding created on this take when the issue was found to persist. */
  followUpFindingId: Id.nullable(),
});
export type RecheckItem = z.infer<typeof RecheckItemSchema>;

export const AcceptanceEventSchema = z.object({
  at: IsoDate,
  action: z.enum(['accepted', 'reopened']),
  note: z.string(),
});
export type AcceptanceEvent = z.infer<typeof AcceptanceEventSchema>;

export const TakeSchema = z.object({
  id: Id,
  shotId: Id,
  /** Take number within its shot, starting at 1. */
  number: z.number().int().positive(),
  assetId: Id.nullable(),
  /** The prompt used to generate this take. Separate from the project script. */
  generationPrompt: z.string(),
  parentTakeId: Id.nullable(),
  /** Correction and approved prompt version this take was generated from. */
  correctionId: Id.nullable(),
  promptVersionId: Id.nullable(),
  recheck: z.array(RecheckItemSchema),
  acceptance: z
    .object({
      acceptedAt: IsoDate,
      note: z.string(),
    })
    .nullable(),
  acceptanceHistory: z.array(AcceptanceEventSchema),
  createdAt: IsoDate,
});
export type Take = z.infer<typeof TakeSchema>;

// ---------------------------------------------------------------------------
// Analysis runs and findings
// ---------------------------------------------------------------------------

export const RunStatusSchema = z.enum(['queued', 'running', 'completed', 'canceled', 'failed']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const AnalysisErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type AnalysisErrorInfo = z.infer<typeof AnalysisErrorSchema>;

export const AnalysisRunSchema = z.object({
  id: Id,
  shotId: Id,
  takeId: Id,
  adapterId: z.string(),
  adapterLabel: z.string(),
  /** True when results are simulated (demo adapter or sample data). */
  simulated: z.boolean(),
  /** Run ID assigned by the analysis service, if different from ours. */
  serviceRunId: z.string().nullable(),
  checks: z.array(z.string()),
  status: RunStatusSchema,
  progress: z.number().min(0).max(1),
  message: z.string().nullable(),
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable(),
  error: AnalysisErrorSchema.nullable(),
  findingCount: z.number().int().nonnegative().nullable(),
  warnings: z.array(z.string()),
});
export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;

export const FindingOriginSchema = z.enum(['model', 'measured-signal', 'manual', 'simulation']);
export type FindingOrigin = z.infer<typeof FindingOriginSchema>;

export const ReviewStateSchema = z.enum(['candidate', 'confirmed', 'dismissed']);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

const Normalized = z.number().min(0).max(1);

/** Who produced the coordinates. Overlays are drawn only from real coordinates. */
export const AnnotationSourceSchema = z.enum(['manual', 'analyzer', 'simulation']);
export type AnnotationSource = z.infer<typeof AnnotationSourceSchema>;

const AnnotationBase = {
  id: Id,
  /** Optional sub-interval; null means the finding's interval. */
  startSec: Seconds.nullable(),
  endSec: Seconds.nullable(),
  label: z.string().nullable(),
  source: AnnotationSourceSchema,
};

export const BoxAnnotationSchema = z.object({
  ...AnnotationBase,
  type: z.literal('box'),
  /** Normalized to the video frame: 0..1 from the top-left corner. */
  x: Normalized,
  y: Normalized,
  w: Normalized,
  h: Normalized,
});

export const PolygonAnnotationSchema = z.object({
  ...AnnotationBase,
  type: z.literal('polygon'),
  points: z.array(z.tuple([Normalized, Normalized])).min(3),
});

export const SpatialAnnotationSchema = z.discriminatedUnion('type', [BoxAnnotationSchema, PolygonAnnotationSchema]);
export type SpatialAnnotation = z.infer<typeof SpatialAnnotationSchema>;
export type BoxAnnotation = z.infer<typeof BoxAnnotationSchema>;

export const EvidenceFrameSchema = z.object({
  id: Id,
  timeSec: Seconds,
  caption: z.string(),
  /** Image supplied by a backend. When null the frame is rendered from the video. */
  imageAssetId: z.string().nullable(),
  source: AnnotationSourceSchema,
});
export type EvidenceFrame = z.infer<typeof EvidenceFrameSchema>;

export const DecisionActionSchema = z.enum([
  'created',
  'confirmed',
  'dismissed',
  'reopened',
  'interval-edited',
  'details-edited',
  'notes-edited',
  'annotation-added',
  'annotation-removed',
  'evidence-added',
  'evidence-removed',
]);
export type DecisionAction = z.infer<typeof DecisionActionSchema>;

export const DecisionEventSchema = z.object({
  id: Id,
  at: IsoDate,
  action: DecisionActionSchema,
  fromState: ReviewStateSchema.nullable(),
  toState: ReviewStateSchema.nullable(),
  detail: z.string().nullable(),
});
export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

export const FindingSchema = z.object({
  id: Id,
  shotId: Id,
  takeId: Id,
  /** Analysis run that produced it; null for manual findings. */
  runId: Id.nullable(),
  category: z.string(),
  description: z.string(),
  startSec: Seconds,
  endSec: Seconds,
  annotations: z.array(SpatialAnnotationSchema),
  evidenceFrames: z.array(EvidenceFrameSchema),
  origin: FindingOriginSchema,
  /** 0..1, only when an analyzer supplies a meaningful value. Never invented. */
  confidence: z.number().min(0).max(1).nullable(),
  /** Detector or signal name reported by the analyzer. */
  detector: z.string().nullable(),
  reviewState: ReviewStateSchema,
  /** Reviewer notes. Separate from the description and from prompts. */
  notes: z.string(),
  history: z.array(DecisionEventSchema),
  /** Set when this finding was created from a retake re-check. */
  recheckOfFindingId: Id.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Finding = z.infer<typeof FindingSchema>;

// ---------------------------------------------------------------------------
// Prompt corrections
// ---------------------------------------------------------------------------

export const DraftSourceSchema = z.enum(['template', 'template-edited', 'manual']);
export type DraftSource = z.infer<typeof DraftSourceSchema>;

/** An immutable, approved snapshot of a proposed prompt. */
export const PromptVersionSchema = z.object({
  id: Id,
  number: z.number().int().positive(),
  text: z.string(),
  originalPrompt: z.string(),
  addressedFindingIds: z.array(Id),
  draftSource: DraftSourceSchema,
  approvedAt: IsoDate,
  sha256: z.string().nullable(),
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

export const ExportRecordSchema = z.object({
  at: IsoDate,
  versionId: Id,
  requestId: Id,
  fileName: z.string(),
});
export type ExportRecord = z.infer<typeof ExportRecordSchema>;

export const CorrectionSchema = z.object({
  id: Id,
  shotId: Id,
  takeId: Id,
  /** Snapshot of the take's generation prompt when the correction was started. */
  originalPrompt: z.string(),
  draftText: z.string(),
  draftSource: DraftSourceSchema,
  addressedFindingIds: z.array(Id),
  versions: z.array(PromptVersionSchema),
  exports: z.array(ExportRecordSchema),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Correction = z.infer<typeof CorrectionSchema>;

// ---------------------------------------------------------------------------
// Project document
// ---------------------------------------------------------------------------

export const ScriptSchema = z.object({
  text: z.string(),
  sourceFileName: z.string().nullable(),
  updatedAt: IsoDate.nullable(),
});
export type Script = z.infer<typeof ScriptSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: Id,
  name: z.string().min(1),
  description: z.string(),
  isSample: z.boolean(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  script: ScriptSchema,
  assets: z.array(AssetSchema),
  shots: z.array(ShotSchema),
  takes: z.array(TakeSchema),
  runs: z.array(AnalysisRunSchema),
  findings: z.array(FindingSchema),
  corrections: z.array(CorrectionSchema),
  reviewConfig: z.object({
    /** Check IDs the reviewer last selected; null means the adapter defaults. */
    checks: z.array(z.string()).nullable(),
  }),
});
export type Project = z.infer<typeof ProjectSchema>;

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  isSample: boolean;
  updatedAt: string;
  createdAt: string;
  shotCount: number;
  takeCount: number;
  findingCount: number;
}

export function summarizeProject(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    isSample: p.isSample,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    shotCount: p.shots.length,
    takeCount: p.takes.length,
    findingCount: p.findings.length,
  };
}
