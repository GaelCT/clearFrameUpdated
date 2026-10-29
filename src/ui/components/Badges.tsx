import type { Asset, FindingOrigin, ReviewState } from '../../domain/schemas';
import type { TakeStatusInfo } from '../../domain/status';
import type { MediaEntry } from '../../media/mediaRegistry';

export function SimulatedBadge({ label = 'Simulated' }: { label?: string }) {
  return (
    <span className="badge badge--sim" title="Invented by the demo adapter or sample data. Not a detection.">
      {label}
    </span>
  );
}

const ORIGIN_LABEL: Record<FindingOrigin, string> = {
  model: 'Model',
  'measured-signal': 'Measured signal',
  manual: 'Manual',
  simulation: 'Simulated',
};

export function OriginBadge({ origin }: { origin: FindingOrigin }) {
  if (origin === 'simulation') return <SimulatedBadge />;
  return <span className={`badge badge--origin badge--origin-${origin}`}>{ORIGIN_LABEL[origin]}</span>;
}

export function originLabel(origin: FindingOrigin): string {
  return ORIGIN_LABEL[origin];
}

const STATE_LABEL: Record<ReviewState, string> = {
  candidate: 'Candidate',
  confirmed: 'Confirmed',
  dismissed: 'Dismissed',
};

export function ReviewStateBadge({ state }: { state: ReviewState }) {
  return <span className={`badge badge--state badge--${state}`}>{STATE_LABEL[state]}</span>;
}

export function reviewStateLabel(state: ReviewState): string {
  return STATE_LABEL[state];
}

export function TakeStatusBadge({ info }: { info: TakeStatusInfo }) {
  return <span className={`badge badge--tone-${info.tone}`}>{info.label}</span>;
}

export function storageDescription(asset: Asset, media: MediaEntry | null, persisting: boolean): { label: string; tone: string; detail: string } {
  if (persisting) return { label: 'Saving to browser…', tone: 'progress', detail: 'Writing the file to browser storage.' };
  if (media?.state === 'missing' || media?.state === 'error') {
    return {
      label: 'Needs reattachment',
      tone: 'error',
      detail: media.error ?? 'The file is not available. Choose it again to reattach.',
    };
  }
  switch (asset.storage) {
    case 'bundled':
      return { label: 'Bundled sample', tone: 'neutral', detail: 'Shipped with ClearFrame.' };
    case 'browser-storage':
      return { label: 'Saved in browser', tone: 'ok', detail: 'Stored in this browser (IndexedDB). Survives reloads.' };
    case 'backend':
      return { label: 'On analysis backend', tone: 'neutral', detail: 'Held by the local analysis backend.' };
    case 'session-only':
    default:
      return {
        label: 'This session only',
        tone: 'candidate',
        detail: asset.storageError
          ? `Imported into the browser but not saved: ${asset.storageError}`
          : 'Imported into the browser but not saved. Reattach after reloading.',
      };
  }
}

export function StorageBadge({ asset, media, persisting }: { asset: Asset; media: MediaEntry | null; persisting: boolean }) {
  const d = storageDescription(asset, media, persisting);
  return (
    <span className={`badge badge--tone-${d.tone}`} title={d.detail}>
      {d.label}
    </span>
  );
}

export function PlaybackBadge({ asset }: { asset: Asset }) {
  if (asset.playback.status === 'playable') return <span className="badge badge--tone-ok">Playable</span>;
  if (asset.playback.status === 'unsupported')
    return (
      <span className="badge badge--tone-error" title={asset.playback.message ?? undefined}>
        Can’t play here
      </span>
    );
  return <span className="badge badge--tone-neutral">Not checked</span>;
}
