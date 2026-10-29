import { useId, useState } from 'react';
import type { Project, Shot, Take } from '../../domain/schemas';
import { formatDateTime } from '../../domain/time';
import { readScriptFile, SCRIPT_ACCEPT, VIDEO_ACCEPT } from '../../media/probe';
import {
  addShot,
  importGeneratedVideos,
  importReferenceVideo,
  moveTakeToShot,
  removeReference,
  removeShot,
  removeTake,
  setTakePrompt,
  updateShot,
  useImportProgress,
  type ImportReport,
} from '../../state/mediaActions';
import { setScript, updateProjectDetails } from '../../state/projectActions';
import { useProjectStore } from '../../state/projectStore';
import { pushToast } from '../../state/toastStore';
import { AssetCard } from '../media/AssetCard';
import { Dialog } from '../components/Dialog';
import { DropZone } from '../components/DropZone';
import { AutoTextarea, InlineText } from '../components/Fields';
import { Icon } from '../components/Icon';
import { routeHref } from '../router';

export function MediaScreen() {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  return (
    <div className="media-screen">
      <div className="media-screen__header">
        <div className="stack stack--tight">
          <InlineText label="Project name" value={project.name} onCommit={(v) => updateProjectDetails({ name: v })} className="input input--h1" testId="project-name" />
          <AutoTextarea
            label={<span className="visually-hidden">Project description</span>}
            value={project.description}
            rows={2}
            placeholder="Description (optional)"
            onChange={(v) => updateProjectDetails({ description: v })}
          />
        </div>
        <a className="btn btn--primary" href={routeHref({ name: 'review', projectId: project.id })}>
          Open review workspace
          <Icon name="chevronRight" />
        </a>
      </div>

      <div className="media-screen__imports">
        <GeneratedImport project={project} />
        <ScriptEditor project={project} />
      </div>

      <section aria-labelledby="shots-heading" className="media-section">
        <div className="section-header">
          <h2 id="shots-heading">Shots and takes</h2>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => addShot()}>
            <Icon name="plus" /> Add empty shot
          </button>
        </div>
        {project.shots.length === 0 ? (
          <div className="empty-state empty-state--inline">
            <p>No shots yet. Import generated videos above; each file becomes a take in a new shot unless you choose an existing shot.</p>
          </div>
        ) : (
          project.shots.map((shot) => <ShotSection key={shot.id} project={project} shot={shot} />)
        )}
      </section>
    </div>
  );
}

function ImportReportView({ report, onDismiss }: { report: ImportReport | null; onDismiss: () => void }) {
  if (!report || (report.imported.length === 0 && report.rejected.length === 0)) return null;
  return (
    <div className="import-report" role="status" aria-live="polite">
      {report.imported.length > 0 && (
        <p>
          Imported {report.imported.length} file{report.imported.length === 1 ? '' : 's'}:{' '}
          {report.imported.map((i) => i.fileName).join(', ')}.
        </p>
      )}
      {report.imported
        .filter((i) => !i.playable)
        .map((i) => (
          <p key={i.assetId} className="notice notice--warning notice--inline">
            <strong>{i.fileName}</strong> was imported but can't be played in this browser. {i.message}
          </p>
        ))}
      {report.rejected.map((r) => (
        <p key={r.fileName} className="notice notice--error notice--inline">
          <strong>{r.fileName}</strong> was not imported. {r.reason}
        </p>
      ))}
      <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function GeneratedImport({ project }: { project: Project }) {
  const [target, setTarget] = useState<string>('new-shots');
  const [report, setReport] = useState<ImportReport | null>(null);
  const active = useImportProgress((s) => s.active);
  const selectId = useId();
  const validTarget = target === 'new-shots' || project.shots.some((s) => s.id === target) ? target : 'new-shots';

  return (
    <section className="media-section" aria-labelledby="gen-heading">
      <h2 id="gen-heading">Generated videos</h2>
      <div className="field field--inline">
        <label htmlFor={selectId}>Add files as</label>
        <select id={selectId} className="input" value={validTarget} onChange={(e) => setTarget(e.target.value)}>
          <option value="new-shots">A new shot for each file</option>
          {project.shots.map((s) => (
            <option key={s.id} value={s.id}>
              New takes in {s.name}
            </option>
          ))}
        </select>
      </div>
      <DropZone
        label="Drop generated videos here"
        hint="MP4 (H.264), WebM (VP8/VP9/AV1), or other formats this browser can play. Several files at once is fine."
        accept={VIDEO_ACCEPT}
        multiple
        busy={active.length > 0}
        testId="generated-drop"
        onFiles={async (files) => {
          const r = await importGeneratedVideos(files, validTarget === 'new-shots' ? { mode: 'new-shots' } : { mode: 'shot', shotId: validTarget });
          setReport(r);
        }}
      />
      {active.length > 0 && (
        <p className="muted" role="status">
          Reading {active.join(', ')}…
        </p>
      )}
      <ImportReportView report={report} onDismiss={() => setReport(null)} />
    </section>
  );
}

function ScriptEditor({ project }: { project: Project }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="media-section" aria-labelledby="script-heading">
      <h2 id="script-heading">Script, brief, or prompt</h2>
      <AutoTextarea
        label={
          <>
            Script text{' '}
            {project.script.sourceFileName && <span className="muted">(from {project.script.sourceFileName})</span>}
          </>
        }
        value={project.script.text}
        rows={8}
        placeholder="Paste the creative script, brief, or generation prompt for this project."
        hint={
          project.script.updatedAt
            ? `Saved with the project. Last edited ${formatDateTime(project.script.updatedAt)}. Per-take generation prompts are kept separately below.`
            : 'Saved with the project. Per-take generation prompts are kept separately below.'
        }
        testId="script-text"
        onChange={(v) => setScript(v)}
      />
      <DropZone
        compact
        label="Or load a .txt or .md file"
        accept={SCRIPT_ACCEPT}
        buttonLabel="Choose file"
        testId="script-drop"
        onFiles={async ([file]) => {
          try {
            const text = await readScriptFile(file);
            if (project.script.text.trim() && project.script.text !== text) {
              pushToast({ tone: 'info', title: 'Script replaced', message: `Loaded ${file.name}. The previous text was replaced.` });
            }
            setScript(text, file.name);
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
      {error && (
        <p className="notice notice--error notice--inline" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ShotSection({ project, shot }: { project: Project; shot: Shot }) {
  const takes = project.takes.filter((t) => t.shotId === shot.id).sort((a, b) => a.number - b.number);
  const reference = shot.referenceAssetId ? project.assets.find((a) => a.id === shot.referenceAssetId) : undefined;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [refReport, setRefReport] = useState<ImportReport | null>(null);

  return (
    <section className="shot-section" aria-label={shot.name}>
      <header className="shot-section__header">
        <InlineText label="Shot name" value={shot.name} onCommit={(v) => updateShot(shot.id, { name: v })} className="input input--title" />
        <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setConfirmRemove(true)}>
          <Icon name="trash" /> Remove shot
        </button>
      </header>
      <AutoTextarea
        label="Shot notes"
        value={shot.description}
        rows={1}
        placeholder="Optional notes about this shot"
        onChange={(v) => updateShot(shot.id, { description: v })}
      />

      <div className="shot-section__grid">
        <div className="stack">
          <h3>Takes</h3>
          {takes.length === 0 && <p className="muted">No takes yet. Import generated videos into this shot above.</p>}
          {takes.map((take) => (
            <TakeAsset key={take.id} project={project} take={take} />
          ))}
        </div>
        <div className="stack">
          <h3>
            Reference footage <span className="muted">(optional)</span>
          </h3>
          {reference ? (
            <AssetCard
              asset={reference}
              title={<span className="badge badge--tone-neutral">Reference</span>}
              actions={
                <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => void removeReference(shot.id)}>
                  <Icon name="trash" /> Remove
                </button>
              }
            />
          ) : (
            <>
              <DropZone
                compact
                label="Attach original or reference footage"
                hint="Used for side-by-side comparison. Review works without it."
                accept={VIDEO_ACCEPT}
                buttonLabel="Choose file"
                testId={`reference-drop-${shot.id}`}
                onFiles={async ([file]) => setRefReport(await importReferenceVideo(file, shot.id))}
              />
              <ImportReportView report={refReport} onDismiss={() => setRefReport(null)} />
            </>
          )}
        </div>
      </div>

      <Dialog
        open={confirmRemove}
        title={`Remove ${shot.name}?`}
        onClose={() => setConfirmRemove(false)}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setConfirmRemove(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger-solid"
              onClick={() => {
                setConfirmRemove(false);
                void removeShot(shot.id);
              }}
            >
              Remove shot
            </button>
          </>
        }
      >
        <p>
          This removes {takes.length} take{takes.length === 1 ? '' : 's'}
          {reference ? ' and the reference footage' : ''}, with their findings, decisions, and prompt corrections.
        </p>
      </Dialog>
    </section>
  );
}

function TakeAsset({ project, take }: { project: Project; take: Take }) {
  const asset = take.assetId ? project.assets.find((a) => a.id === take.assetId) : undefined;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const shotSelectId = useId();
  const findingCount = project.findings.filter((f) => f.takeId === take.id).length;
  const childCount = project.takes.filter((t) => t.parentTakeId === take.id).length;
  const parent = take.parentTakeId ? project.takes.find((t) => t.id === take.parentTakeId) : undefined;

  if (!asset) return null;
  return (
    <>
      <AssetCard
        asset={asset}
        title={
          <span className="badge badge--tone-neutral">
            Take {take.number}
            {parent ? ` · retake of Take ${parent.number}` : ''}
          </span>
        }
        replaceWarning={
          findingCount > 0
            ? `This take has ${findingCount} finding${findingCount === 1 ? '' : 's'} made against the current file. They stay attached to the take but may no longer line up with the new file.`
            : null
        }
        extra={
          <div className="stack stack--tight">
            <div className="field field--inline">
              <label htmlFor={shotSelectId}>Shot</label>
              <select id={shotSelectId} className="input" value={take.shotId} onChange={(e) => moveTakeToShot(take.id, e.target.value)}>
                {project.shots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <AutoTextarea
              label="Generation prompt for this take"
              value={take.generationPrompt}
              rows={3}
              placeholder="The prompt used to generate this video. Used as the original prompt for corrections."
              onChange={(v) => setTakePrompt(take.id, v)}
            />
          </div>
        }
        actions={
          <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setConfirmRemove(true)}>
            <Icon name="trash" /> Remove take
          </button>
        }
      />
      <Dialog
        open={confirmRemove}
        title={`Remove Take ${take.number}?`}
        onClose={() => setConfirmRemove(false)}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setConfirmRemove(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger-solid"
              onClick={() => {
                setConfirmRemove(false);
                void removeTake(take.id);
              }}
            >
              Remove take
            </button>
          </>
        }
      >
        <p>
          The video file{findingCount ? `, ${findingCount} finding${findingCount === 1 ? '' : 's'},` : ''} and any prompt correction for
          this take will be removed.
          {childCount > 0 && ` ${childCount} retake${childCount === 1 ? '' : 's'} will lose the link to this parent.`}
        </p>
      </Dialog>
    </>
  );
}
