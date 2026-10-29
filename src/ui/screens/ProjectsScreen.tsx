import { useEffect, useId, useState } from 'react';
import { formatDateTime } from '../../domain/time';
import { createProject, deleteProjectById, openSampleProject } from '../../state/projectActions';
import { refreshProjectIndex, useProjectIndex, useStorageHealth } from '../../state/projectStore';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { navigate, routeHref } from '../router';

export function ProjectsScreen() {
  const { projects, unreadable, loading, error } = useProjectIndex();
  const storage = useStorageHealth();
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (storage.checked) void refreshProjectIndex();
  }, [storage.checked]);

  const openSample = async (reset: boolean) => {
    setBusy(true);
    try {
      const id = await openSampleProject({ reset });
      navigate({ name: 'review', projectId: id });
    } finally {
      setBusy(false);
    }
  };

  const hasSample = projects.some((p) => p.isSample);

  return (
    <div className="projects">
      <div className="projects__header">
        <div>
          <h1>Projects</h1>
          <p className="muted">Review AI-generated video shot by shot: find flaws, decide on them, and approve prompt corrections.</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={() => void openSample(false)} disabled={busy}>
            <Icon name="film" />
            {hasSample ? 'Open sample project' : 'Try the sample project'}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            New project
          </button>
        </div>
      </div>

      {error && (
        <div className="notice notice--error" role="alert">
          <strong>Could not list projects.</strong> {error}{' '}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void refreshProjectIndex()}>
            Retry
          </button>
        </div>
      )}

      {loading && projects.length === 0 ? (
        <p className="muted" role="status">
          Loading projects…
        </p>
      ) : projects.length === 0 && unreadable.length === 0 ? (
        <div className="empty-state">
          <Icon name="film" size={32} />
          <h2>No projects yet</h2>
          <p>
            Create a project to import generated videos, an optional reference clip, and your script. Or open the sample
            project, which has synthetic footage and illustrative findings.
          </p>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
              New project
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => void openSample(false)} disabled={busy}>
              Open sample project
            </button>
          </div>
        </div>
      ) : (
        <ul className="project-list" aria-label="Saved projects">
          {projects.map((p) => (
            <li key={p.id} className="project-card">
              <a className="project-card__main" href={routeHref({ name: 'review', projectId: p.id })}>
                <span className="project-card__name">
                  {p.name}
                  {p.isSample && <span className="badge badge--sim">Sample · simulated findings</span>}
                </span>
                {p.description && <span className="project-card__desc">{p.description}</span>}
                <span className="project-card__meta">
                  {p.shotCount} shot{p.shotCount === 1 ? '' : 's'} · {p.takeCount} take{p.takeCount === 1 ? '' : 's'} ·{' '}
                  {p.findingCount} finding{p.findingCount === 1 ? '' : 's'} · Updated {formatDateTime(p.updatedAt)}
                </span>
              </a>
              <div className="project-card__actions">
                <a className="btn btn--ghost btn--sm" href={routeHref({ name: 'media', projectId: p.id })}>
                  Media
                </a>
                {p.isSample && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openSample(true)} disabled={busy}>
                    Reset sample
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--danger"
                  onClick={() => setToDelete({ id: p.id, name: p.name })}
                  aria-label={`Delete ${p.name}`}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </li>
          ))}
          {unreadable.map((p) => (
            <li key={p.id} className="project-card project-card--broken">
              <div className="project-card__main">
                <span className="project-card__name">{p.name}</span>
                <span className="project-card__desc">This project's saved data can't be read: {p.error}</span>
              </div>
              <div className="project-card__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--danger"
                  onClick={() => setToDelete({ id: p.id, name: p.name })}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />

      <Dialog
        open={toDelete !== null}
        title="Delete project?"
        onClose={() => setToDelete(null)}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setToDelete(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger-solid"
              onClick={async () => {
                const target = toDelete;
                setToDelete(null);
                if (target) await deleteProjectById(target.id);
              }}
            >
              Delete project
            </button>
          </>
        }
      >
        <p>
          “{toDelete?.name}” and every video, finding, decision, and prompt version stored with it will be removed from this
          browser. This can't be undone.
        </p>
      </Dialog>
    </div>
  );
}

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const descId = useId();
  const formId = useId();

  const close = () => {
    setName('');
    setDescription('');
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title="New project"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={busy}>
            Create project
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) {
            setError('Give the project a name.');
            return;
          }
          setBusy(true);
          try {
            const id = await createProject(name, description);
            close();
            navigate({ name: 'media', projectId: id });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            className={`input${error ? ' input--invalid' : ''}`}
            value={name}
            autoFocus
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${nameId}-err` : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          {error && (
            <span id={`${nameId}-err`} className="field__error" role="alert">
              {error}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor={descId}>
            Description <span className="muted">(optional)</span>
          </label>
          <textarea id={descId} className="input textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </form>
    </Dialog>
  );
}
