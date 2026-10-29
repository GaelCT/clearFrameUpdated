import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import { nowIso } from '../domain/ids';
import type { Project, ProjectSummary } from '../domain/schemas';
import { listProjects, saveProject, type UnreadableProject } from '../persistence/repository';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'unavailable';

interface ProjectStoreState {
  project: Project | null;
  openState: 'idle' | 'loading' | 'ready' | 'error';
  openError: string | null;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: string | null;
}

export const useProjectStore = create<ProjectStoreState>(() => ({
  project: null,
  openState: 'idle',
  openError: null,
  saveState: 'saved',
  saveError: null,
  lastSavedAt: null,
}));

interface StorageHealthState {
  checked: boolean;
  available: boolean;
  error: string | null;
}

export const useStorageHealth = create<StorageHealthState>(() => ({ checked: false, available: true, error: null }));

interface ProjectIndexState {
  loading: boolean;
  error: string | null;
  projects: ProjectSummary[];
  unreadable: UnreadableProject[];
}

export const useProjectIndex = create<ProjectIndexState>(() => ({
  loading: false,
  error: null,
  projects: [],
  unreadable: [],
}));

export async function refreshProjectIndex(): Promise<void> {
  if (!useStorageHealth.getState().available) {
    useProjectIndex.setState({ loading: false, error: null });
    return;
  }
  useProjectIndex.setState({ loading: true, error: null });
  try {
    const { projects, unreadable } = await listProjects();
    useProjectIndex.setState({ loading: false, projects, unreadable });
  } catch (err) {
    useProjectIndex.setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// Mutation and saving
// ---------------------------------------------------------------------------

const SAVE_DELAY_MS = 350;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInFlight: Promise<void> | null = null;

export function getProject(): Project | null {
  return useProjectStore.getState().project;
}

export function requireProject(): Project {
  const p = getProject();
  if (!p) throw new Error('No project is open.');
  return p;
}

/** Applies an immutable update to the open project and schedules a save. */
export function mutateProject(recipe: (draft: Draft<Project>) => void): void {
  const { project } = useProjectStore.getState();
  if (!project) return;
  const next = produce(project, (draft) => {
    recipe(draft);
    draft.updatedAt = nowIso();
  });
  if (next === project) return;
  useProjectStore.setState({ project: next });
  scheduleSave();
}

export function scheduleSave(delay = SAVE_DELAY_MS): void {
  if (!useStorageHealth.getState().available) {
    useProjectStore.setState({ saveState: 'unavailable' });
    return;
  }
  useProjectStore.setState((s) => (s.saveState === 'saving' ? {} : { saveState: 'pending' }));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void performSave();
  }, delay);
}

async function performSave(): Promise<void> {
  if (saveInFlight) {
    await saveInFlight;
  }
  const snapshot = useProjectStore.getState().project;
  if (!snapshot) return;
  useProjectStore.setState({ saveState: 'saving' });
  const job = (async () => {
    try {
      await saveProject(snapshot);
      const current = useProjectStore.getState().project;
      if (current && current !== snapshot && current.id === snapshot.id) {
        // Changed while saving; another save is already scheduled or needed.
        if (!saveTimer) scheduleSave(0);
        return;
      }
      useProjectStore.setState({ saveState: 'saved', saveError: null, lastSavedAt: nowIso() });
    } catch (err) {
      useProjectStore.setState({
        saveState: 'error',
        saveError: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  saveInFlight = job;
  try {
    await job;
  } finally {
    if (saveInFlight === job) saveInFlight = null;
  }
}

/** Saves immediately, waiting for any in-flight save. */
export async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    await performSave();
  } else if (saveInFlight) {
    await saveInFlight;
  }
}

export function retrySave(): void {
  scheduleSave(0);
}

export function hasUnsavedChanges(): boolean {
  const s = useProjectStore.getState().saveState;
  return s === 'pending' || s === 'saving' || s === 'error' || s === 'unavailable';
}
