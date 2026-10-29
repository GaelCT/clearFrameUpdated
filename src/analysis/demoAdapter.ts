/**
 * Demo analysis adapter.
 *
 * It does not decode or inspect video. It waits a few seconds, reports
 * progress, and returns invented findings (origin "simulation") so the
 * review workflow can be exercised end to end. Every finding it returns says
 * so in its description, and the UI labels them as simulated.
 */
import { categoryLabel } from '../domain/categories';
import {
  AnalysisServiceError,
  type AnalysisCheck,
  type AnalysisResult,
  type AnalysisService,
  type AnalyzerFinding,
  type AnalyzerInfo,
  type ImportAssetInput,
  type ImportAssetResult,
  type ReviewEvent,
  type ReviewRequest,
  type SubmittedReview,
} from './contract';

export type DemoBehavior = 'normal' | 'no-findings' | 'fail';

export interface DemoOptions {
  behavior: DemoBehavior;
  /** Total simulated run time. */
  durationMs: number;
}

const SIMULATED_NOTE = 'Simulated by the demo adapter. No detector is connected.';

export const DEMO_CHECKS: readonly AnalysisCheck[] = [
  {
    id: 'road-markings',
    category: 'road-markings',
    label: 'Road markings',
    description: 'Lane lines and road paint stay consistent.',
    availability: 'simulated',
    note: SIMULATED_NOTE,
    requiresReference: false,
    defaultEnabled: true,
  },
  {
    id: 'object-deformation',
    category: 'object-deformation',
    label: 'Object deformation',
    description: 'Rigid objects keep their shape.',
    availability: 'simulated',
    note: SIMULATED_NOTE,
    requiresReference: false,
    defaultEnabled: true,
  },
  {
    id: 'appearance-disappearance',
    category: 'appearance-disappearance',
    label: 'Appearance / disappearance',
    description: 'Objects do not pop in or vanish.',
    availability: 'simulated',
    note: SIMULATED_NOTE,
    requiresReference: false,
    defaultEnabled: true,
  },
  {
    id: 'anatomy',
    category: 'anatomy',
    label: 'Anatomy',
    description: 'People have plausible bodies and hands.',
    availability: 'simulated',
    note: SIMULATED_NOTE,
    requiresReference: false,
    defaultEnabled: true,
  },
  {
    id: 'motion-inconsistency',
    category: 'motion-inconsistency',
    label: 'Motion consistency',
    description: 'Movement is continuous and plausible.',
    availability: 'simulated',
    note: SIMULATED_NOTE,
    requiresReference: false,
    defaultEnabled: true,
  },
  {
    id: 'exposure-flicker',
    category: 'exposure-flicker',
    label: 'Exposure flicker',
    description: 'Brightness stays stable frame to frame.',
    availability: 'simulated',
    note: `${SIMULATED_NOTE} A future adapter can measure this from frame luminance.`,
    requiresReference: false,
    defaultEnabled: true,
  },
  {
    id: 'script-adherence',
    category: 'script-adherence',
    label: 'Script adherence',
    description: 'The shot matches the script or prompt.',
    availability: 'simulated',
    note: SIMULATED_NOTE,
    requiresReference: false,
    defaultEnabled: false,
  },
  {
    id: 'reference-divergence',
    category: 'other',
    label: 'Divergence from reference',
    description: 'Compares the take against attached source footage.',
    availability: 'unavailable',
    note: 'Needs a local analysis backend. Not available in demo mode.',
    requiresReference: true,
    defaultEnabled: false,
  },
  {
    id: 'text-signage',
    category: 'text-signage',
    label: 'Text and signage',
    description: 'On-screen text stays legible and unchanged.',
    availability: 'unavailable',
    note: 'No detector available. File these as manual findings.',
    requiresReference: false,
    defaultEnabled: false,
  },
];

/** Small deterministic PRNG so a given run produces stable output. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function simulateFindings(request: ReviewRequest, seedKey: string): AnalyzerFinding[] {
  const runnable = request.checks.filter((id) => DEMO_CHECKS.some((c) => c.id === id && c.availability === 'simulated'));
  if (runnable.length === 0) return [];
  const rand = mulberry32(hashString(seedKey));
  const duration = request.generated.durationSec && request.generated.durationSec > 0 ? request.generated.durationSec : 10;
  const count = Math.min(runnable.length, 1 + Math.floor(rand() * 3));
  const pool = [...runnable];
  const picked: string[] = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return picked
    .map((checkId) => {
      const check = DEMO_CHECKS.find((c) => c.id === checkId)!;
      const length = Math.min(duration, 0.4 + rand() * 1.4);
      const start = round2(rand() * Math.max(0, duration - length));
      const end = round2(Math.min(duration, start + length));
      const mid = round2((start + end) / 2);
      const finding: AnalyzerFinding = {
        category: check.category,
        description: `Simulated candidate: possible ${categoryLabel(check.category).toLowerCase()} issue. Demo output for trying the workflow; it is not based on this video's content.`,
        startSec: start,
        endSec: end,
        origin: 'simulation',
        confidence: null,
        detector: 'demo-simulator',
        // No spatial annotations: the demo has no real coordinates to offer.
        annotations: [],
        evidenceFrames: [
          { timeSec: start, caption: 'Frame at interval start' },
          { timeSec: mid, caption: 'Frame at interval midpoint' },
        ],
      };
      return finding;
    })
    .sort((a, b) => a.startSec - b.startSec);
}

interface DemoRun {
  request: ReviewRequest;
  onEvent: (event: ReviewEvent) => void;
  timer: ReturnType<typeof setTimeout> | null;
  state: 'running' | 'completed' | 'failed' | 'canceled';
  result: AnalysisResult | null;
}

export class DemoAnalysisService implements AnalysisService {
  readonly info: AnalyzerInfo = {
    id: 'demo',
    label: 'Demo adapter',
    kind: 'demo',
    simulated: true,
    description:
      'Produces simulated findings so you can try the review workflow. It does not analyse your video. Connect a local analysis backend for real detections.',
  };

  private readonly runs = new Map<string, DemoRun>();
  private counter = 0;
  private readonly getOptions: () => DemoOptions;

  constructor(getOptions: () => DemoOptions) {
    this.getOptions = getOptions;
  }

  async listChecks(): Promise<AnalysisCheck[]> {
    return DEMO_CHECKS.map((c) => ({ ...c }));
  }

  async importAsset(input: ImportAssetInput): Promise<ImportAssetResult> {
    // Nothing is uploaded. The demo keeps an alias to ClearFrame's own asset ID.
    if (input.signal?.aborted) {
      throw new AnalysisServiceError({ code: 'aborted', message: 'Import was canceled.', retryable: true });
    }
    return { backendAssetId: `demo:${input.localAssetId}` };
  }

  async submitReview(request: ReviewRequest, onEvent: (event: ReviewEvent) => void): Promise<SubmittedReview> {
    const runnable = request.checks.filter((id) => DEMO_CHECKS.some((c) => c.id === id && c.availability !== 'unavailable'));
    if (runnable.length === 0) {
      throw new AnalysisServiceError({
        code: 'no-runnable-checks',
        message: 'None of the selected checks can run with the demo adapter.',
        retryable: false,
      });
    }
    const options = this.getOptions();
    this.counter += 1;
    const serviceRunId = `demo-run-${Date.now().toString(36)}-${this.counter}`;
    const run: DemoRun = { request, onEvent, timer: null, state: 'running', result: null };
    this.runs.set(serviceRunId, run);

    const steps = [
      'Preparing (simulated)',
      ...runnable.map((id) => `Simulating check: ${DEMO_CHECKS.find((c) => c.id === id)?.label ?? id}`),
      'Assembling simulated results',
    ];
    const stepMs = Math.max(50, options.durationMs / steps.length);
    let index = 0;

    const tick = () => {
      if (run.state !== 'running') return;
      if (index < steps.length) {
        onEvent({ type: 'progress', progress: index / steps.length, message: steps[index] });
        index += 1;
        run.timer = setTimeout(tick, stepMs);
        return;
      }
      run.timer = null;
      if (options.behavior === 'fail') {
        run.state = 'failed';
        onEvent({
          type: 'failed',
          error: {
            code: 'demo-simulated-failure',
            message: 'Simulated failure from the demo adapter. Change this under Settings → Analysis.',
            retryable: true,
          },
        });
        return;
      }
      const findings = options.behavior === 'no-findings' ? [] : simulateFindings(request, `${request.takeId}:${serviceRunId}`);
      run.result = {
        serviceRunId,
        findings,
        warnings: ['All findings in this run are simulated by the demo adapter.'],
      };
      run.state = 'completed';
      onEvent({ type: 'progress', progress: 1, message: 'Done (simulated)' });
      onEvent({ type: 'completed' });
    };
    run.timer = setTimeout(tick, 0);
    return { serviceRunId };
  }

  async getResult(serviceRunId: string): Promise<unknown> {
    const run = this.runs.get(serviceRunId);
    if (!run || run.state !== 'completed' || !run.result) {
      throw new AnalysisServiceError({
        code: 'result-unavailable',
        message: 'No result is available for this run.',
        retryable: false,
      });
    }
    return structuredClone(run.result);
  }

  async cancelReview(serviceRunId: string): Promise<void> {
    const run = this.runs.get(serviceRunId);
    if (!run || run.state !== 'running') return;
    if (run.timer) clearTimeout(run.timer);
    run.timer = null;
    run.state = 'canceled';
    run.onEvent({ type: 'canceled' });
  }
}
