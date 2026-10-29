import { useState, type ReactNode } from 'react';
import type { Asset } from '../../domain/schemas';
import { formatBytes, formatDateTime, formatDuration } from '../../domain/time';
import { useAssetMedia } from '../../media/mediaRegistry';
import { describeMediaError, VIDEO_ACCEPT } from '../../media/probe';
import { fileMatchesAsset, replaceAssetFile, retryPersist, usePersisting } from '../../state/mediaActions';
import { pushToast } from '../../state/toastStore';
import { PlaybackBadge, StorageBadge, storageDescription } from '../components/Badges';
import { Dialog } from '../components/Dialog';
import { FileButton } from '../components/DropZone';
import { InlineText } from '../components/Fields';
import { Icon } from '../components/Icon';
import { renameAsset } from '../../state/mediaActions';

export function AssetPreview({ asset, className = 'asset-preview' }: { asset: Asset; className?: string }) {
  const media = useAssetMedia(asset.id);
  const [error, setError] = useState<{ url: string; message: string } | null>(null);
  const url = media?.url ?? null;
  const currentError = error && error.url === url ? error.message : null;
  if (!url) {
    return (
      <div className={`${className} asset-preview--empty`}>
        {media?.state === 'loading' ? 'Loading…' : media?.state === 'missing' || media?.state === 'error' ? 'File needs reattaching' : 'No preview'}
      </div>
    );
  }
  return (
    <div className={className}>
      <video
        src={url}
        controls
        preload="metadata"
        muted
        playsInline
        aria-label={`Preview of ${asset.displayName}`}
        onError={(e) => setError({ url, message: describeMediaError(e.currentTarget.error, asset.media.container) })}
      />
      {currentError && (
        <p className="asset-preview__error" role="alert">
          {currentError}
        </p>
      )}
    </div>
  );
}

export function AssetMeta({ asset }: { asset: Asset }) {
  const m = asset.media;
  return (
    <dl className="meta-grid">
      <div>
        <dt>Duration</dt>
        <dd>{formatDuration(m.durationSec)}</dd>
      </div>
      <div>
        <dt>Resolution</dt>
        <dd>{m.width && m.height ? `${m.width}×${m.height}` : 'Unknown'}</dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd>{formatBytes(asset.sizeBytes)}</dd>
      </div>
      <div>
        <dt>Format</dt>
        <dd>
          {m.container ?? 'Unknown'}
          {asset.mimeType ? ` · ${asset.mimeType}` : ''}
        </dd>
      </div>
      <div>
        <dt>Imported</dt>
        <dd>{formatDateTime(asset.importedAt)}</dd>
      </div>
    </dl>
  );
}

/**
 * One imported file: preview, metadata, storage status, and replace/reattach.
 * `extra` holds take- or reference-specific controls.
 */
export function AssetCard({
  asset,
  title,
  extra,
  actions,
  replaceWarning,
}: {
  asset: Asset;
  title: ReactNode;
  extra?: ReactNode;
  actions?: ReactNode;
  /** When set, replacing asks for confirmation with this message. */
  replaceWarning?: string | null;
}) {
  const media = useAssetMedia(asset.id);
  const persisting = usePersisting((s) => Boolean(s.ids[asset.id]));
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: File; reason: string } | null>(null);
  const storage = storageDescription(asset, media, persisting);
  const needsReattach = media?.state === 'missing' || media?.state === 'error';

  const doReplace = async (file: File, mode: 'replace' | 'reattach') => {
    setBusy(true);
    try {
      const result = await replaceAssetFile(asset.id, file);
      if (!result.ok) pushToast({ tone: 'error', title: `Could not use ${file.name}`, message: result.message ?? undefined });
      else
        pushToast({
          tone: result.message ? 'warning' : 'success',
          title: mode === 'reattach' ? `Reattached ${file.name}` : `Replaced with ${file.name}`,
          message: result.message ?? undefined,
        });
    } finally {
      setBusy(false);
    }
  };

  const onPick = (file: File, mode: 'replace' | 'reattach') => {
    if (mode === 'reattach' && !fileMatchesAsset(asset, file)) {
      setPending({
        file,
        reason: `The chosen file (${file.name}, ${formatBytes(file.size)}) doesn't match the original (${asset.fileName}, ${formatBytes(asset.sizeBytes)}). Findings were made against the original.`,
      });
      return;
    }
    if (mode === 'replace' && replaceWarning) {
      setPending({ file, reason: replaceWarning });
      return;
    }
    void doReplace(file, mode);
  };

  return (
    <article className={`asset-card${needsReattach ? ' asset-card--missing' : ''}`} aria-label={`${asset.kind === 'reference' ? 'Reference' : 'Generated'} video ${asset.displayName}`}>
      <AssetPreview asset={asset} />
      <div className="asset-card__body">
        <div className="asset-card__title">
          {title}
          <InlineText label={`Display name for ${asset.fileName}`} value={asset.displayName} onCommit={(v) => renameAsset(asset.id, v)} className="input input--title" />
        </div>
        <p className="asset-card__file" title={asset.fileName}>
          <Icon name="file" size={14} /> {asset.fileName}
        </p>
        <div className="row row--wrap">
          <StorageBadge asset={asset} media={media} persisting={persisting} />
          <PlaybackBadge asset={asset} />
        </div>
        {asset.playback.status === 'unsupported' && asset.playback.message && (
          <p className="notice notice--error notice--inline" role="note">
            {asset.playback.message}
          </p>
        )}
        {(storage.tone === 'candidate' || storage.tone === 'error') && <p className="field__hint">{storage.detail}</p>}
        <AssetMeta asset={asset} />
        {extra}
        <div className="row row--wrap asset-card__actions">
          {needsReattach ? (
            <FileButton label="Reattach file" accept={VIDEO_ACCEPT} onFile={(f) => onPick(f, 'reattach')} className="btn btn--primary btn--sm" disabled={busy} icon="link" />
          ) : (
            <FileButton label="Replace file" accept={VIDEO_ACCEPT} onFile={(f) => onPick(f, 'replace')} disabled={busy} icon="refresh" />
          )}
          {asset.storage === 'session-only' && !needsReattach && media?.state === 'ready' && !persisting && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void retryPersist(asset.id)}>
              Save to browser
            </button>
          )}
          {actions}
        </div>
      </div>
      <Dialog
        open={pending !== null}
        title="Use this file?"
        onClose={() => setPending(null)}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                const p = pending;
                setPending(null);
                if (p) void doReplace(p.file, needsReattach ? 'reattach' : 'replace');
              }}
            >
              Use {pending?.file.name}
            </button>
          </>
        }
      >
        <p>{pending?.reason}</p>
      </Dialog>
    </article>
  );
}
