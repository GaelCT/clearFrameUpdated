import { newId, nowIso } from '../domain/ids';
import { PROJECT_SCHEMA_VERSION, type Project } from '../domain/schemas';
import { buildSampleProject, SAMPLE_PROJECT_ID } from '../domain/sampleProject';
import { forgetSessionBlobs, hydrateAssets, releaseAllUrls, releaseAsset } from '../media/mediaRegistry';
import { checkStorage, deleteProject, loadProject, saveProject } from '../persistence/repository';
import { cancelActiveRunsForClose } from '../analysis/reviewRunner';
import {
  flushSave,
  mutateProject,
  refreshProjectIndex,
  scheduleSave,
  useProjectStore,
  useStorageHealth,
} from './projectStore';
import { resetUi, selectTake } from './uiStore';
import { pushToast } from './toastStore';

export async function initApp(): Promise<void> {
  const result = await checkStorage();
  useStorageHealth.setState({ checked: true, available: result.ok, error: result.ok ? null : result.error });
  await refreshProjectIndex();
}

function emptyProject(name: string, description: string): Project {
  const now = nowIso();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: newId('prj'),
    name,
    description,
    isSample: false,
    createdAt: now,
    updatedAt: now,
    script: { text: '', sourceFileName: null, updatedAt: null },
    assets: [],
    shots: [],
    takes: [],
    runs: [],
    findings: [],
    corrections: [],
    reviewConfig: { checks: null },
  };
}

/** Marks runs left running by a previous session as interrupted. */
function settleInterruptedRuns(project: Project): Project {
  if (!project.runs.some((r) => r.status === 'running' || r.status === 'queued')) return project;
  return {
    ...project,
    runs: project.runs.map((r) =>
      r.status === 'running' || r.status === 'queued'
        ? {
            ...r,
            status: 'failed' as const,
            finishedAt: nowIso(),
            message: null,
            error: {
              code: 'interrupted',
              message: 'This review was interrupted because the page was closed or reloaded. Run it again.',
              retryable: true,
            },
          }
        : r,
    ),
  };
}

async function setOpenProject(project: Project): Promise<void> {
  const settled = settleInterruptedRuns(project);
  useProjectStore.setState({
    project: settled,
    openState: 'ready',
    openError: null,
    saveState: 'saved',
    saveError: null,
  });
  if (settled !== project) scheduleSave();
  resetUi();
  const firstShot = settled.shots[0];
  const firstTake = firstShot ? settled.takes.find((t) => t.shotId === firstShot.id) : undefined;
  if (firstShot) selectTake(firstShot.id, firstTake?.id ?? null);
  await hydrateAssets(settled.assets);
}

export async function createProject(name: string, description: string): Promise<string> {
  await closeProject();
  const project = emptyProject(name.trim(), description.trim());
  useProjectStore.setState({ openState: 'loading', openError: null });
  if (useStorageHealth.getState().available) {
    try {
      await saveProject(project);
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Project not saved',
        message: `${err instanceof Error ? err.message : String(err)} You can keep working; changes stay in this tab.`,
      });
    }
  }
  await setOpenProject(project);
  if (!useStorageHealth.getState().available) useProjectStore.setState({ saveState: 'unavailable' });
  void refreshProjectIndex();
  return project.id;
}

export async function openProject(id: string): Promise<void> {
  const current = useProjectStore.getState().project;
  if (current?.id === id && useProjectStore.getState().openState === 'ready') return;
  await closeProject();
  useProjectStore.setState({ openState: 'loading', openError: null });
  try {
    const project = await loadProject(id);
    await setOpenProject(project);
  } catch (err) {
    useProjectStore.setState({
      project: null,
      openState: 'error',
      openError: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function openSampleProject(options: { reset?: boolean } = {}): Promise<string> {
  const storageOk = useStorageHealth.getState().available;
  if (!options.reset && storageOk) {
    try {
      await loadProject(SAMPLE_PROJECT_ID);
      await openProject(SAMPLE_PROJECT_ID);
      return SAMPLE_PROJECT_ID;
    } catch {
      // Not created yet (or unreadable): build a fresh one below.
    }
  }
  await closeProject();
  useProjectStore.setState({ openState: 'loading', openError: null });
  const sample = await buildSampleProject(import.meta.env.BASE_URL);
  if (storageOk) {
    try {
      await saveProject(sample);
    } catch (err) {
      pushToast({ tone: 'error', title: 'Sample not saved', message: err instanceof Error ? err.message : String(err) });
    }
  }
  await setOpenProject(sample);
  void refreshProjectIndex();
  return sample.id;
}

export async function closeProject(): Promise<void> {
  const project = useProjectStore.getState().project;
  if (!project) {
    useProjectStore.setState({ openState: 'idle', openError: null });
    return;
  }
  cancelActiveRunsForClose();
  await flushSave();
  releaseAllUrls();
  resetUi();
  useProjectStore.setState({ project: null, openState: 'idle', openError: null, saveState: 'saved', saveError: null });
  void refreshProjectIndex();
}

export async function deleteProjectById(id: string, assetIds?: string[]): Promise<void> {
  let ids = assetIds;
  const open = useProjectStore.getState().project;
  if (open?.id === id) {
    ids = open.assets.map((a) => a.id);
    await closeProject();
  }
  if (!ids) {
    try {
      ids = (await loadProject(id)).assets.map((a) => a.id);
    } catch {
      ids = [];
    }
  }
  try {
    await deleteProject(id, ids);
    forgetSessionBlobs(ids);
    ids.forEach(releaseAsset);
    pushToast({ tone: 'success', title: 'Project deleted' });
  } catch (err) {
    pushToast({ tone: 'error', title: 'Could not delete project', message: err instanceof Error ? err.message : String(err) });
  }
  await refreshProjectIndex();
}

export function updateProjectDetails(patch: { name?: string; description?: string }): void {
  mutateProject((p) => {
    if (patch.name !== undefined && patch.name.trim()) p.name = patch.name.trim();
    if (patch.description !== undefined) p.description = patch.description;
  });
}

export function setScript(text: string, sourceFileName?: string | null): void {
  mutateProject((p) => {
    p.script.text = text;
    if (sourceFileName !== undefined) p.script.sourceFileName = sourceFileName;
    p.script.updatedAt = nowIso();
  });
}

export function setReviewChecks(checks: string[]): void {
  mutateProject((p) => {
    p.reviewConfig.checks = checks;
  });
}
