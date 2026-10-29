import { ProjectSchema, summarizeProject, type Project, type ProjectSummary } from '../domain/schemas';
import { STORE_BLOBS, STORE_PROJECTS, StorageError, idbDelete, idbGet, idbGetAll, idbHasKey, idbPut, openDb } from './db';

interface BlobRecord {
  assetId: string;
  blob: Blob;
  storedAt: string;
}

export interface UnreadableProject {
  id: string;
  name: string;
  error: string;
}

export async function checkStorage(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await openDb();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listProjects(): Promise<{ projects: ProjectSummary[]; unreadable: UnreadableProject[] }> {
  const docs = await idbGetAll<unknown>(STORE_PROJECTS, 'list saved projects');
  const projects: ProjectSummary[] = [];
  const unreadable: UnreadableProject[] = [];
  for (const doc of docs) {
    const parsed = ProjectSchema.safeParse(doc);
    if (parsed.success) projects.push(summarizeProject(parsed.data));
    else {
      const raw = doc as { id?: unknown; name?: unknown };
      unreadable.push({
        id: typeof raw?.id === 'string' ? raw.id : '(unknown)',
        name: typeof raw?.name === 'string' ? raw.name : 'Unnamed project',
        error: parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
    }
  }
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { projects, unreadable };
}

export async function loadProject(id: string): Promise<Project> {
  const doc = await idbGet<unknown>(STORE_PROJECTS, id, 'open the project');
  if (doc === undefined) throw new StorageError('unknown', 'This project no longer exists in browser storage.');
  const parsed = ProjectSchema.safeParse(doc);
  if (!parsed.success) {
    throw new StorageError('corrupt', 'The saved project data is not in a format this version of ClearFrame can read.');
  }
  return parsed.data;
}

export async function saveProject(project: Project): Promise<void> {
  await idbPut(STORE_PROJECTS, project, 'save the project');
}

export async function deleteProject(id: string, assetIds: string[]): Promise<void> {
  await idbDelete(STORE_BLOBS, assetIds, 'delete stored videos');
  await idbDelete(STORE_PROJECTS, [id], 'delete the project');
}

export async function saveBlob(assetId: string, blob: Blob): Promise<void> {
  const record: BlobRecord = { assetId, blob, storedAt: new Date().toISOString() };
  await idbPut(STORE_BLOBS, record, 'store the video file');
}

export async function loadBlob(assetId: string): Promise<Blob | null> {
  const record = await idbGet<BlobRecord>(STORE_BLOBS, assetId, 'read a stored video file');
  return record?.blob ?? null;
}

export async function hasBlob(assetId: string): Promise<boolean> {
  return idbHasKey(STORE_BLOBS, assetId, 'check a stored video file');
}

export async function deleteBlobs(assetIds: string[]): Promise<void> {
  await idbDelete(STORE_BLOBS, assetIds, 'delete stored videos');
}

export async function estimateStorage(): Promise<{ usage: number | null; quota: number | null; persisted: boolean | null }> {
  try {
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    return { usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted };
  } catch {
    return { usage: null, quota: null, persisted: null };
  }
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    return navigator.storage?.persist ? await navigator.storage.persist() : null;
  } catch {
    return null;
  }
}
