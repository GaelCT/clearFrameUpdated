import { useEffect, useState, type ReactNode } from 'react';
import type { AnalysisCheck, AnalyzerInfo } from '../../analysis/contract';
import { getAnalysisService } from '../../analysis/registry';
import { cancelReview, startReview } from '../../analysis/reviewRunner';
import type { AnalysisRun, Project } from '../../domain/schemas';
import { runsForTake } from '../../domain/status';
import { formatDateTime } from '../../domain/time';
import { useSettings } from '../../state/settingsStore';
import { useUi } from '../../state/uiStore';
import { SimulatedBadge } from '../components/Badges';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import type { ReviewContext } from './context';

export function useAnalyzer(): { info: AnalyzerInfo; checks: AnalysisCheck[] | null; error: string | null } {
  const adapterId = useSettings((s) => s.adapterId);
  const service = getAnalysisService();
  const [state, setState] = useState<{ adapterId: string; checks: AnalysisCheck[] | null; error: string | null }>({
    adapterId,
    checks: null,
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    getAnalysisService()
      .listChecks()
      .then((checks) => {
        if (!cancelled) setState({ adapterId, checks, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ adapterId, checks: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [adapterId]);
  const current = state.adapterId === adapterId ? state : { checks: null, error: null };
  return { info: service.info, checks: current.checks, error: current.error };
}

function runLabel(run: AnalysisRun, index: number): string {
  return `Run ${index + 1} · ${run.adapterLabel}`;
}

/** Status strip for the take's latest review run, with run/cancel/retry actions. */
export function RunStatus({ project, ctx }: { project: Project; ctx: ReviewContext }) {
  const runs = runsForTake(project, ctx.take.id);
  const run = runs.length ? runs[runs.length - 1] : null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const findings = project.findings.filter((f) => f.takeId === ctx.take.id);
  const runFindings = run ? findings.filter((f) => f.runId === run.id) : [];
  const unplayable = ctx.asset?.playback.status === 'unsupported';

  let body: ReactNode;
  let tone = 'neutral';
  if (!run) {
    body = (
      <>
        <strong>No review run yet.</strong>{' '}
        <span className="muted">
          {findings.length ? `${findings.length} manual finding${findings.length === 1 ? '' : 's'} so far.` : 'Run a review, or add findings by hand.'}
        </span>
      </>
    );
  } else if (run.status === 'queued' || run.status === 'running') {
    tone = 'progress';
    body = (
      <>
        <strong>Review in progress</strong>
        {run.simulated && <SimulatedBadge label="Demo · simulated" />}
        <span className="run-status__message">{run.message ?? 'Working…'}</span>
        <progress className="run-status__progress" max={1} value={run.progress} aria-label="Review progress" />
        <span className="muted">{Math.round(run.progress * 100)}%</span>
      </>
    );
  } else if (run.status === 'completed') {
    tone = runFindings.length ? 'candidate' : 'ok';
    body = (
      <>
        <strong>{runFindings.length ? `Review complete: ${runFindings.length} finding${runFindings.length === 1 ? '' : 's'}` : 'Review complete: no findings'}</strong>
        {run.simulated && <SimulatedBadge label={run.adapterId === 'sample' ? 'Sample data · simulated' : 'Demo · simulated'} />}
        <span className="muted">
          {runLabel(run, runs.length - 1)} · {formatDateTime(run.finishedAt)}
        </span>
      </>
    );
  } else if (run.status === 'canceled') {
    tone = 'muted';
    body = (
      <>
        <strong>Review canceled.</strong> <span className="muted">{run.message ?? ''} No results were kept from this run.</span>
      </>
    );
  } else {
    tone = 'error';
    body = (
      <>
        <strong>Review failed.</strong> <span>{run.error?.message ?? 'Unknown error.'}</span>
      </>
    );
  }

  const busy = run?.status === 'queued' || run?.status === 'running';
  return (
    <div className={`run-status run-status--${tone}`} role="status" aria-live="polite" data-testid="run-status">
      <div className="run-status__body">{body}</div>
      <div className="run-status__actions">
        {busy ? (
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => run && void cancelReview(run.id)}>
            <Icon name="stop" /> Cancel review
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => setDialogOpen(true)}
            disabled={!ctx.asset}
            title={unplayable ? 'This file cannot be played here, but it can still be sent for review.' : undefined}
          >
            <Icon name={run?.status === 'failed' ? 'refresh' : 'play'} />
            {run?.status === 'failed' ? 'Retry review' : run ? 'Run again' : 'Run review'}
          </button>
        )}
      </div>
      <RunDialog open={dialogOpen} onClose={() => setDialogOpen(false)} project={project} ctx={ctx} />
    </div>
  );
}

function RunDialog({ open, onClose, project, ctx }: { open: boolean; onClose: () => void; project: Project; ctx: ReviewContext }) {
  const { info, checks, error } = useAnalyzer();
  const [selection, setSelection] = useState<string[] | null>(null);
  const saved = project.reviewConfig.checks;
  const defaults = checks?.filter((c) => c.availability !== 'unavailable' && c.defaultEnabled).map((c) => c.id) ?? [];
  const selected = (selection ?? saved ?? defaults).filter((id) => checks?.some((c) => c.id === id && c.availability !== 'unavailable'));
  const words = project.script.text.trim() ? project.script.text.trim().split(/\s+/).length : 0;

  const toggle = (id: string) => {
    const set = new Set(selected);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setSelection([...set]);
  };

  const close = () => {
    setSelection(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={`Run review · Take ${ctx.take.number}`}
      onClose={close}
      wide
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={selected.length === 0}
            onClick={() => {
              const chosen = selected;
              close();
              useUi.setState({ findingFilter: 'all', runFilter: 'all' });
              void startReview(ctx.take.id, chosen);
            }}
          >
            Start review
          </button>
        </>
      }
    >
      {info.simulated && (
        <div className="notice notice--sim" role="note">
          <strong>Demo analysis.</strong> {info.label} returns simulated findings for trying the workflow. It does not look
          at your video, and its results are labeled “Simulated” everywhere they appear.
        </div>
      )}
      <ul className="context-list">
        <li>
          <strong>Video:</strong> {ctx.asset?.displayName ?? 'none'}
          {ctx.asset?.playback.status === 'unsupported' && <span className="badge badge--tone-error">Can’t play here</span>}
        </li>
        <li>
          <strong>Reference footage:</strong>{' '}
          {ctx.reference
            ? `${ctx.reference.displayName} (offset ${ctx.shot.referenceOffsetSec >= 0 ? '+' : ''}${ctx.shot.referenceOffsetSec.toFixed(2)} s)`
            : 'none. The review uses the script and prompt only.'}
        </li>
        <li>
          <strong>Script:</strong> {words ? `${words} words` : 'none provided'} · <strong>Generation prompt:</strong>{' '}
          {ctx.take.generationPrompt.trim() ? 'provided' : 'none'}
        </li>
      </ul>
      <fieldset className="check-list">
        <legend>Checks</legend>
        {error && <p className="notice notice--error">Could not load checks: {error}</p>}
        {!checks && !error && <p className="muted">Loading checks…</p>}
        {checks?.map((c) => {
          const unavailable = c.availability === 'unavailable';
          const needsRef = c.requiresReference && !ctx.reference;
          return (
            <label key={c.id} className={`check-item${unavailable ? ' check-item--disabled' : ''}`}>
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                disabled={unavailable || needsRef}
                onChange={() => toggle(c.id)}
              />
              <span className="check-item__text">
                <span className="check-item__label">
                  {c.label}
                  {c.availability === 'simulated' && <SimulatedBadge />}
                  {c.availability === 'available' && <span className="badge badge--tone-ok">Detector</span>}
                  {unavailable && <span className="badge badge--tone-muted">Not available</span>}
                </span>
                <span className="check-item__desc">
                  {c.description} {c.note && <span className="muted">{c.note}</span>}
                  {needsRef && !unavailable && <span className="muted"> Needs reference footage.</span>}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </Dialog>
  );
}
