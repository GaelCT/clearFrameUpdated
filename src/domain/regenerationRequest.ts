import { z } from 'zod';
import { getApprovalState } from './approval';
import { categoryLabel } from './categories';
import { newId, nowIso } from './ids';
import { DraftSourceSchema, FindingOriginSchema, type Correction, type Project } from './schemas';

export const REGENERATION_REQUEST_SCHEMA = 'clearframe.regeneration-request';

export const RegenerationRequestSchema = z.object({
  schema: z.literal(REGENERATION_REQUEST_SCHEMA),
  schemaVersion: z.literal(1),
  requestId: z.string(),
  exportedAt: z.string(),
  generation: z.object({
    status: z.literal('not-integrated'),
    note: z.string(),
  }),
  project: z.object({ id: z.string(), name: z.string() }),
  shot: z.object({ id: z.string(), name: z.string() }),
  /** The reviewed take. A retake generated from this request should name it as its parent. */
  take: z.object({
    id: z.string(),
    number: z.number().int(),
    assetId: z.string().nullable(),
    fileName: z.string().nullable(),
  }),
  /** The reviewed take's own parent, when it is itself a retake. */
  parentTake: z.object({ id: z.string(), number: z.number().int() }).nullable(),
  originalPrompt: z.string(),
  approvedPrompt: z.object({
    correctionId: z.string(),
    versionId: z.string(),
    version: z.number().int(),
    text: z.string(),
    sha256: z.string().nullable(),
    approvedAt: z.string(),
    draftSource: DraftSourceSchema,
  }),
  confirmedIssueIds: z.array(z.string()),
  confirmedIssues: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      categoryLabel: z.string(),
      description: z.string(),
      startSec: z.number(),
      endSec: z.number(),
      origin: FindingOriginSchema,
      reviewerNotes: z.string(),
    }),
  ),
  /** True if any addressed issue came from simulated (demo) analysis. */
  containsSimulatedFindings: z.boolean(),
});
export type RegenerationRequest = z.infer<typeof RegenerationRequestSchema>;

export class ExportBlockedError extends Error {}

export function buildRegenerationRequest(project: Project, correction: Correction): RegenerationRequest {
  const take = project.takes.find((t) => t.id === correction.takeId);
  const shot = project.shots.find((s) => s.id === correction.shotId);
  if (!take || !shot) throw new ExportBlockedError('The take or shot for this correction no longer exists.');
  const takeFindings = project.findings.filter((f) => f.takeId === take.id);
  const approval = getApprovalState(correction, takeFindings);
  if (approval.kind === 'none') throw new ExportBlockedError('Approve the proposed prompt before exporting.');
  if (approval.kind === 'stale') {
    throw new ExportBlockedError(`The approval is out of date. ${approval.reasons.join(' ')}`);
  }
  const version = approval.version;
  const asset = take.assetId ? project.assets.find((a) => a.id === take.assetId) : undefined;
  const parent = take.parentTakeId ? project.takes.find((t) => t.id === take.parentTakeId) : undefined;
  const issues = version.addressedFindingIds
    .map((id) => takeFindings.find((f) => f.id === id))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));

  const request: RegenerationRequest = {
    schema: REGENERATION_REQUEST_SCHEMA,
    schemaVersion: 1,
    requestId: newId('req'),
    exportedAt: nowIso(),
    generation: {
      status: 'not-integrated',
      note: 'ClearFrame does not call a video generator. Submit this request to your generation tool manually.',
    },
    project: { id: project.id, name: project.name },
    shot: { id: shot.id, name: shot.name },
    take: { id: take.id, number: take.number, assetId: asset?.id ?? null, fileName: asset?.fileName ?? null },
    parentTake: parent ? { id: parent.id, number: parent.number } : null,
    originalPrompt: version.originalPrompt,
    approvedPrompt: {
      correctionId: correction.id,
      versionId: version.id,
      version: version.number,
      text: version.text,
      sha256: version.sha256,
      approvedAt: version.approvedAt,
      draftSource: version.draftSource,
    },
    confirmedIssueIds: issues.map((f) => f.id),
    confirmedIssues: issues.map((f) => ({
      id: f.id,
      category: f.category,
      categoryLabel: categoryLabel(f.category),
      description: f.description,
      startSec: f.startSec,
      endSec: f.endSec,
      origin: f.origin,
      reviewerNotes: f.notes,
    })),
    containsSimulatedFindings: issues.some((f) => f.origin === 'simulation'),
  };
  return RegenerationRequestSchema.parse(request);
}

export function regenerationFileName(project: Project, correction: Correction, versionNumber: number): string {
  const take = project.takes.find((t) => t.id === correction.takeId);
  const shot = project.shots.find((s) => s.id === correction.shotId);
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'untitled';
  return `regeneration-request_${slug(project.name)}_${slug(shot?.name ?? 'shot')}_take${take?.number ?? 0}_v${versionNumber}.json`;
}
