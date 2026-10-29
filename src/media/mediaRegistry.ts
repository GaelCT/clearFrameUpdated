/**
 * Tracks playable URLs for assets in the open project.
 *
 * Object URLs are created from blobs and revoked when an asset is removed or
 * replaced, or when the project is closed. Files imported this session that
 * could not be stored are kept in memory so the project can be reopened in
 * the same tab without reattaching.
 */
import { create } from 'zustand';
import type { Asset } from '../domain/schemas';
import { loadBlob } from '../persistence/repository';
import { releaseFrameGrabber } from './frameGrabber';

export type MediaAvailability = 'loading' | 'ready' | 'missing' | 'error';

export interface MediaEntry {
  state: MediaAvailability;
  url: string | null;
  revocable: boolean;
  error: string | null;
}

interface MediaState {
  entries: Record<string, MediaEntry>;
}

export const useMediaStore = create<MediaState>(() => ({ entries: {} }));

/** Blobs imported in this tab, kept until the asset is removed. */
const sessionBlobs = new Map<string, Blob>();

function revoke(url: string): void {
  releaseFrameGrabber(url);
  URL.revokeObjectURL(url);
}

function setEntry(assetId: string, entry: MediaEntry | null): void {
  useMediaStore.setState((s) => {
    const entries = { ...s.entries };
    const previous = entries[assetId];
    if (previous?.revocable && previous.url && previous.url !== entry?.url) revoke(previous.url);
    if (entry) entries[assetId] = entry;
    else delete entries[assetId];
    return { entries };
  });
}

export function registerBlob(assetId: string, blob: Blob): string {
  sessionBlobs.set(assetId, blob);
  const url = URL.createObjectURL(blob);
  setEntry(assetId, { state: 'ready', url, revocable: true, error: null });
  return url;
}

export function getSessionBlob(assetId: string): Blob | null {
  return sessionBlobs.get(assetId) ?? null;
}

/** Revokes the URL and forgets the in-memory blob. Use when an asset is deleted or replaced. */
export function releaseAsset(assetId: string): void {
  sessionBlobs.delete(assetId);
  setEntry(assetId, null);
}

/** Revokes every URL for the open project. In-memory blobs are kept for this tab. */
export function releaseAllUrls(): void {
  const { entries } = useMediaStore.getState();
  for (const entry of Object.values(entries)) {
    if (entry.revocable && entry.url) revoke(entry.url);
  }
  useMediaStore.setState({ entries: {} });
}

export function forgetSessionBlobs(assetIds: string[]): void {
  for (const id of assetIds) sessionBlobs.delete(id);
}

/** Resolves a URL for every asset: bundled URL, stored blob, in-memory blob, or "missing". */
export async function hydrateAssets(assets: readonly Asset[]): Promise<void> {
  await Promise.all(
    assets.map(async (asset) => {
      const existing = useMediaStore.getState().entries[asset.id];
      if (existing?.state === 'ready') return;
      if (asset.storage === 'bundled' && asset.bundledUrl) {
        setEntry(asset.id, { state: 'ready', url: asset.bundledUrl, revocable: false, error: null });
        return;
      }
      const inMemory = sessionBlobs.get(asset.id);
      if (inMemory) {
        registerBlob(asset.id, inMemory);
        return;
      }
      if (asset.storage === 'browser-storage') {
        setEntry(asset.id, { state: 'loading', url: null, revocable: false, error: null });
        try {
          const blob = await loadBlob(asset.id);
          if (blob) registerBlob(asset.id, blob);
          else setEntry(asset.id, { state: 'missing', url: null, revocable: false, error: 'The stored file was not found.' });
        } catch (err) {
          setEntry(asset.id, {
            state: 'error',
            url: null,
            revocable: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      setEntry(asset.id, {
        state: 'missing',
        url: null,
        revocable: false,
        error:
          asset.storage === 'backend'
            ? 'This file is held by the analysis backend and cannot be previewed here.'
            : 'This file was only loaded for an earlier session and must be reattached.',
      });
    }),
  );
}

export function useAssetMedia(assetId: string | null | undefined): MediaEntry | null {
  return useMediaStore((s) => (assetId ? (s.entries[assetId] ?? null) : null));
}

export function getAssetUrl(assetId: string | null | undefined): string | null {
  if (!assetId) return null;
  return useMediaStore.getState().entries[assetId]?.url ?? null;
}
