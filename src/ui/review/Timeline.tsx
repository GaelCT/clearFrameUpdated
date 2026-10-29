import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { categoryLabel } from '../../domain/categories';
import type { Finding } from '../../domain/schemas';
import { formatTime } from '../../domain/time';
import { updateFindingInterval } from '../../state/reviewActions';
import { FRAME_STEP_SEC, player, usePlayer } from '../../state/playerStore';
import { selectFinding, setInspectorTab, useUi } from '../../state/uiStore';
import { originLabel, reviewStateLabel } from '../components/Badges';

const LANE_HEIGHT = 26;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function assignLanes(findings: Finding[]): Map<string, number> {
  const sorted = [...findings].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const f of sorted) {
    // Treat very short findings as at least a sliver wide for packing.
    const end = Math.max(f.endSec, f.startSec + 0.05);
    let lane = laneEnds.findIndex((e) => e <= f.startSec);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else laneEnds[lane] = end;
    lanes.set(f.id, lane);
  }
  return lanes;
}

function ticksFor(duration: number, width: number): number[] {
  if (duration <= 0 || width <= 0) return [];
  const minPx = 70;
  const step = TICK_STEPS.find((s) => (s / duration) * width >= minPx) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return ticks;
}

export function selectAndSeek(finding: Finding): void {
  selectFinding(finding.id);
  setInspectorTab('findings');
  player.seek(finding.startSec);
}

export function Timeline({ findings, duration }: { findings: Finding[]; duration: number | null }) {
  const currentTime = usePlayer((s) => s.currentTime);
  const selectedId = useUi((s) => s.selectedFindingId);
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const scrubbing = useRef(false);
  const drag = useRef<{ edge: 'start' | 'end'; id: string; from: { startSec: number; endSec: number } } | null>(null);
  const keyEdit = useRef<{ id: string; from: { startSec: number; endSec: number } } | null>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const d = duration && duration > 0 ? duration : 0;
  const lanes = assignLanes(findings);
  const laneCount = Math.max(1, ...[...lanes.values()].map((l) => l + 1));
  const pct = (t: number) => (d ? `${(Math.min(Math.max(t, 0), d) / d) * 100}%` : '0%');
  const selected = findings.find((f) => f.id === selectedId) ?? null;

  const timeAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el || !d) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * d;
  };

  const onScrubDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!d || e.button !== 0) return;
    scrubbing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    player.seek(timeAt(e.clientX));
  };
  const onScrubMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) player.seek(timeAt(e.clientX));
  };
  const onScrubUp = () => {
    scrubbing.current = false;
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, edge: 'start' | 'end', f: Finding) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { edge, id: f.id, from: { startSec: f.startSec, endSec: f.endSec } };
  };
  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g || !selected || selected.id !== g.id) return;
    const t = timeAt(e.clientX);
    if (g.edge === 'start') updateFindingInterval(g.id, Math.min(t, selected.endSec), selected.endSec);
    else updateFindingInterval(g.id, selected.startSec, Math.max(t, selected.startSec));
    player.seek(t);
  };
  const endDrag = () => {
    const g = drag.current;
    drag.current = null;
    if (!g || !selected || selected.id !== g.id) return;
    updateFindingInterval(g.id, selected.startSec, selected.endSec, g.from);
  };

  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>, edge: 'start' | 'end', f: Finding) => {
    const step = e.shiftKey ? 1 : FRAME_STEP_SEC;
    let delta = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (!keyEdit.current || keyEdit.current.id !== f.id) keyEdit.current = { id: f.id, from: { startSec: f.startSec, endSec: f.endSec } };
    if (edge === 'start') {
      const s = Math.min(f.endSec, f.startSec + delta);
      updateFindingInterval(f.id, s, f.endSec);
      player.seek(s);
    } else {
      const en = Math.max(f.startSec, f.endSec + delta);
      updateFindingInterval(f.id, f.startSec, en);
      player.seek(en);
    }
  };
  const onHandleBlur = () => {
    const k = keyEdit.current;
    keyEdit.current = null;
    if (!k || !selected || selected.id !== k.id) return;
    updateFindingInterval(k.id, selected.startSec, selected.endSec, k.from);
  };

  const ticks = ticksFor(d, width);

  return (
    <div className="timeline" aria-label="Issue timeline">
      <div className="timeline__header">
        <span className="timeline__title">Timeline</span>
        <span className="timeline__legend" aria-hidden="true">
          <span className="legend legend--candidate">Candidate</span>
          <span className="legend legend--confirmed">Confirmed</span>
          <span className="legend legend--dismissed">Dismissed</span>
          <span className="legend legend--sim">Simulated</span>
        </span>
      </div>
      <div className="timeline__body" ref={trackRef}>
        <div
          className="timeline__ruler"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          data-testid="timeline-ruler"
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <span key={t} className="timeline__tick" style={{ left: pct(t) }}>
              <span>{formatTime(t, { fraction: d < 10 ? 1 : 0 })}</span>
            </span>
          ))}
        </div>
        <div
          className="timeline__lanes"
          style={{ height: laneCount * LANE_HEIGHT + 8 }}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          data-testid="timeline-lanes"
        >
          {selected && (
            <div
              className="timeline__selection"
              style={{ left: pct(selected.startSec), width: `calc(${pct(selected.endSec)} - ${pct(selected.startSec)})` }}
              data-testid="timeline-selection"
              aria-hidden="true"
            />
          )}
          {findings.length === 0 && <span className="timeline__empty">No findings to show</span>}
          {findings.map((f) => {
            const lane = lanes.get(f.id) ?? 0;
            const isSelected = f.id === selectedId;
            const label = `${categoryLabel(f.category)}, ${formatTime(f.startSec)} to ${formatTime(f.endSec)}, ${reviewStateLabel(f.reviewState)}, ${originLabel(f.origin)}`;
            return (
              <button
                key={f.id}
                type="button"
                className={`tl-bar tl-bar--${f.reviewState}${f.origin === 'simulation' ? ' tl-bar--sim' : ''}${isSelected ? ' tl-bar--selected' : ''}`}
                style={{
                  left: pct(f.startSec),
                  width: `max(6px, calc(${pct(f.endSec)} - ${pct(f.startSec)}))`,
                  top: 4 + lane * LANE_HEIGHT,
                }}
                aria-label={label}
                aria-pressed={isSelected}
                title={label}
                data-testid="timeline-bar"
                data-finding-id={f.id}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => selectAndSeek(f)}
              >
                <span className="tl-bar__text">
                  {f.origin === 'simulation' && <span className="tl-bar__sim">SIM</span>}
                  {categoryLabel(f.category)}
                </span>
              </button>
            );
          })}
          {selected &&
            (['start', 'end'] as const).map((edge) => {
              const t = edge === 'start' ? selected.startSec : selected.endSec;
              const lane = lanes.get(selected.id) ?? 0;
              return (
                <div
                  key={edge}
                  role="slider"
                  tabIndex={0}
                  className={`tl-handle tl-handle--${edge}`}
                  style={{ left: pct(t), top: 2 + lane * LANE_HEIGHT }}
                  aria-label={`${edge === 'start' ? 'Start' : 'End'} of selected finding`}
                  aria-valuemin={edge === 'start' ? 0 : selected.startSec}
                  aria-valuemax={edge === 'start' ? selected.endSec : d}
                  aria-valuenow={t}
                  aria-valuetext={formatTime(t)}
                  title={`Drag or use arrow keys to adjust the ${edge} (Shift for 1 s steps)`}
                  data-testid={`handle-${edge}`}
                  onPointerDown={(e) => startDrag(e, edge, selected)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => onHandleKey(e, edge, selected)}
                  onBlur={onHandleBlur}
                />
              );
            })}
        </div>
        <div className="timeline__playhead" style={{ left: pct(currentTime) }} aria-hidden="true" data-testid="playhead" />
      </div>
    </div>
  );
}
