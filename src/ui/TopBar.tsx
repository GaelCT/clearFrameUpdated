import { getAnalysisService } from '../analysis/registry';
import { formatDateTime } from '../domain/time';
import { retrySave, useProjectStore } from '../state/projectStore';
import { useSettings } from '../state/settingsStore';
import { useUi } from '../state/uiStore';
import { Icon } from './components/Icon';
import { routeHref, type Route } from './router';

function SaveIndicator() {
  const { saveState, saveError, lastSavedAt } = useProjectStore();
  let text: string;
  let tone: string;
  switch (saveState) {
    case 'pending':
    case 'saving':
      text = 'Saving…';
      tone = 'progress';
      break;
    case 'error':
      text = 'Save failed';
      tone = 'error';
      break;
    case 'unavailable':
      text = 'Not saved: browser storage unavailable';
      tone = 'error';
      break;
    default:
      text = 'Saved locally';
      tone = 'ok';
  }
  return (
    <span className={`save-indicator save-indicator--${tone}`} role="status" aria-live="polite" data-testid="save-state" data-state={saveState}>
      <span className="save-indicator__dot" aria-hidden="true" />
      <span title={saveError ?? (lastSavedAt ? `Last saved ${formatDateTime(lastSavedAt)}` : undefined)}>{text}</span>
      {saveState === 'error' && (
        <button type="button" className="btn btn--ghost btn--xs" onClick={retrySave} title={saveError ?? undefined}>
          Retry
        </button>
      )}
    </span>
  );
}

function AnalysisModeBadge() {
  useSettings((s) => s.adapterId);
  const info = getAnalysisService().info;
  if (!info.simulated) return <span className="badge badge--tone-ok">{info.label}</span>;
  return (
    <span className="mode-badge" title={info.description} data-testid="demo-mode-badge">
      Demo analysis · results are simulated
    </span>
  );
}

export function TopBar({ route }: { route: Route }) {
  const project = useProjectStore((s) => s.project);
  const inProject = route.name !== 'projects' && project;
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <a className="topbar__brand" href={routeHref({ name: 'projects' })} aria-label="ClearFrame, all projects">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 9h18M8 5v4M16 5v4" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        ClearFrame
      </a>
      {inProject && (
        <>
          <span className="topbar__sep" aria-hidden="true">
            /
          </span>
          <span className="topbar__project" title={project.name}>
            {project.name}
          </span>
          {project.isSample && <span className="badge badge--sim">Sample</span>}
          <nav className="topbar__nav" aria-label="Project">
            <a href={routeHref({ name: 'media', projectId: project.id })} aria-current={route.name === 'media' ? 'page' : undefined}>
              Media
            </a>
            <a href={routeHref({ name: 'review', projectId: project.id })} aria-current={route.name === 'review' ? 'page' : undefined}>
              Review
            </a>
          </nav>
        </>
      )}
      <span className="topbar__spacer" />
      {inProject && <SaveIndicator />}
      <AnalysisModeBadge />
      <button type="button" className="icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => useUi.setState({ shortcutsOpen: true })}>
        <Icon name="keyboard" />
      </button>
      <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={() => useUi.setState({ settingsOpen: true })}>
        <Icon name="settings" />
      </button>
    </header>
  );
}
