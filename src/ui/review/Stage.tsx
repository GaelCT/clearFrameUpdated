import { useId } from 'react';
import type { Project } from '../../domain/schemas';
import { findingsForTake, takeStatus } from '../../domain/status';
import { formatDuration } from '../../domain/time';
import { setReferenceOffset } from '../../state/mediaActions';
import { FRAME_STEP_SEC } from '../../state/playerStore';
import { useUi, type CompareMode } from '../../state/uiStore';
import { TakeStatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { routeHref } from '../router';
import type { ReviewContext } from './context';
import { PlayerArea } from './PlayerArea';
import { RunStatus } from './RunPanel';
import { Timeline } from './Timeline';

function OffsetControl({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const id = useId();
  const nudge = (d: number) => onChange(Math.round((value + d) * 1000) / 1000);
  return (
    <div className="offset-control" role="group" aria-label={label}>
      <label htmlFor={id}>{label}</label>
      <button type="button" className="btn btn--ghost btn--xs" onClick={() => nudge(-FRAME_STEP_SEC)} aria-label="Offset back one frame">
        −1f
      </button>
      <input
        id={id}
        type="number"
        className="input input--compact input--mono offset-control__input"
        step={0.01}
        value={Number(value.toFixed(3))}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        data-testid="offset-input"
      />
      <span className="muted">s</span>
      <button type="button" className="btn btn--ghost btn--xs" onClick={() => nudge(FRAME_STEP_SEC)} aria-label="Offset forward one frame">
        +1f
      </button>
      <button type="button" className="btn btn--ghost btn--xs" onClick={() => onChange(0)} disabled={value === 0}>
        Reset
      </button>
    </div>
  );
}

export function Stage({ project, ctx }: { project: Project; ctx: ReviewContext }) {
  const { compareMode, parentOffsets, showAllOverlays, drawMode, selectedFindingId } = useUi();
  const findings = findingsForTake(project, ctx.take.id);
  const info = takeStatus(project, ctx.take);
  const correction = ctx.take.correctionId ? project.corrections.find((c) => c.id === ctx.take.correctionId) : undefined;
  const version = correction?.versions.find((v) => v.id === ctx.take.promptVersionId);

  const effectiveMode: CompareMode =
    compareMode === 'reference' && ctx.reference ? 'reference' : compareMode === 'parent' && ctx.parentAsset ? 'parent' : 'off';
  const parentOffset = parentOffsets[ctx.take.id] ?? 0;
  const secondary =
    effectiveMode === 'reference' && ctx.reference
      ? { asset: ctx.reference, label: 'Reference', offsetSec: ctx.shot.referenceOffsetSec }
      : effectiveMode === 'parent' && ctx.parentAsset && ctx.parentTake
        ? { asset: ctx.parentAsset, label: `Parent · Take ${ctx.parentTake.number}`, offsetSec: parentOffset }
        : null;

  const setMode = (mode: CompareMode) => useUi.setState({ compareMode: mode });
  const selectedFinding = findings.find((f) => f.id === selectedFindingId) ?? null;

  return (
    <div className="stage">
      <header className="stage__header">
        <div className="stage__title">
          <h1>
            <span className="muted">{ctx.shot.name} ·</span> Take {ctx.take.number}
          </h1>
          <TakeStatusBadge info={info} />
        </div>
        <p className="stage__sub">
          {ctx.asset ? `${ctx.asset.displayName} · ${formatDuration(ctx.asset.media.durationSec)}` : 'No video'}
          {ctx.parentTake && (
            <>
              {' · '}
              <Icon name="link" size={12} /> Retake of Take {ctx.parentTake.number}
              {version ? `, from approved prompt v${version.number}` : ', no linked prompt version'}
            </>
          )}
          {ctx.shot.description && <span className="stage__note"> · {ctx.shot.description}</span>}
        </p>
      </header>

      <RunStatus project={project} ctx={ctx} />

      <div className="player-toolbar" role="toolbar" aria-label="Viewer options">
        <div className="segmented" role="group" aria-label="Comparison view">
          <button type="button" aria-pressed={effectiveMode === 'off'} onClick={() => setMode('off')}>
            Single
          </button>
          <button
            type="button"
            aria-pressed={effectiveMode === 'reference'}
            onClick={() => setMode('reference')}
            disabled={!ctx.reference}
            title={ctx.reference ? 'Side by side with reference footage' : 'No reference footage attached to this shot'}
          >
            <Icon name="columns" size={14} /> Reference
          </button>
          {ctx.parentTake && (
            <button
              type="button"
              aria-pressed={effectiveMode === 'parent'}
              onClick={() => setMode('parent')}
              disabled={!ctx.parentAsset}
              title="Side by side with the parent take"
            >
              <Icon name="columns" size={14} /> Original vs retake
            </button>
          )}
        </div>
        {!ctx.reference && effectiveMode === 'off' && (
          <a className="muted toolbar-link" href={routeHref({ name: 'media', projectId: project.id })}>
            Attach reference footage
          </a>
        )}
        {effectiveMode === 'reference' && (
          <OffsetControl
            label="Reference offset"
            value={ctx.shot.referenceOffsetSec}
            onChange={(v) => setReferenceOffset(ctx.shot.id, v)}
          />
        )}
        {effectiveMode === 'parent' && (
          <OffsetControl
            label="Parent offset"
            value={parentOffset}
            onChange={(v) => useUi.setState((s) => ({ parentOffsets: { ...s.parentOffsets, [ctx.take.id]: v } }))}
          />
        )}
        <span className="toolbar-spacer" />
        <label className="toggle">
          <input type="checkbox" checked={showAllOverlays} onChange={(e) => useUi.setState({ showAllOverlays: e.target.checked })} />
          Show all regions
        </label>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-pressed={drawMode}
          disabled={!selectedFinding}
          title={selectedFinding ? 'Drag on the video to mark a region for the selected finding' : 'Select a finding first'}
          onClick={() => useUi.setState({ drawMode: !drawMode })}
          data-testid="draw-region"
        >
          <Icon name="box" /> {drawMode ? 'Drawing…' : 'Draw region'}
        </button>
      </div>

      <PlayerArea
        key={ctx.take.id}
        asset={ctx.asset}
        takeLabel={`Take ${ctx.take.number}`}
        secondary={secondary}
        findings={findings}
      />

      <Timeline findings={findings} duration={ctx.asset?.media.durationSec ?? null} />
    </div>
  );
}
