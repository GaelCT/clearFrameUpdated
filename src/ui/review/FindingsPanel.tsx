import { useEffect, useId, useRef, useState } from 'react';
import { categoryLabel, ISSUE_CATEGORIES } from '../../domain/categories';
import { shortId } from '../../domain/ids';
import type { DecisionEvent, Finding, Project } from '../../domain/schemas';
import { findingsForTake, latestRun, runsForTake } from '../../domain/status';
import { formatDateTime, formatTime } from '../../domain/time';
import { useAssetMedia } from '../../media/mediaRegistry';
import { player, usePlayer } from '../../state/playerStore';
import {
  addBoxAnnotation,
  addEvidenceFrame,
  addManualFinding,
  deleteManualFinding,
  removeAnnotation,
  removeEvidenceFrame,
  setFindingDescriptionDraft,
  setFindingState,
  updateFindingDetails,
  updateFindingInterval,
  updateFindingNotes,
} from '../../state/reviewActions';
import { selectFinding, useUi, type FindingFilter } from '../../state/uiStore';
import { OriginBadge, ReviewStateBadge, reviewStateLabel } from '../components/Badges';
import { AutoTextarea, TimeInput } from '../components/Fields';
import { FrameStill } from '../components/FrameStill';
import { Icon } from '../components/Icon';
import type { ReviewContext } from './context';
import { selectAndSeek } from './Timeline';

export function addFindingAtPlayhead(takeId: string, duration: number | null): void {
  const t = usePlayer.getState().currentTime;
  const end = duration != null ? Math.min(duration, t + 1) : t + 1;
  addManualFinding({ takeId, category: 'other', description: '', startSec: t, endSec: Math.max(end, t) });
}

const FILTERS: { id: FindingFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'candidate', label: 'Candidates' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'dismissed', label: 'Dismissed' },
];

export function FindingsPanel({ project, ctx }: { project: Project; ctx: ReviewContext }) {
  const { findingFilter, runFilter, selectedFindingId } = useUi();
  const findings = findingsForTake(project, ctx.take.id);
  const runs = runsForTake(project, ctx.take.id);
  const run = latestRun(project, ctx.take.id);
  const runSelectId = useId();

  const byRun = findings.filter((f) => (runFilter === 'all' ? true : runFilter === 'manual' ? f.runId === null : f.runId === runFilter));
  const filtered = byRun.filter((f) => findingFilter === 'all' || f.reviewState === findingFilter);
  const count = (state: FindingFilter) => (state === 'all' ? byRun.length : byRun.filter((f) => f.reviewState === state).length);
  const anySimulated = findings.some((f) => f.origin === 'simulation');

  let empty: string;
  if (findings.length === 0) {
    if (!run) empty = 'No findings yet. Run a review, or add findings by hand while you watch.';
    else if (run.status === 'running' || run.status === 'queued') empty = 'Review in progress. Findings will appear here when it finishes.';
    else if (run.status === 'completed') empty = 'The last review returned no findings. You can still add findings by hand.';
    else if (run.status === 'failed') empty = 'The last review failed, so there are no results. Retry it or add findings by hand.';
    else empty = 'The last review was canceled before it returned results.';
  } else empty = 'No findings match these filters.';

  return (
    <div className="findings-panel">
      {anySimulated && (
        <div className="notice notice--sim" role="note">
          Findings marked <strong>Simulated</strong> come from the demo adapter or sample data. They were not detected in your
          video. Confirm only what you can see yourself.
        </div>
      )}
      <div className="panel-toolbar">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => addFindingAtPlayhead(ctx.take.id, ctx.asset?.media.durationSec ?? null)}
          title="Add a manual finding at the playhead (N)"
          data-testid="add-finding"
        >
          <Icon name="plus" /> Add finding at playhead
        </button>
        {runs.length > 0 && (
          <span className="field field--inline">
            <label htmlFor={runSelectId} className="visually-hidden">
              Source
            </label>
            <select id={runSelectId} className="input input--compact" value={runFilter} onChange={(e) => useUi.setState({ runFilter: e.target.value })}>
              <option value="all">All sources</option>
              <option value="manual">Manual only</option>
              {runs.map((r, i) => (
                <option key={r.id} value={r.id}>
                  Run {i + 1} · {r.adapterLabel}
                  {r.simulated ? ' (simulated)' : ''}
                </option>
              ))}
            </select>
          </span>
        )}
      </div>
      <div className="segmented segmented--full" role="group" aria-label="Filter by decision">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={findingFilter === f.id} onClick={() => useUi.setState({ findingFilter: f.id })}>
            {f.label} <span className="segmented__count">{count(f.id)}</span>
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="empty-note">{empty}</p>
      ) : (
        <ul className="finding-list" aria-label="Findings">
          {filtered.map((f) => (
            <li key={f.id}>
              <FindingCard finding={f} selected={f.id === selectedFindingId} />
              {f.id === selectedFindingId && <FindingDetail finding={f} project={project} ctx={ctx} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingCard({ finding: f, selected }: { finding: Finding; selected: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      className={`finding-card finding-card--${f.reviewState}${selected ? ' finding-card--selected' : ''}`}
      aria-expanded={selected}
      onClick={() => selectAndSeek(f)}
      data-testid="finding-card"
      data-finding-id={f.id}
    >
      <span className="finding-card__top">
        <span className="finding-card__cat">{categoryLabel(f.category)}</span>
        <ReviewStateBadge state={f.reviewState} />
      </span>
      <span className="finding-card__time">
        {formatTime(f.startSec)} – {formatTime(f.endSec)} <span className="muted">({(f.endSec - f.startSec).toFixed(2)} s)</span>
      </span>
      {f.description && <span className="finding-card__desc">{f.description}</span>}
      <span className="finding-card__badges">
        <OriginBadge origin={f.origin} />
        {f.annotations.length > 0 && <span className="badge badge--tone-neutral">Region</span>}
        {f.notes && <span className="badge badge--tone-neutral">Notes</span>}
        {f.recheckOfFindingId && <span className="badge badge--tone-neutral">From re-check</span>}
      </span>
    </button>
  );
}

function historyText(e: DecisionEvent): string {
  switch (e.action) {
    case 'created':
      return 'Created';
    case 'confirmed':
      return 'Confirmed';
    case 'dismissed':
      return 'Dismissed';
    case 'reopened':
      return `Returned to candidate${e.fromState ? ` (was ${reviewStateLabel(e.fromState).toLowerCase()})` : ''}`;
    case 'interval-edited':
      return 'Interval edited';
    case 'details-edited':
      return 'Details edited';
    case 'notes-edited':
      return 'Notes edited';
    case 'annotation-added':
      return 'Region added';
    case 'annotation-removed':
      return 'Region removed';
    case 'evidence-added':
      return 'Evidence frame added';
    case 'evidence-removed':
      return 'Evidence frame removed';
  }
}

function FindingDetail({ finding: f, project, ctx }: { finding: Finding; project: Project; ctx: ReviewContext }) {
  const media = useAssetMedia(ctx.asset?.id);
  const duration = ctx.asset?.media.durationSec ?? null;
  const categoryId = useId();
  const run = f.runId ? project.runs.find((r) => r.id === f.runId) : undefined;
  const editable = f.origin === 'manual';
  const [coords, setCoords] = useState({ x: 10, y: 10, w: 20, h: 20 });

  const setStartToPlayhead = () => {
    const t = usePlayer.getState().currentTime;
    updateFindingInterval(f.id, Math.min(t, f.endSec), f.endSec, { startSec: f.startSec, endSec: f.endSec });
  };
  const setEndToPlayhead = () => {
    const t = usePlayer.getState().currentTime;
    updateFindingInterval(f.id, f.startSec, Math.max(t, f.startSec), { startSec: f.startSec, endSec: f.endSec });
  };

  return (
    <section className="finding-detail" aria-label={`Details for ${categoryLabel(f.category)} finding`} data-testid="finding-detail">
      <div className="finding-detail__ids">
        <span title={f.id}>ID {shortId(f.id)}</span>
        {run ? (
          <span title={run.id}>
            {run.adapterLabel} · run {shortId(run.id)}
          </span>
        ) : (
          <span>Manual annotation</span>
        )}
        {f.detector && <span>Detector: {f.detector}</span>}
      </div>

      {f.origin === 'simulation' && (
        <p className="notice notice--sim notice--inline">
          Simulated finding. It illustrates the workflow and was not detected in this video.
        </p>
      )}
      {f.confidence != null && (
        <p className="finding-detail__confidence">
          Analyzer-reported confidence: <strong>{f.confidence.toFixed(2)}</strong>
        </p>
      )}

      {editable ? (
        <>
          <div className="field">
            <label htmlFor={categoryId}>Category</label>
            <select id={categoryId} className="input" value={f.category} onChange={(e) => updateFindingDetails(f.id, { category: e.target.value })}>
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <DescriptionField finding={f} />
        </>
      ) : (
        <p className="finding-detail__desc">{f.description}</p>
      )}

      <div className="finding-detail__interval">
        <TimeInput
          label="Start"
          value={f.startSec}
          max={f.endSec}
          testId="finding-start"
          onCommit={(s) => updateFindingInterval(f.id, s, f.endSec, { startSec: f.startSec, endSec: f.endSec })}
        />
        <TimeInput
          label="End"
          value={f.endSec}
          min={f.startSec}
          max={duration}
          testId="finding-end"
          onCommit={(e) => updateFindingInterval(f.id, f.startSec, e, { startSec: f.startSec, endSec: f.endSec })}
        />
      </div>
      <div className="row row--wrap">
        <button type="button" className="btn btn--ghost btn--sm" onClick={setStartToPlayhead} title="Set start to playhead (I)">
          Start = playhead
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={setEndToPlayhead} title="Set end to playhead (O)">
          End = playhead
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => player.playRange(f.startSec, f.endSec)}>
          <Icon name="play" /> Play interval
        </button>
      </div>

      <div className="decision" role="group" aria-label="Decision">
        <span className="decision__label">
          Decision: <ReviewStateBadge state={f.reviewState} />
        </span>
        <div className="row">
          <button
            type="button"
            className="btn btn--confirm btn--sm"
            aria-pressed={f.reviewState === 'confirmed'}
            disabled={f.reviewState === 'confirmed'}
            onClick={() => setFindingState(f.id, 'confirmed')}
            title="Confirm (C)"
            data-testid="confirm-finding"
          >
            <Icon name="check" /> Confirm
          </button>
          <button
            type="button"
            className="btn btn--dismiss btn--sm"
            aria-pressed={f.reviewState === 'dismissed'}
            disabled={f.reviewState === 'dismissed'}
            onClick={() => setFindingState(f.id, 'dismissed')}
            title="Dismiss (X)"
            data-testid="dismiss-finding"
          >
            <Icon name="x" /> Dismiss
          </button>
          {f.reviewState !== 'candidate' && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFindingState(f.id, 'candidate')} title="Return to candidate (U)" data-testid="reopen-finding">
              <Icon name="undo" /> Revise
            </button>
          )}
        </div>
      </div>

      <AutoTextarea
        label="Reviewer notes"
        value={f.notes}
        rows={2}
        placeholder="What you saw, why you decided this way"
        testId="finding-notes"
        onChange={(v) => updateFindingNotes(f.id, v, false)}
        onEditFinished={(v) => updateFindingNotes(f.id, v, true)}
      />

      <div className="finding-detail__section">
        <h4>Spatial regions</h4>
        {f.annotations.length === 0 ? (
          <p className="muted">
            No region coordinates{f.origin === 'manual' ? ' yet' : ' were supplied'}. Nothing is highlighted on the video. Use “Draw region”
            above the player to mark one.
          </p>
        ) : (
          <ul className="annotation-list">
            {f.annotations.map((a, i) => (
              <li key={a.id}>
                <span>
                  Region {i + 1}
                  {a.label ? ` “${a.label}”` : ''}:{' '}
                  {a.type === 'box'
                    ? `x ${Math.round(a.x * 100)}%, y ${Math.round(a.y * 100)}%, ${Math.round(a.w * 100)}×${Math.round(a.h * 100)}%`
                    : `polygon, ${a.points.length} points`}
                  {a.startSec != null && a.endSec != null && ` · ${formatTime(a.startSec)}–${formatTime(a.endSec)}`}
                </span>
                <span className={`badge badge--${a.source === 'simulation' ? 'sim' : 'tone-neutral'}`}>
                  {a.source === 'simulation' ? 'Simulated' : a.source === 'manual' ? 'Manual' : 'Analyzer'}
                </span>
                {a.source === 'manual' && (
                  <button type="button" className="icon-btn" aria-label={`Remove region ${i + 1}`} onClick={() => removeAnnotation(f.id, a.id)}>
                    <Icon name="trash" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <details className="coords-form">
          <summary>Add a region by coordinates</summary>
          <div className="coords-form__grid">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <label key={k} className="field field--compact">
                <span>{k === 'x' ? 'Left %' : k === 'y' ? 'Top %' : k === 'w' ? 'Width %' : 'Height %'}</span>
                <input
                  type="number"
                  className="input input--compact"
                  min={0}
                  max={100}
                  value={coords[k]}
                  onChange={(e) => setCoords({ ...coords, [k]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={coords.w <= 0 || coords.h <= 0}
            onClick={() => addBoxAnnotation(f.id, { x: coords.x / 100, y: coords.y / 100, w: coords.w / 100, h: coords.h / 100 }, null)}
          >
            Add region
          </button>
        </details>
      </div>

      <div className="finding-detail__section">
        <div className="section-header">
          <h4>Evidence frames</h4>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              const t = usePlayer.getState().currentTime;
              addEvidenceFrame(f.id, t, `Frame at ${formatTime(t)}`);
            }}
            disabled={!media?.url}
          >
            <Icon name="camera" /> Add current frame
          </button>
        </div>
        {f.evidenceFrames.length === 0 ? (
          <p className="muted">No evidence frames.</p>
        ) : (
          <ul className="evidence-grid">
            {f.evidenceFrames.map((e) => (
              <li key={e.id} className="evidence">
                <button type="button" className="evidence__button" onClick={() => player.seek(e.timeSec)} aria-label={`Go to ${formatTime(e.timeSec)}: ${e.caption}`}>
                  <FrameStill url={media?.url ?? null} timeSec={e.timeSec} alt={`${e.caption} at ${formatTime(e.timeSec)}`} />
                  <span className="evidence__caption">
                    <span className="mono">{formatTime(e.timeSec)}</span> {e.caption}
                  </span>
                </button>
                {e.source === 'manual' && (
                  <button type="button" className="icon-btn evidence__remove" aria-label={`Remove frame at ${formatTime(e.timeSec)}`} onClick={() => removeEvidenceFrame(f.id, e.id)}>
                    <Icon name="trash" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="field__hint">Frames are rendered from this take’s video at the listed times.</p>
      </div>

      <details className="finding-detail__section" open={f.history.length <= 3}>
        <summary>
          <h4>Decision history ({f.history.length})</h4>
        </summary>
        <ol className="history-list">
          {[...f.history].reverse().map((e) => (
            <li key={e.id}>
              <span className="history-list__what">{historyText(e)}</span>
              {e.detail && <span className="history-list__detail">{e.detail}</span>}
              <time dateTime={e.at} className="muted">
                {formatDateTime(e.at)}
              </time>
            </li>
          ))}
        </ol>
      </details>

      <div className="row row--wrap finding-detail__footer">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => selectFinding(null)}>
          Close details
        </button>
        {f.origin === 'manual' && (
          <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => deleteManualFinding(f.id)}>
            <Icon name="trash" /> Delete manual finding
          </button>
        )}
      </div>
    </section>
  );
}

function DescriptionField({ finding: f }: { finding: Finding }) {
  const id = useId();
  const [start, setStart] = useState<string | null>(null);
  const isNew = f.description === '' && f.history.length <= 1;
  return (
    <div className="field">
      <label htmlFor={id}>Description</label>
      <textarea
        id={id}
        className="input textarea"
        rows={2}
        value={f.description}
        autoFocus={isNew}
        placeholder="Describe the flaw: what changes, where, and when"
        data-testid="finding-description"
        onFocus={() => setStart(f.description)}
        onChange={(e) => {
          // Live update without logging; a single history entry is recorded on blur.
          setFindingDescriptionDraft(f.id, e.target.value);
        }}
        onBlur={() => {
          if (start !== null && start !== f.description) {
            const current = f.description;
            setFindingDescriptionDraft(f.id, start);
            updateFindingDetails(f.id, { description: current });
          }
          setStart(null);
        }}
      />
    </div>
  );
}
