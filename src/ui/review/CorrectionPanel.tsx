import { useId, useState } from 'react';
import { canApprove, getApprovalState } from '../../domain/approval';
import { categoryLabel } from '../../domain/categories';
import type { Correction, DraftSource, Project } from '../../domain/schemas';
import { findingsForTake } from '../../domain/status';
import { diffStats, diffWords } from '../../domain/textDiff';
import { formatDateTime, formatTime } from '../../domain/time';
import {
  approveCurrentDraft,
  exportRegenerationRequest,
  previewRegenerationRequest,
  redraftFromTemplates,
  setAddressedFindings,
  setDraftText,
  setOriginalPrompt,
  startCorrection,
} from '../../state/correctionActions';
import { setTakePrompt } from '../../state/mediaActions';
import { pushToast } from '../../state/toastStore';
import { setInspectorTab } from '../../state/uiStore';
import { OriginBadge } from '../components/Badges';
import { Dialog } from '../components/Dialog';
import { AutoTextarea } from '../components/Fields';
import { Icon } from '../components/Icon';
import type { ReviewContext } from './context';

const SOURCE_LABEL: Record<DraftSource, string> = {
  template: 'Template draft',
  'template-edited': 'Template draft, edited',
  manual: 'Written by reviewer',
};

export function DiffView({ before, after }: { before: string; after: string }) {
  const ops = diffWords(before, after);
  const stats = diffStats(ops);
  return (
    <div className="diff-wrap">
      <p className="diff__stats">
        <span className="diff__stat diff__stat--add">+{stats.inserted} words</span>
        <span className="diff__stat diff__stat--del">−{stats.deleted} words</span>
      </p>
      <div className="diff" aria-label="Changes from the original prompt" data-testid="prompt-diff">
        {ops.length === 0 && <span className="muted">No text.</span>}
        {ops.map((op, i) =>
          op.type === 'equal' ? (
            <span key={i}>{op.text}</span>
          ) : op.type === 'insert' ? (
            <ins key={i}>
              <span className="visually-hidden">[added] </span>
              {op.text}
            </ins>
          ) : (
            <del key={i}>
              <span className="visually-hidden">[removed] </span>
              {op.text}
            </del>
          ),
        )}
      </div>
    </div>
  );
}

export function CorrectionPanel({ project, ctx }: { project: Project; ctx: ReviewContext }) {
  const correction = project.corrections.find((c) => c.takeId === ctx.take.id);
  const findings = findingsForTake(project, ctx.take.id);
  const confirmed = findings.filter((f) => f.reviewState === 'confirmed');

  if (!correction) {
    return (
      <div className="correction-panel">
        <h3 className="panel-title">Prompt correction</h3>
        {confirmed.length === 0 ? (
          <p className="empty-note">
            Corrections are built from confirmed findings. Confirm at least one finding on this take to draft a corrected
            prompt.
          </p>
        ) : (
          <>
            <p>
              {confirmed.length} confirmed finding{confirmed.length === 1 ? '' : 's'} on Take {ctx.take.number}. ClearFrame can
              draft a corrected prompt from simple templates, one instruction per issue category. You edit and approve it.
            </p>
            {!ctx.take.generationPrompt.trim() && (
              <p className="notice notice--warning notice--inline">
                This take has no generation prompt recorded. You can add it on the next screen.
              </p>
            )}
            <button type="button" className="btn btn--primary" onClick={() => startCorrection(ctx.take.id)} data-testid="start-correction">
              Draft correction from templates
            </button>
          </>
        )}
      </div>
    );
  }
  return <CorrectionEditor project={project} ctx={ctx} correction={correction} />;
}

function CorrectionEditor({ project, ctx, correction }: { project: Project; ctx: ReviewContext; correction: Correction }) {
  const findings = findingsForTake(project, ctx.take.id);
  const approval = getApprovalState(correction, findings);
  const approvable = canApprove(correction, findings);
  const [confirmRedraft, setConfirmRedraft] = useState(false);
  const [approving, setApproving] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const draftId = useId();
  const addressable = findings.filter((f) => f.reviewState === 'confirmed' || correction.addressedFindingIds.includes(f.id));
  const nextVersion = correction.versions.length + 1;
  const promptDrift = ctx.take.generationPrompt !== correction.originalPrompt;
  const [preview, setPreview] = useState<{ versionId: string; json: string } | null>(null);
  const addressesSimulated =
    approval.kind === 'current' &&
    approval.version.addressedFindingIds.some((id) => findings.find((f) => f.id === id)?.origin === 'simulation');
  const shownPreview = approval.kind === 'current' && preview?.versionId === approval.version.id ? preview.json : null;

  const toggleFinding = (id: string, on: boolean) => {
    const set = new Set(correction.addressedFindingIds);
    if (on) set.add(id);
    else set.delete(id);
    setAddressedFindings(correction.id, [...set]);
  };

  return (
    <div className="correction-panel" data-testid="correction-panel">
      <div className="section-header">
        <h3 className="panel-title">Prompt correction</h3>
        {approval.kind === 'current' ? (
          <span className="badge badge--tone-ok" data-testid="approval-state">
            Approved v{approval.version.number}
          </span>
        ) : approval.kind === 'stale' ? (
          <span className="badge badge--tone-candidate" data-testid="approval-state">
            Changed since v{approval.version.number} approval
          </span>
        ) : (
          <span className="badge badge--tone-neutral" data-testid="approval-state">
            Draft · not approved
          </span>
        )}
      </div>

      {approval.kind === 'stale' && (
        <div className="notice notice--warning" role="status">
          <strong>Needs fresh approval.</strong>
          <ul>
            {approval.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          Approve the current version before exporting. v{approval.version.number} stays in the history unchanged.
        </div>
      )}

      <section className="correction-section" aria-labelledby={`${draftId}-orig`}>
        <h4 id={`${draftId}-orig`}>Original generation prompt</h4>
        {correction.originalPrompt.trim() ? (
          <blockquote className="prompt-block" data-testid="original-prompt">
            {correction.originalPrompt}
          </blockquote>
        ) : (
          <AutoTextarea
            label="No original prompt recorded. Paste the prompt used to generate this take."
            value={correction.originalPrompt}
            rows={3}
            onChange={(v) => {
              setOriginalPrompt(correction.id, v);
              setTakePrompt(ctx.take.id, v);
            }}
          />
        )}
        {promptDrift && correction.originalPrompt.trim() && (
          <p className="notice notice--warning notice--inline">
            The take’s generation prompt was edited after this correction started.{' '}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOriginalPrompt(correction.id, ctx.take.generationPrompt)}>
              Use the take’s current prompt
            </button>
          </p>
        )}
      </section>

      <section className="correction-section" aria-labelledby={`${draftId}-addr`}>
        <h4 id={`${draftId}-addr`}>Findings addressed</h4>
        {addressable.length === 0 ? (
          <p className="muted">No confirmed findings on this take.</p>
        ) : (
          <ul className="addressed-list">
            {addressable.map((f) => {
              const checked = correction.addressedFindingIds.includes(f.id);
              const stale = f.reviewState !== 'confirmed';
              return (
                <li key={f.id}>
                  <label className={`check-item${stale ? ' check-item--stale' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={(e) => toggleFinding(f.id, e.target.checked)} disabled={stale && !checked} />
                    <span className="check-item__text">
                      <span className="check-item__label">
                        {categoryLabel(f.category)} · {formatTime(f.startSec)}–{formatTime(f.endSec)} <OriginBadge origin={f.origin} />
                      </span>
                      {stale && <span className="field__error">No longer confirmed ({f.reviewState}). Remove it from this correction.</span>}
                      {f.description && <span className="check-item__desc">{f.description}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="correction-section">
        <div className="section-header">
          <h4>
            <label htmlFor={draftId}>Proposed prompt</label>
          </h4>
          <span className={`badge ${correction.draftSource === 'manual' ? 'badge--tone-neutral' : 'badge--template'}`} data-testid="draft-source">
            {SOURCE_LABEL[correction.draftSource]}
          </span>
        </div>
        {correction.draftSource !== 'manual' && (
          <p className="field__hint">
            Drafted by simple text templates (one fixed instruction per issue category), not by a language model. Read and edit
            it before approving.
          </p>
        )}
        <textarea
          id={draftId}
          className="input textarea textarea--prompt"
          rows={8}
          value={correction.draftText}
          onChange={(e) => setDraftText(correction.id, e.target.value)}
          data-testid="proposed-prompt"
        />
        <div className="row">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => (correction.draftSource === 'template' ? redraftFromTemplates(correction.id) : setConfirmRedraft(true))}
          >
            <Icon name="refresh" /> Redraft from templates
          </button>
        </div>
      </section>

      <section className="correction-section">
        <h4>Changes from the original</h4>
        <DiffView before={correction.originalPrompt} after={correction.draftText} />
      </section>

      <section className="correction-section correction-section--actions">
        <h4>Approval and export</h4>
        {approval.kind !== 'current' && (
          <>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!approvable.ok || approving}
              onClick={async () => {
                setApproving(true);
                try {
                  const r = await approveCurrentDraft(correction.id);
                  if (!r.ok) setLastError(r.reasons.join(' '));
                  else {
                    setLastError(null);
                    pushToast({ tone: 'success', title: `Approved prompt v${nextVersion}` });
                  }
                } finally {
                  setApproving(false);
                }
              }}
              data-testid="approve-prompt"
            >
              <Icon name="check" /> Approve this version (v{nextVersion})
            </button>
            {!approvable.ok && (
              <ul className="reason-list">
                {approvable.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {approval.kind === 'current' && (
          <p className="muted">
            v{approval.version.number} approved {formatDateTime(approval.version.approvedAt)}
            {approval.version.sha256 && (
              <>
                {' '}
                · SHA-256 <span className="mono">{approval.version.sha256.slice(0, 12)}…</span>
              </>
            )}
            . Editing the prompt or the addressed findings will require approving again.
          </p>
        )}
        <div className="row row--wrap">
          <button
            type="button"
            className="btn btn--primary"
            disabled={approval.kind !== 'current'}
            onClick={() => {
              const r = exportRegenerationRequest(correction.id);
              if (!r.ok) setLastError(r.error);
              else {
                setLastError(null);
                pushToast({ tone: 'success', title: 'Regeneration request exported', message: r.fileName });
              }
            }}
            data-testid="export-request"
          >
            <Icon name="download" /> Export regeneration request
          </button>
          {approval.kind === 'current' && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setInspectorTab('take')}>
              Next: import the retake
            </button>
          )}
        </div>
        {approval.kind !== 'current' && (
          <p className="field__hint">Export is available once the current prompt version is approved.</p>
        )}
        <p className="field__hint">
          Exports a JSON file. ClearFrame does not call a video generator; submit the request to your generation tool yourself.
        </p>
        {addressesSimulated && (
          <p className="notice notice--sim notice--inline">
            This request addresses simulated findings. The JSON marks them with origin “simulation”.
          </p>
        )}
        {lastError && (
          <p className="notice notice--error notice--inline" role="alert">
            {lastError}
          </p>
        )}
        {approval.kind === 'current' && (
          <div className="json-preview">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-expanded={Boolean(shownPreview)}
              onClick={() => {
                if (shownPreview) {
                  setPreview(null);
                  return;
                }
                const r = previewRegenerationRequest(correction.id);
                if (r.request) setPreview({ versionId: approval.version.id, json: JSON.stringify(r.request, null, 2) });
                else setLastError(r.error);
              }}
            >
              {shownPreview ? 'Hide JSON preview' : 'Preview JSON'}
            </button>
            {shownPreview && (
              <>
                <p className="field__hint">The request ID and export time are assigned again when you export.</p>
                <pre data-testid="request-preview">{shownPreview}</pre>
              </>
            )}
          </div>
        )}
      </section>

      {(correction.versions.length > 0 || correction.exports.length > 0) && (
        <section className="correction-section">
          <h4>Version history</h4>
          <ol className="history-list">
            {[...correction.versions].reverse().map((v) => (
              <li key={v.id}>
                <span className="history-list__what">
                  v{v.number} approved · {SOURCE_LABEL[v.draftSource]}
                </span>
                <span className="history-list__detail">
                  Addresses {v.addressedFindingIds.length} finding{v.addressedFindingIds.length === 1 ? '' : 's'}
                  {v.sha256 && <span className="mono"> · {v.sha256.slice(0, 12)}</span>}
                </span>
                <time className="muted" dateTime={v.approvedAt}>
                  {formatDateTime(v.approvedAt)}
                </time>
                <details>
                  <summary>Show v{v.number} text</summary>
                  <blockquote className="prompt-block">{v.text}</blockquote>
                </details>
              </li>
            ))}
            {[...correction.exports].reverse().map((e) => (
              <li key={e.requestId}>
                <span className="history-list__what">
                  Exported v{correction.versions.find((v) => v.id === e.versionId)?.number ?? '?'}
                </span>
                <span className="history-list__detail mono">{e.fileName}</span>
                <time className="muted" dateTime={e.at}>
                  {formatDateTime(e.at)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Dialog
        open={confirmRedraft}
        title="Replace your edits?"
        onClose={() => setConfirmRedraft(false)}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setConfirmRedraft(false)}>
              Keep my edits
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setConfirmRedraft(false);
                redraftFromTemplates(correction.id);
              }}
            >
              Replace with template draft
            </button>
          </>
        }
      >
        <p>The proposed prompt has been edited. Redrafting replaces it with a fresh template draft from the selected findings.</p>
      </Dialog>
    </div>
  );
}
