import { useEffect } from 'react';
import { closeProject, initApp, openProject } from './state/projectActions';
import { flushSave, hasUnsavedChanges, useProjectStore, useStorageHealth } from './state/projectStore';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { Toasts } from './ui/components/Toasts';
import { useRoute } from './ui/router';
import { MediaScreen } from './ui/screens/MediaScreen';
import { ProjectsScreen } from './ui/screens/ProjectsScreen';
import { ReviewScreen } from './ui/screens/ReviewScreen';
import { SettingsDialog } from './ui/SettingsDialog';
import { ShortcutsDialog } from './ui/ShortcutsDialog';
import { TopBar } from './ui/TopBar';

function StorageBanner() {
  const { checked, available, error } = useStorageHealth();
  if (!checked || available) return null;
  return (
    <div className="banner banner--error" role="alert">
      <strong>Browser storage is unavailable.</strong> {error} You can still review, but nothing will be saved when this tab
      closes.
    </div>
  );
}

export function App() {
  const route = useRoute();
  const storageChecked = useStorageHealth((s) => s.checked);
  const { project, openState, openError } = useProjectStore();
  const routeProjectId = route.name === 'projects' ? null : route.projectId;

  useEffect(() => {
    void initApp();
  }, []);

  useEffect(() => {
    if (!storageChecked) return;
    if (!routeProjectId) {
      void closeProject();
      return;
    }
    if (useProjectStore.getState().project?.id !== routeProjectId) void openProject(routeProjectId);
  }, [routeProjectId, storageChecked]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      void flushSave();
      if (hasUnsavedChanges()) e.preventDefault();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushSave();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  let content;
  if (route.name === 'projects') content = <ProjectsScreen />;
  else if (!storageChecked || openState === 'loading' || (openState === 'idle' && !project)) {
    content = (
      <div className="center-message" role="status">
        Opening project…
      </div>
    );
  } else if (openState === 'error') {
    content = (
      <div className="center-message">
        <div className="error-panel" role="alert">
          <h1>Couldn’t open this project</h1>
          <p>{openError}</p>
          <a className="btn btn--primary" href="#/">
            Back to projects
          </a>
        </div>
      </div>
    );
  } else if (project && project.id === route.projectId) {
    content = route.name === 'media' ? <MediaScreen /> : <ReviewScreen />;
  } else {
    content = (
      <div className="center-message" role="status">
        Opening project…
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar route={route} />
      <StorageBanner />
      <main id="main" className={`app__main app__main--${route.name}`} tabIndex={-1}>
        <ErrorBoundary>{content}</ErrorBoundary>
      </main>
      <Toasts />
      <SettingsDialog />
      <ShortcutsDialog />
    </div>
  );
}
