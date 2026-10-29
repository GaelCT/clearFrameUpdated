import type { Project } from '../../domain/schemas';
import { takeStatus } from '../../domain/status';
import { formatDuration } from '../../domain/time';
import { useMediaStore } from '../../media/mediaRegistry';
import { selectTake } from '../../state/uiStore';
import { TakeStatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { routeHref } from '../router';

export function ShotList({ project, currentTakeId }: { project: Project; currentTakeId: string | null }) {
  const media = useMediaStore((s) => s.entries);
  return (
    <nav className="shot-list" aria-label="Shots and takes">
      <div className="panel-header">
        <h2>Shots</h2>
        <a className="btn btn--ghost btn--sm" href={routeHref({ name: 'media', projectId: project.id })}>
          <Icon name="plus" /> Add media
        </a>
      </div>
      {project.shots.length === 0 && (
        <p className="muted shot-list__empty">No shots yet. Use “Add media” to import generated videos.</p>
      )}
      <ul className="shot-list__shots">
        {project.shots.map((shot) => {
          const takes = project.takes.filter((t) => t.shotId === shot.id).sort((a, b) => a.number - b.number);
          return (
            <li key={shot.id} className="shot-group">
              <div className="shot-group__header">
                <span className="shot-group__name">{shot.name}</span>
                {shot.referenceAssetId && (
                  <span className="badge badge--tone-neutral" title="Reference footage attached">
                    Ref
                  </span>
                )}
              </div>
              {takes.length === 0 ? (
                <p className="muted shot-group__empty">No takes</p>
              ) : (
                <ul className="take-list">
                  {takes.map((take) => {
                    const info = takeStatus(project, take);
                    const asset = take.assetId ? project.assets.find((a) => a.id === take.assetId) : undefined;
                    const entry = asset ? media[asset.id] : undefined;
                    const missing = entry?.state === 'missing' || entry?.state === 'error';
                    const parent = take.parentTakeId ? project.takes.find((t) => t.id === take.parentTakeId) : undefined;
                    const current = take.id === currentTakeId;
                    return (
                      <li key={take.id}>
                        <button
                          type="button"
                          className={`take-item${current ? ' take-item--current' : ''}${parent ? ' take-item--retake' : ''}`}
                          aria-current={current ? 'true' : undefined}
                          onClick={() => selectTake(shot.id, take.id)}
                          data-testid={`take-${take.id}`}
                        >
                          <span className="take-item__row">
                            <span className="take-item__name">
                              {parent && <span aria-hidden="true">↳ </span>}Take {take.number}
                            </span>
                            <TakeStatusBadge info={info} />
                          </span>
                          <span className="take-item__meta">
                            {parent ? `Retake of Take ${parent.number}` : (asset?.displayName ?? 'No file')}
                            {asset?.media.durationSec != null && ` · ${formatDuration(asset.media.durationSec)}`}
                          </span>
                          {info.pendingRechecks > 0 && (
                            <span className="take-item__flag">{info.pendingRechecks} to re-check</span>
                          )}
                          {missing && <span className="take-item__flag take-item__flag--error">File needs reattaching</span>}
                          {asset?.playback.status === 'unsupported' && (
                            <span className="take-item__flag take-item__flag--error">Can’t play here</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
