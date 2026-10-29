/**
 * The analysis-service contract.
 *
 * The UI talks to analysis only through this interface. A service receives
 * asset IDs (never filesystem paths), reports progress through events, and
 * returns structured results that the review runner validates before they
 * become findings. See docs/analysis-integration.md.
 */
import { z } from 'zod';
import type { AnalysisErrorInfo, AssetKind } from '../domain/schemas';

export interface AnalyzerInfo {
  id: string;
  label: string;
  kind: 'demo' | 'local-backend';
  /** True when the service invents results instead of analysing pixels. */
  simulated: boolean;
  description: string;
}

/**
 * - available:   a real detector or measurement exists for this check.
 * - simulated:   the check can be selected, but results are invented (demo).
 * - unavailable: listed for completeness; cannot be run with this service.
 */
export type CheckAvailability = 'available' | 'simulated' | 'unavailable';

export interface AnalysisCheck {
  id: string;
  category: string;
  label: string;
  description: string;
  availability: CheckAvailability;
  note: string | null;
  requiresReference: boolean;
  defaultEnabled: boolean;
}

export interface ImportAssetInput {
  /** ClearFrame's own asset ID, for correlation. */
  localAssetId: string;
  kind: AssetKind;
  file: Blob;
  fileName: string;
  mimeType: string;
  signal?: AbortSignal;
}

export interface ImportAssetResult {
  /** Opaque ID the service uses to refer to the uploaded media. */
  backendAssetId: string;
}

export interface ReviewRequest {
  projectId: string;
  shotId: string;
  takeId: string;
  generated: {
    backendAssetId: string;
    durationSec: number | null;
    width: number | null;
    height: number | null;
  };
  /** Optional source/reference footage. Review must work without it. */
  reference: {
    backendAssetId: string;
    /** Reference time = generated time + offsetSec. */
    offsetSec: number;
    durationSec: number | null;
  } | null;
  scriptText: string;
  generationPrompt: string;
  checks: string[];
}

export type ReviewEvent =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'completed' }
  | { type: 'failed'; error: AnalysisErrorInfo }
  | { type: 'canceled' };

export interface SubmittedReview {
  serviceRunId: string;
}

export interface AnalysisService {
  readonly info: AnalyzerInfo;
  listChecks(): Promise<AnalysisCheck[]>;
  importAsset(input: ImportAssetInput): Promise<ImportAssetResult>;
  /** Starts a review. Progress and the terminal state arrive through onEvent. */
  submitReview(request: ReviewRequest, onEvent: (event: ReviewEvent) => void): Promise<SubmittedReview>;
  /**
   * Returns the raw result for a completed run. Typed as unknown on purpose:
   * the runner validates it against AnalysisResultSchema before use.
   */
  getResult(serviceRunId: string): Promise<unknown>;
  cancelReview(serviceRunId: string): Promise<void>;
}

export class AnalysisServiceError extends Error {
  readonly info: AnalysisErrorInfo;
  constructor(info: AnalysisErrorInfo) {
    super(info.message);
    this.name = 'AnalysisServiceError';
    this.info = info;
  }
}

// ---------------------------------------------------------------------------
// Result schema (the boundary between a service and ClearFrame's data model)
// ---------------------------------------------------------------------------

const Normalized = z.number().min(0).max(1);
const OptionalSeconds = z.number().nonnegative().nullable().optional();

export const AnalyzerAnnotationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('box'),
    x: Normalized,
    y: Normalized,
    w: Normalized,
    h: Normalized,
    startSec: OptionalSeconds,
    endSec: OptionalSeconds,
    label: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('polygon'),
    points: z.array(z.tuple([Normalized, Normalized])).min(3),
    startSec: OptionalSeconds,
    endSec: OptionalSeconds,
    label: z.string().nullable().optional(),
  }),
]);

export const AnalyzerFindingSchema = z
  .object({
    category: z.string().min(1),
    description: z.string(),
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
    origin: z.enum(['model', 'measured-signal', 'simulation']),
    /** Omit unless the analyzer produces a calibrated value. */
    confidence: z.number().min(0).max(1).nullable().optional(),
    detector: z.string().nullable().optional(),
    annotations: z.array(AnalyzerAnnotationSchema).optional(),
    evidenceFrames: z
      .array(
        z.object({
          timeSec: z.number().nonnegative(),
          caption: z.string(),
          imageAssetId: z.string().nullable().optional(),
        }),
      )
      .optional(),
  })
  .refine((f) => f.endSec >= f.startSec, { message: 'endSec must not be before startSec' });
export type AnalyzerFinding = z.infer<typeof AnalyzerFindingSchema>;

export const AnalysisResultSchema = z.object({
  serviceRunId: z.string(),
  findings: z.array(AnalyzerFindingSchema),
  warnings: z.array(z.string()).optional(),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
