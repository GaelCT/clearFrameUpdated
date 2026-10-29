import type { AnalysisRun, Finding, Project, Take } from './schemas';

export type TakeStatus =
  | 'not-reviewed'
  | 'in-progress'
  | 'needs-decisions'
  | 'issues-confirmed'
  | 'no-findings'
  | 'no-open-issues'
  | 'failed'
  | 'canceled'
  | 'accepted';

export interface TakeStatusInfo {
  status: TakeStatus;
  label: string;
  tone: 'neutral' | 'progress' | 'candidate' | 'confirmed' | 'ok' | 'error' | 'muted';
  pendingRechecks: number;
}

export function runsForTake(project: Project, takeId: string): AnalysisRun[] {
  return project.runs.filter((r) => r.takeId === takeId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function latestRun(project: Project, takeId: string): AnalysisRun | null {
  const runs = runsForTake(project, takeId);
  return runs.length ? runs[runs.length - 1] : null;
}

export function findingsForTake(project: Project, takeId: string): Finding[] {
  return project.findings.filter((f) => f.takeId === takeId).sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

export function takeStatus(project: Project, take: Take): TakeStatusInfo {
  const run = latestRun(project, take.id);
  const findings = project.findings.filter((f) => f.takeId === take.id);
  const candidates = findings.filter((f) => f.reviewState === 'candidate').length;
  const confirmed = findings.filter((f) => f.reviewState === 'confirmed').length;
  const pendingRechecks = take.recheck.filter((r) => r.status === 'pending').length;
  const base = { pendingRechecks };

  if (take.acceptance) return { ...base, status: 'accepted', label: 'Accepted', tone: 'ok' };
  if (run && (run.status === 'running' || run.status === 'queued')) {
    return { ...base, status: 'in-progress', label: 'Reviewing…', tone: 'progress' };
  }
  if (candidates > 0) return { ...base, status: 'needs-decisions', label: `${candidates} to decide`, tone: 'candidate' };
  if (confirmed > 0) return { ...base, status: 'issues-confirmed', label: `${confirmed} confirmed`, tone: 'confirmed' };
  if (run?.status === 'failed') return { ...base, status: 'failed', label: 'Review failed', tone: 'error' };
  if (run?.status === 'canceled') return { ...base, status: 'canceled', label: 'Review canceled', tone: 'muted' };
  if (run?.status === 'completed') {
    return findings.length === 0
      ? { ...base, status: 'no-findings', label: 'No findings', tone: 'ok' }
      : { ...base, status: 'no-open-issues', label: 'No open issues', tone: 'ok' };
  }
  if (findings.length > 0) return { ...base, status: 'no-open-issues', label: 'No open issues', tone: 'ok' };
  return { ...base, status: 'not-reviewed', label: 'Not reviewed', tone: 'neutral' };
}

export function takeTitle(take: Pick<Take, 'number'>): string {
  return `Take ${take.number}`;
}

export function nextTakeNumber(project: Project, shotId: string): number {
  return project.takes.filter((t) => t.shotId === shotId).reduce((max, t) => Math.max(max, t.number), 0) + 1;
}
