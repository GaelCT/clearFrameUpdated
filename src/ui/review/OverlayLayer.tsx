import { useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { categoryLabel } from '../../domain/categories';
import type { Finding, SpatialAnnotation } from '../../domain/schemas';
import { addBoxAnnotation } from '../../state/reviewActions';
import { usePlayer } from '../../state/playerStore';
import { useUi } from '../../state/uiStore';

function useElementSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** The rectangle the video picture occupies inside its box (object-fit: contain). */
export function contentRect(boxW: number, boxH: number, videoW: number | null, videoH: number | null) {
  if (!videoW || !videoH || !boxW || !boxH) return { left: 0, top: 0, width: boxW, height: boxH };
  const scale = Math.min(boxW / videoW, boxH / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

export function annotationActive(f: Finding, a: SpatialAnnotation, t: number): boolean {
  const s = a.startSec ?? f.startSec;
  const e = a.endSec ?? f.endSec;
  return t >= s - 0.001 && t <= e + 0.001;
}

function sourceSuffix(a: SpatialAnnotation): string {
  if (a.source === 'simulation') return ' · simulated region';
  if (a.source === 'manual') return ' · manual';
  return '';
}

/**
 * Draws spatial annotations over the video. Only annotations with real
 * coordinates are drawn; findings without them show nothing here.
 */
export function OverlayLayer({
  frameRef,
  videoW,
  videoH,
  findings,
}: {
  frameRef: RefObject<HTMLDivElement | null>;
  videoW: number | null;
  videoH: number | null;
  findings: Finding[];
}) {
  const size = useElementSize(frameRef);
  const currentTime = usePlayer((s) => s.currentTime);
  const { selectedFindingId, showAllOverlays, drawMode } = useUi();
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const rect = contentRect(size.w, size.h, videoW, videoH);
  const selected = findings.find((f) => f.id === selectedFindingId) ?? null;

  const visible = findings.filter((f) =>
    f.id === selectedFindingId ? true : showAllOverlays && f.reviewState !== 'dismissed',
  );
  const boxes = visible.flatMap((f) =>
    f.annotations.filter((a) => annotationActive(f, a, currentTime)).map((a) => ({ f, a })),
  );

  const toNorm = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const finishDraw = () => {
    if (draft && selected) {
      const x = Math.min(draft.x0, draft.x1);
      const y = Math.min(draft.y0, draft.y1);
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);
      if (w > 0.01 && h > 0.01) {
        addBoxAnnotation(selected.id, { x, y, w, h }, null);
        useUi.setState({ drawMode: false });
      }
    }
    setDraft(null);
  };

  return (
    <div
      className={`overlay${drawMode && selected ? ' overlay--drawing' : ''}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      data-testid="overlay"
      onPointerDown={(e) => {
        if (!drawMode || !selected) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toNorm(e);
        setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!draft) return;
        const p = toNorm(e);
        setDraft({ ...draft, x1: p.x, y1: p.y });
      }}
      onPointerUp={finishDraw}
      onPointerCancel={() => setDraft(null)}
      onClick={(e) => {
        if (drawMode) e.stopPropagation();
      }}
    >
      {boxes.map(({ f, a }) => {
        const tone = f.reviewState;
        const label = `${a.label ?? categoryLabel(f.category)}${sourceSuffix(a)}`;
        if (a.type === 'box') {
          return (
            <div
              key={a.id}
              className={`overlay__box overlay__box--${tone}${a.source === 'simulation' ? ' overlay__box--sim' : ''}`}
              style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }}
              data-testid="overlay-box"
              role="img"
              aria-label={`Region: ${label}`}
            >
              <span className="overlay__label">{label}</span>
            </div>
          );
        }
        return (
          <svg key={a.id} className="overlay__svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Region: ${label}`}>
            <polygon
              className={`overlay__poly overlay__poly--${tone}`}
              points={a.points.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        );
      })}
      {draft && (
        <div
          className="overlay__box overlay__box--draft"
          style={{
            left: `${Math.min(draft.x0, draft.x1) * 100}%`,
            top: `${Math.min(draft.y0, draft.y1) * 100}%`,
            width: `${Math.abs(draft.x1 - draft.x0) * 100}%`,
            height: `${Math.abs(draft.y1 - draft.y0) * 100}%`,
          }}
        />
      )}
      {drawMode && selected && !draft && (
        <div className="overlay__hint" aria-hidden="true">
          Drag to draw a region for the selected finding · Esc to cancel
        </div>
      )}
    </div>
  );
}
