import { useId, useState } from 'react';
import { getApprovalState } from '../../domain/approval';
import { categoryLabel } from '../../domain/categories';
import { shortId } from '../../domain/ids';
import type { Project, RecheckStatus } from '../../domain/schemas';
import { findingsForTake, runsForTake } from '../../domain/status';
import { formatDateTime, formatDuration, formatTime } from '../../domain/time';
import { VIDEO_ACCEPT } from '../../media/probe';
import { setTakePrompt } from '../../state/mediaActions';
import { player } from '../../state/playerStore';
import { acceptanceCheck, acceptTake, defaultRetakeLink, importRetake, reopenTake, setRecheckNote, setRecheckStatus } from '../../state/takeActions';
import { pushToast } from '../../state/toastStore';
import { selectTake, useUi } from '../../state/uiStore';
import { OriginBadge } from '../components/Badges';
import { Dialog } from '../components/Dialog';
import { DropZone } from '../components/DropZone';
import { AutoTextarea } from '../components/Fields';
import { Icon } from '../components/Icon';
import type { ReviewContext } from './context';

const RECHECK_LABEL: Record<RecheckStatus, string> = {
  pending: 'Needs re-check',
  'verified-fixed': 'Verified fixed',
  'still-present': 'Still present',
};

export function TakePanel({ project, ctx }: { project: Project; ctx: ReviewContext }) {
  const { take } = ctx;
  const children = project.takes.filter((t) => t.parentTakeId === take.id);
  const correction = take.correctionId ? project.corrections.find((c) => c.id === take.correctionId) : undefined;
  const version = correction?.versions.find((v) => v.id === take.promptVersionId);

  return (
    <div className="take-panel">
      <section className="take-section">
        <h3 className="panel-title">Take {take.number}</h3>
        <dl className="meta-grid">
          <div>
            <dt>File</dt>
            <dd>{ctx.asset?.fileName ?? 'None'}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(ctx.asset?.media.durationSec)}</dd>
          </div>
          <div>
            <dt>Take ID</dt>
            <dd className="mono" title={take.id}>
              {shortId(take.id)}
            </dd>
          </div>
          <div>
            <dt>Parent</dt>
            <dd>
              {ctx.parentTake ? (
                <button type="button" className="link-btn" onClick={() => selectTake(ctx.parentTake!.shotId, ctx.parentTake!.id)}>
                  Take {ctx.parentTake.number}
                </button>
              ) : (
                'None (original take)'
              )}
            </dd>
          </div>
          {ctx.parentTake && (
            <div>
              <dt>Generated from</dt>
              <dd>{version ? `Approved prompt v${version.number}` : 'No linked prompt version'}</dd>
            </div>
          )}
          {children.length > 0 && (
            <div>
              <dt>Retakes</dt>
              <dd>
                {children.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ', '}
                    <button type="button" className="link-btn" onClick={() => selectTake(c.shotId, c.id)}>
                      Take {c.number}
                    </button>
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
        <AutoTextarea
          label="Generation prompt"
          value={take.generationPrompt}
          rows={3}
          placeholder="The prompt used to generate this take"
          hint="Kept separately from the project script and from reviewer notes."
          onChange={(v) => setTakePrompt(take.id, v)}
        />
      </section>

      {ctx.parentTake && <RecheckSection project={project} ctx={ctx} />}

      <AcceptanceSection ctx={ctx} />

      <RetakeSection project={project} ctx={ctx} />

      <HistorySection project={project} ctx={ctx} />
    </div>
  );
}

function RecheckSection({ project, ctx }: { project: Project; ctx: ReviewContext }) {
  const { take, parentTake } = ctx;
  if (!parentTake) return null;
  const pending = take.recheck.filter((r) => r.status === 'pending').length;
  return (
    <section className="take-section" aria-labelledby="recheck-heading">
      <h3 id="recheck-heading" className="panel-title">
        Earlier findings to re-check
      </h3>
      <p className="notice notice--info notice--inline">
        Importing a retake does not fix anything by itself. Review Take {take.number} on its own, then mark each issue confirmed
        on Take {parentTake.number}. {pending > 0 ? `${pending} still need${pending === 1 ? 's' : ''} a decision.` : 'All re-checks are decided.'}
      </p>
      {take.recheck.length === 0 ? (
        <p className="muted">Take {parentTake.number} had no confirmed findings when this retake was imported.</p>
      ) : (
        <ul className="recheck-list">
          {take.recheck.map((r) => {
            const f = project.findings.find((x) => x.id === r.parentFindingId);
            if (!f) return null;
            return (
              <li key={r.parentFindingId} className={`recheck recheck--${r.status}`} data-testid="recheck-item">
                <div className="recheck__head">
                  <strong>{categoryLabel(f.category)}</strong>
                  <span className="mono">
                    {formatTime(f.startSec)}–{formatTime(f.endSec)}
                  </span>
                  <OriginBadge origin={f.origin} />
                  <span className={`badge badge--recheck-${r.status}`}>{RECHECK_LABEL[r.status]}</span>
                </div>
                {f.description && <p className="recheck__desc">{f.description}</p>}
                <div className="row row--wrap">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      useUi.setState({ compareMode: 'parent' });
                      player.seek(f.startSec);
                    }}
                  >
                    <Icon name="columns" /> Compare here
                  </button>
                  <button
                    type="button"
                    className="btn btn--confirm-outline btn--sm"
                    aria-pressed={r.status === 'verified-fixed'}
                    onClick={() => setRecheckStatus(take.id, f.id, 'verified-fixed')}
                  >
                    Verified fixed
                  </button>
                  <button
                    type="button"
                    className="btn btn--dismiss-outline btn--sm"
                    aria-pressed={r.status === 'still-present'}
                    onClick={() => {
                      setRecheckStatus(take.id, f.id, 'still-present');
                      if (!r.followUpFindingId) {
                        pushToast({ tone: 'info', title: 'Added a confirmed finding to this take', message: 'It is linked to the earlier issue.' });
                      }
                    }}
                    title="Marks the issue as persisting and adds a confirmed finding on this take"
                  >
                    Still present
                  </button>
                  {r.status !== 'pending' && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRecheckStatus(take.id, f.id, 'pending')}>
                      Undo
                    </button>
                  )}
                </div>
                <label className="field field--compact">
                  <span className="visually-hidden">Re-check note</span>
                  <input
                    className="input input--compact"
                    placeholder="Re-check note (optional)"
                    value={r.note}
                    onChange={(e) => setRecheckNote(take.id, f.id, e.target.value)}
                  />
                </label>
                {r.decidedAt && <span className="muted recheck__when">Decided {formatDateTime(r.decidedAt)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AcceptanceSection({ ctx }: { ctx: ReviewContext }) {
  const { take } = ctx;
  const [open, setOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [note, setNote] = useState('');
  const noteId = useId();
  // Reads the open project; recomputed on every render as the take changes.
  const check = acceptanceCheck(take.id);

  return (
    <section className="take-section" aria-labelledby="accept-heading">
      <h3 id="accept-heading" className="panel-title">
        Final acceptance
      </h3>
      {take.acceptance ? (
        <>
          <p className="notice notice--ok notice--inline" data-testid="accepted-note">
            <strong>Accepted</strong> {formatDateTime(take.acceptance.acceptedAt)}
            {take.acceptance.note && <> · “{take.acceptance.note}”</>}
          </p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setReopenOpen(true)}>
            Reopen take
          </button>
        </>
      ) : (
        <>
          <p className="muted">A reviewer accepts a take when it is ready to use. Findings, decisions, and prompt versions are kept.</p>
          <button type="button" className="btn btn--secondary" onClick={() => setOpen(true)} data-testid="accept-take">
            <Icon name="check" /> Accept take…
          </button>
        </>
      )}

      <Dialog
        open={open}
        title={`Accept Take ${take.number}?`}
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={check.blockers.length > 0}
              onClick={() => {
                if (acceptTake(take.id, note.trim())) {
                  setOpen(false);
                  setNote('');
                  pushToast({ tone: 'success', title: `Take ${take.number} accepted` });
                }
              }}
              data-testid="confirm-accept"
            >
              Accept take
            </button>
          </>
        }
      >
        {check.blockers.length > 0 && (
          <div className="notice notice--error">
            <strong>Resolve these first:</strong>
            <ul>
              {check.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        {check.warnings.length > 0 && (
          <div className="notice notice--warning">
            <strong>Before you accept:</strong>
            <ul>
              {check.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="field">
          <label htmlFor={noteId}>Acceptance note (optional)</label>
          <textarea id={noteId} className="input textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Dialog>

      <Dialog
        open={reopenOpen}
        title={`Reopen Take ${take.number}?`}
        onClose={() => setReopenOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setReopenOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                reopenTake(take.id, note.trim());
                setReopenOpen(false);
                setNote('');
              }}
            >
              Reopen
            </button>
          </>
        }
      >
        <p>The acceptance is withdrawn and recorded in the take’s history.</p>
        <div className="field">
          <label htmlFor={`${noteId}-reopen`}>Reason (optional)</label>
          <textarea id={`${noteId}-reopen`} className="input textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Dialog>
    </section>
  );
}

function RetakeSection({ project, ctx }: { project: Project; ctx: ReviewContext }) {
  const { take } = ctx;
  const correction = project.corrections.find((c) => c.takeId === take.id);
  const findings = findingsForTake(project, take.id);
  const approval = correction ? getApprovalState(correction, findings) : { kind: 'none' as const };
  const [open, setOpen] = useState(false);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();
  const defaults = defaultRetakeLink(take.id);
  const chosenVersion = versionId ?? defaults.versionId ?? '';

  return (
    <section className="take-section" aria-labelledby="retake-heading">
      <h3 id="retake-heading" className="panel-title">
        Retake
      </h3>
      <p className="muted">
        {approval.kind === 'current'
          ? `Prompt v${approval.version.number} is approved. When the regenerated video is ready, import it here as a retake of Take ${take.number}.`
          : correction
            ? 'Import a regenerated video as a retake of this take. Approve the correction first to link the retake to an approved prompt.'
            : 'Import a regenerated video as a retake of this take.'}
      </p>
      <button type="button" className="btn btn--secondary" onClick={() => setOpen(true)} data-testid="import-retake">
        <Icon name="upload" /> Import retake…
      </button>
      <Dialog
        open={open}
        title={`Import a retake of Take ${take.number}`}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
      >
        <div className="stack">
          <div className="field">
            <label htmlFor={selectId}>Generated from</label>
            <select id={selectId} className="input" value={chosenVersion} onChange={(e) => setVersionId(e.target.value)} data-testid="retake-version">
              {correction?.versions
                .slice()
                .reverse()
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    Approved prompt v{v.number} ({formatDateTime(v.approvedAt)})
                  </option>
                ))}
              <option value="">No approved prompt version</option>
            </select>
            {approval.kind === 'stale' && (
              <span className="field__hint">The current draft differs from the latest approved version. The retake will link to the version you choose.</span>
            )}
          </div>
          <p className="muted">
            The new take will be Take {project.takes.filter((t) => t.shotId === take.shotId).reduce((m, t) => Math.max(m, t.number), 0) + 1} with
            parent Take {take.number}. Its confirmed findings will be listed for re-check, not marked fixed.
          </p>
          <DropZone
            label="Drop the retake video here"
            accept={VIDEO_ACCEPT}
            busy={busy}
            buttonLabel="Choose video"
            testId="retake-drop"
            onFiles={async ([file]) => {
              setBusy(true);
              try {
                const r = await importRetake(take.id, file, {
                  correctionId: chosenVersion ? (correction?.id ?? null) : null,
                  versionId: chosenVersion || null,
                });
                if (!r.ok) setError(r.message);
                else {
                  setOpen(false);
                  setError(null);
                  useUi.setState({ inspectorTab: 'take' });
                  pushToast({
                    tone: r.message ? 'warning' : 'success',
                    title: 'Retake imported',
                    message: r.message ?? 'Review it, then re-check the earlier findings.',
                  });
                }
              } finally {
                setBusy(false);
              }
            }}
          />
          {error && (
            <p className="notice notice--error notice--inline" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </section>
  );
}

interface HistoryItem {
  at: string;
  text: string;
  detail?: string;
}

function HistorySection({ project, ctx }: { project: Project; ctx: ReviewContext }) {
  const { take } = ctx;
  const items: HistoryItem[] = [];
  items.push({
    at: take.createdAt,
    text: ctx.parentTake ? `Imported as a retake of Take ${ctx.parentTake.number}` : `Imported as Take ${take.number}`,
  });
  for (const r of runsForTake(project, take.id)) {
    items.push({ at: r.startedAt, text: `Review started · ${r.adapterLabel}${r.simulated ? ' (simulated)' : ''}` });
    if (r.finishedAt) {
      const outcome =
        r.status === 'completed'
          ? `completed with ${r.findingCount ?? 0} finding${r.findingCount === 1 ? '' : 's'}`
          : r.status === 'failed'
            ? `failed: ${r.error?.message ?? 'unknown error'}`
            : r.status;
      items.push({ at: r.finishedAt, text: `Review ${outcome}` });
    }
  }
  for (const f of findingsForTake(project, take.id)) {
    for (const e of f.history) {
      if (e.action === 'created' || e.action === 'confirmed' || e.action === 'dismissed' || e.action === 'reopened') {
        const verb = e.action === 'created' ? 'Finding added' : e.action === 'reopened' ? 'Finding returned to candidate' : `Finding ${e.action}`;
        items.push({ at: e.at, text: `${verb}: ${categoryLabel(f.category)} ${formatTime(f.startSec)}`, detail: e.detail ?? undefined });
      }
    }
  }
  const correction = project.corrections.find((c) => c.takeId === take.id);
  for (const v of correction?.versions ?? []) items.push({ at: v.approvedAt, text: `Prompt v${v.number} approved` });
  for (const e of correction?.exports ?? []) items.push({ at: e.at, text: 'Regeneration request exported', detail: e.fileName });
  for (const c of project.takes.filter((t) => t.parentTakeId === take.id)) items.push({ at: c.createdAt, text: `Retake imported as Take ${c.number}` });
  for (const r of take.recheck) {
    if (r.decidedAt) {
      const f = project.findings.find((x) => x.id === r.parentFindingId);
      items.push({ at: r.decidedAt, text: `Re-check: ${f ? categoryLabel(f.category) : 'finding'} ${RECHECK_LABEL[r.status].toLowerCase()}` });
    }
  }
  for (const a of take.acceptanceHistory) items.push({ at: a.at, text: a.action === 'accepted' ? 'Take accepted' : 'Take reopened', detail: a.note || undefined });
  items.sort((a, b) => b.at.localeCompare(a.at));

  return (
    <details className="take-section">
      <summary>
        <h3 className="panel-title">History ({items.length})</h3>
      </summary>
      <ol className="history-list">
        {items.map((i, idx) => (
          <li key={`${i.at}-${idx}`}>
            <span className="history-list__what">{i.text}</span>
            {i.detail && <span className="history-list__detail">{i.detail}</span>}
            <time className="muted" dateTime={i.at}>
              {formatDateTime(i.at)}
            </time>
          </li>
        ))}
      </ol>
    </details>
  );
}
