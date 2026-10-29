/**
 * The bundled sample project. Its footage is synthetic (drawn by
 * scripts/generate-sample-media.mjs) with flaws placed at known times and
 * positions, so the illustrative findings and boxes below match the picture.
 * All non-manual findings are marked as simulation: nothing was detected.
 */
import { sha256Hex } from './approval';
import { draftCorrectionFromTemplates } from './correctionTemplates';
import type { Asset, BoxAnnotation, DecisionEvent, Finding, Project, ReviewState } from './schemas';
import { PROJECT_SCHEMA_VERSION } from './schemas';

export const SAMPLE_PROJECT_ID = 'prj-sample-coastal-drive';

const SCRIPT = `COASTAL DRIVE: 15-second spot (ClearFrame sample brief)

SHOT 1: HIGHWAY APPROACH (8 s)
Wide, locked-off shot of a two-lane coastal highway at midday. The sea is visible beyond the right shoulder. White dashed centre line, solid white edge lines. A green exit sign stands on the right shoulder for the whole shot. A red hatchback drives through frame from left to right at a steady speed. Exposure is stable.

SHOT 2: CROSSWALK (6 s)
Static shot of a zebra crossing. A pedestrian in a navy jacket crosses from left to right at an even walking pace. Natural anatomy and continuous motion.
`;

const PROMPT_HIGHWAY =
  'Wide locked-off shot of a two-lane coastal highway at midday, the sea visible beyond the right shoulder, white dashed centre line and solid white edge lines, a green exit sign on the right shoulder, a red hatchback drives left to right at a steady speed, stable exposure, photorealistic.';

const PROMPT_CROSSWALK =
  'Static shot of a zebra crossing on a grey street, a pedestrian in a navy jacket walks from left to right at an even pace, natural anatomy, continuous motion, overcast light, photorealistic.';

function minutesAgo(base: number, minutes: number): string {
  return new Date(base - minutes * 60_000).toISOString();
}

function asset(
  id: string,
  kind: Asset['kind'],
  file: string,
  displayName: string,
  durationSec: number,
  sizeBytes: number,
  baseUrl: string,
  importedAt: string,
): Asset {
  return {
    id,
    kind,
    displayName,
    fileName: file,
    mimeType: 'video/mp4',
    sizeBytes,
    lastModified: null,
    importedAt,
    storage: 'bundled',
    storageError: null,
    bundledUrl: `${baseUrl}sample/${file}`,
    backendAssetId: null,
    backendAdapterId: null,
    media: { durationSec, width: 640, height: 360, hasVideoTrack: true, container: 'MP4' },
    playback: { status: 'playable', message: null },
  };
}

function box(id: string, x: number, y: number, w: number, h: number, label: string, startSec: number | null = null, endSec: number | null = null): BoxAnnotation {
  return { id, type: 'box', x, y, w, h, label, startSec, endSec, source: 'simulation' };
}

function history(id: string, created: string, decided: string | null, state: ReviewState, detail: string | null = null): DecisionEvent[] {
  const events: DecisionEvent[] = [
    { id: `${id}-evt-1`, at: created, action: 'created', fromState: null, toState: 'candidate', detail: 'Illustrative sample data' },
  ];
  if (decided && state !== 'candidate') {
    events.push({
      id: `${id}-evt-2`,
      at: decided,
      action: state === 'confirmed' ? 'confirmed' : 'dismissed',
      fromState: 'candidate',
      toState: state,
      detail,
    });
  }
  return events;
}

export async function buildSampleProject(baseUrl: string, now = Date.now()): Promise<Project> {
  const t0 = minutesAgo(now, 90);
  const tRun = minutesAgo(now, 80);
  const tDecide = minutesAgo(now, 70);
  const tApprove = minutesAgo(now, 60);
  const tRetake = minutesAgo(now, 30);

  const shot1 = 'sht-sample-highway';
  const shot2 = 'sht-sample-crosswalk';
  const take1 = 'tk-sample-highway-1';
  const take2 = 'tk-sample-highway-2';
  const take3 = 'tk-sample-crosswalk-1';
  const run1 = 'run-sample-highway-1';

  const base = (id: string, fields: Partial<Finding> & Pick<Finding, 'category' | 'description' | 'startSec' | 'endSec' | 'reviewState'>): Finding => ({
    id,
    shotId: shot1,
    takeId: take1,
    runId: run1,
    annotations: [],
    evidenceFrames: [],
    origin: 'simulation',
    confidence: null,
    detector: 'illustrative-sample',
    notes: '',
    history: history(id, tRun, tDecide, fields.reviewState),
    recheckOfFindingId: null,
    createdAt: tRun,
    updatedAt: tDecide,
    ...fields,
  });

  const findings: Finding[] = [
    base('fnd-sample-sign', {
      category: 'appearance-disappearance',
      description: 'Illustrative sample: the green exit sign and its post vanish for about a second, then reappear.',
      startSec: 1.5,
      endSec: 2.6,
      reviewState: 'confirmed',
      notes: 'Obvious on playback. The brief says the sign stays for the whole shot.',
      annotations: [box('ann-sample-sign', 0.822, 0.228, 0.081, 0.233, 'Exit sign')],
      evidenceFrames: [
        { id: 'evf-sample-sign-1', timeSec: 1.4, caption: 'Before: sign present', imageAssetId: null, source: 'simulation' },
        { id: 'evf-sample-sign-2', timeSec: 2.0, caption: 'During: sign missing', imageAssetId: null, source: 'simulation' },
      ],
    }),
    base('fnd-sample-lane', {
      category: 'road-markings',
      description: 'Illustrative sample: the centre line changes from white dashes to a solid double yellow line, then changes back.',
      startSec: 3.0,
      endSec: 4.6,
      reviewState: 'confirmed',
      notes: 'Breaks continuity with shot 2 and the brief.',
      annotations: [box('ann-sample-lane', 0.472, 0.456, 0.056, 0.544, 'Centre line')],
      evidenceFrames: [
        { id: 'evf-sample-lane-1', timeSec: 2.9, caption: 'Before: white dashes', imageAssetId: null, source: 'simulation' },
        { id: 'evf-sample-lane-2', timeSec: 3.5, caption: 'During: double yellow', imageAssetId: null, source: 'simulation' },
      ],
    }),
    base('fnd-sample-car', {
      category: 'object-deformation',
      description: 'Illustrative sample: the car body flattens and stretches, and the window slides toward the rear.',
      startSec: 5.2,
      endSec: 6.0,
      reviewState: 'candidate',
      annotations: [
        box('ann-sample-car-1', 0.581, 0.744, 0.197, 0.067, 'Car', 5.2, 5.4),
        box('ann-sample-car-2', 0.609, 0.744, 0.197, 0.067, 'Car', 5.4, 5.6),
        box('ann-sample-car-3', 0.638, 0.744, 0.197, 0.067, 'Car', 5.6, 5.8),
        box('ann-sample-car-4', 0.666, 0.744, 0.197, 0.067, 'Car', 5.8, 6.0),
      ],
      evidenceFrames: [
        { id: 'evf-sample-car-1', timeSec: 5.0, caption: 'Before: normal shape', imageAssetId: null, source: 'simulation' },
        { id: 'evf-sample-car-2', timeSec: 5.5, caption: 'During: stretched', imageAssetId: null, source: 'simulation' },
      ],
    }),
    base('fnd-sample-flicker', {
      category: 'exposure-flicker',
      description: 'Illustrative sample: brightness pulses over several frames near the end of the shot.',
      startSec: 6.4,
      endSec: 7.1,
      reviewState: 'candidate',
      evidenceFrames: [{ id: 'evf-sample-flicker-1', timeSec: 6.55, caption: 'Brighter frame', imageAssetId: null, source: 'simulation' }],
    }),
    base('fnd-sample-motion', {
      category: 'motion-inconsistency',
      description: 'Illustrative sample: possible change in the car’s speed as it enters frame.',
      startSec: 0.2,
      endSec: 0.9,
      reviewState: 'dismissed',
      notes: 'Checked frame by frame: the speed is constant. Nothing to fix.',
      history: history('fnd-sample-motion', tRun, tDecide, 'dismissed', 'Speed is constant'),
    }),
    {
      id: 'fnd-sample-coast',
      shotId: shot1,
      takeId: take1,
      runId: null,
      category: 'script-adherence',
      description: 'The brief asks for the sea beyond the right shoulder. No coastline is visible.',
      startSec: 0,
      endSec: 8,
      annotations: [],
      evidenceFrames: [],
      origin: 'manual',
      confidence: null,
      detector: null,
      reviewState: 'confirmed',
      notes: '',
      history: [
        { id: 'fnd-sample-coast-evt-1', at: tDecide, action: 'created', fromState: null, toState: 'candidate', detail: 'Manual finding' },
        { id: 'fnd-sample-coast-evt-2', at: tDecide, action: 'confirmed', fromState: 'candidate', toState: 'confirmed', detail: null },
      ],
      recheckOfFindingId: null,
      createdAt: tDecide,
      updatedAt: tDecide,
    },
  ];

  const addressed = ['fnd-sample-sign', 'fnd-sample-lane', 'fnd-sample-coast'];
  const draft = draftCorrectionFromTemplates(
    PROMPT_HIGHWAY,
    findings.filter((f) => addressed.includes(f.id)),
  );
  const sha = await sha256Hex(draft);

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: SAMPLE_PROJECT_ID,
    name: 'Sample: Coastal Drive',
    description: 'Synthetic sample footage with illustrative findings. Nothing in this project was detected by a model.',
    isSample: true,
    createdAt: t0,
    updatedAt: tRetake,
    script: { text: SCRIPT, sourceFileName: 'coastal-drive-brief.md', updatedAt: t0 },
    assets: [
      asset('ast-sample-highway-1', 'generated', 'highway-take1.mp4', 'Highway – take 1', 8, 114368, baseUrl, t0),
      asset('ast-sample-highway-ref', 'reference', 'highway-reference.mp4', 'Highway – reference plate', 8.5, 108409, baseUrl, t0),
      asset('ast-sample-highway-2', 'generated', 'highway-take2-retake.mp4', 'Highway – take 2 (retake)', 8, 100734, baseUrl, tRetake),
      asset('ast-sample-crosswalk-1', 'generated', 'crosswalk-take1.mp4', 'Crosswalk – take 1', 6, 77165, baseUrl, t0),
    ],
    shots: [
      {
        id: shot1,
        name: 'Shot 1 – Highway approach',
        description: 'The reference plate has a 0.5 s lead-in. Set the reference offset to +0.50 s to line it up.',
        referenceAssetId: 'ast-sample-highway-ref',
        referenceOffsetSec: 0,
        createdAt: t0,
      },
      {
        id: shot2,
        name: 'Shot 2 – Crosswalk',
        description: 'No reference footage. Review against the script only.',
        referenceAssetId: null,
        referenceOffsetSec: 0,
        createdAt: t0,
      },
    ],
    takes: [
      {
        id: take1,
        shotId: shot1,
        number: 1,
        assetId: 'ast-sample-highway-1',
        generationPrompt: PROMPT_HIGHWAY,
        parentTakeId: null,
        correctionId: null,
        promptVersionId: null,
        recheck: [],
        acceptance: null,
        acceptanceHistory: [],
        createdAt: t0,
      },
      {
        id: take2,
        shotId: shot1,
        number: 2,
        assetId: 'ast-sample-highway-2',
        generationPrompt: draft,
        parentTakeId: take1,
        correctionId: 'cor-sample-highway-1',
        promptVersionId: 'pv-sample-highway-1',
        recheck: addressed.map((id) => ({
          parentFindingId: id,
          status: 'pending' as const,
          note: '',
          decidedAt: null,
          followUpFindingId: null,
        })),
        acceptance: null,
        acceptanceHistory: [],
        createdAt: tRetake,
      },
      {
        id: take3,
        shotId: shot2,
        number: 1,
        assetId: 'ast-sample-crosswalk-1',
        generationPrompt: PROMPT_CROSSWALK,
        parentTakeId: null,
        correctionId: null,
        promptVersionId: null,
        recheck: [],
        acceptance: null,
        acceptanceHistory: [],
        createdAt: t0,
      },
    ],
    runs: [
      {
        id: run1,
        shotId: shot1,
        takeId: take1,
        adapterId: 'sample',
        adapterLabel: 'Illustrative sample data',
        simulated: true,
        serviceRunId: null,
        checks: ['road-markings', 'object-deformation', 'appearance-disappearance', 'motion-inconsistency', 'exposure-flicker'],
        status: 'completed',
        progress: 1,
        message: 'Sample data (simulated)',
        startedAt: tRun,
        finishedAt: tRun,
        error: null,
        findingCount: 5,
        warnings: ['These findings were written by hand to illustrate the workflow. They were not detected.'],
      },
    ],
    findings,
    corrections: [
      {
        id: 'cor-sample-highway-1',
        shotId: shot1,
        takeId: take1,
        originalPrompt: PROMPT_HIGHWAY,
        draftText: draft,
        draftSource: 'template',
        addressedFindingIds: addressed,
        versions: [
          {
            id: 'pv-sample-highway-1',
            number: 1,
            text: draft,
            originalPrompt: PROMPT_HIGHWAY,
            addressedFindingIds: addressed,
            draftSource: 'template',
            approvedAt: tApprove,
            sha256: sha,
          },
        ],
        exports: [],
        createdAt: tApprove,
        updatedAt: tApprove,
      },
    ],
    reviewConfig: { checks: null },
  };
}
