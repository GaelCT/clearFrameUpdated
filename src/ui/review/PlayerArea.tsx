import { useEffect, useRef, useState } from 'react';
import type { Asset, Finding } from '../../domain/schemas';
import { formatTime } from '../../domain/time';
import { useAssetMedia } from '../../media/mediaRegistry';
import { describeMediaError, VIDEO_ACCEPT } from '../../media/probe';
import { fileMatchesAsset, replaceAssetFile } from '../../state/mediaActions';
import { attachVideo, player, usePlayer } from '../../state/playerStore';
import { pushToast } from '../../state/toastStore';
import { useUi } from '../../state/uiStore';
import { FileButton } from '../components/DropZone';
import { registerFullscreenTarget } from './fullscreen';
import { OverlayLayer } from './OverlayLayer';
import { Transport } from './Transport';

interface Props {
  asset: Asset | null;
  takeLabel: string;
  secondary: { asset: Asset; label: string; offsetSec: number } | null;
  findings: Finding[];
}

function MissingMedia({ asset }: { asset: Asset }) {
  const media = useAssetMedia(asset.id);
  return (
    <div className="player__message" role="alert">
      <strong>{media?.state === 'loading' ? 'Loading video…' : 'This video needs to be reattached'}</strong>
      {media?.state !== 'loading' && (
        <>
          <p>{media?.error ?? 'The file is not available in this session.'}</p>
          <p className="muted">
            Original file: {asset.fileName}. Findings, decisions, and prompts are still saved.
          </p>
          <FileButton
            label="Reattach file"
            accept={VIDEO_ACCEPT}
            className="btn btn--primary"
            icon="link"
            onFile={async (file) => {
              if (!fileMatchesAsset(asset, file)) {
                pushToast({
                  tone: 'warning',
                  title: 'Different file attached',
                  message: `Expected ${asset.fileName}; got ${file.name}. Findings may not line up.`,
                });
              }
              const r = await replaceAssetFile(asset.id, file);
              if (!r.ok) pushToast({ tone: 'error', title: 'Could not reattach', message: r.message ?? undefined });
            }}
          />
        </>
      )}
    </div>
  );
}

function OutOfRangeNote({ label, offset, durationSec }: { label: string; offset: number; durationSec: number | null }) {
  const t = usePlayer((s) => s.currentTime) + offset;
  if (t >= 0 && (durationSec == null || t <= durationSec + 0.05)) return null;
  return (
    <div className="player__note" role="status">
      No {label.toLowerCase()} frame at {formatTime(t)}
    </div>
  );
}

/**
 * Main video view with optional synchronized second view (reference footage
 * or the parent take). The generated take is the master clock; the second
 * view follows it at `offsetSec` (second time = primary time + offset).
 */
export function PlayerArea({ asset, takeLabel, secondary, findings }: Props) {
  const primaryMedia = useAssetMedia(asset?.id);
  const secondaryMedia = useAssetMedia(secondary?.asset.id);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLVideoElement>(null);
  const secondaryRef = useRef<HTMLVideoElement>(null);
  const offsetRef = useRef(secondary?.offsetSec ?? 0);
  const applyRef = useRef<((force: boolean) => void) | null>(null);
  const [secondaryError, setSecondaryError] = useState<{ url: string; message: string } | null>(null);
  const error = usePlayer((s) => s.error);
  const waiting = usePlayer((s) => s.waiting);
  const drawMode = useUi((s) => s.drawMode);
  const primaryUrl = primaryMedia?.url ?? null;
  const secondaryUrl = secondary ? (secondaryMedia?.url ?? null) : null;

  useEffect(() => {
    const el = primaryRef.current;
    if (!el || !primaryUrl) return;
    return attachVideo(el);
  }, [primaryUrl]);

  useEffect(() => {
    registerFullscreenTarget(containerRef.current);
    return () => registerFullscreenTarget(null);
  }, []);

  // Keep the second view locked to the primary clock.
  useEffect(() => {
    const primary = primaryRef.current;
    const second = secondaryRef.current;
    if (!primary || !second || !secondaryUrl) {
      applyRef.current = null;
      return;
    }
    let raf = 0;
    const apply = (force: boolean) => {
      const target = primary.currentTime + offsetRef.current;
      const duration = Number.isFinite(second.duration) ? second.duration : null;
      const inRange = target >= 0 && (duration == null || target <= duration);
      if (!inRange) {
        if (!second.paused) second.pause();
        if (second.readyState >= 1) second.currentTime = Math.max(0, Math.min(target, duration ?? 0));
        return;
      }
      if (second.readyState >= 1) {
        const tolerance = primary.paused ? 0.015 : 0.12;
        if (force || Math.abs(second.currentTime - target) > tolerance) second.currentTime = target;
      }
      if (second.playbackRate !== primary.playbackRate) second.playbackRate = primary.playbackRate;
      if (primary.paused && !second.paused) second.pause();
      if (!primary.paused && second.paused) void second.play().catch(() => undefined);
    };
    const tick = () => {
      apply(false);
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      apply(true);
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      apply(true);
    };
    const onSeek = () => apply(true);
    const onRate = () => apply(false);
    const onSecondaryReady = () => apply(true);
    primary.addEventListener('play', onPlay);
    primary.addEventListener('pause', onPause);
    primary.addEventListener('ended', onPause);
    primary.addEventListener('seeking', onSeek);
    primary.addEventListener('seeked', onSeek);
    primary.addEventListener('ratechange', onRate);
    second.addEventListener('loadedmetadata', onSecondaryReady);
    applyRef.current = apply;
    if (second.readyState >= 1) apply(true);
    if (!primary.paused) onPlay();
    return () => {
      cancelAnimationFrame(raf);
      primary.removeEventListener('play', onPlay);
      primary.removeEventListener('pause', onPause);
      primary.removeEventListener('ended', onPause);
      primary.removeEventListener('seeking', onSeek);
      primary.removeEventListener('seeked', onSeek);
      primary.removeEventListener('ratechange', onRate);
      second.removeEventListener('loadedmetadata', onSecondaryReady);
      applyRef.current = null;
    };
  }, [secondaryUrl, primaryUrl]);

  const offset = secondary?.offsetSec ?? 0;
  useEffect(() => {
    offsetRef.current = offset;
    applyRef.current?.(true);
  }, [offset]);

  const primaryError = error ? describeMediaError(error, asset?.media.container ?? null) : null;
  const showSecondary = Boolean(secondary);

  return (
    <div className="player" ref={containerRef}>
      <div className={`player__views${showSecondary ? ' player__views--split' : ''}`}>
        <div className="player__view">
          {showSecondary && <div className="player__view-label">Generated · {takeLabel}</div>}
          <div className="player__frame" ref={frameRef}>
            {!asset ? (
              <div className="player__message">This take has no video file.</div>
            ) : !primaryUrl ? (
              <MissingMedia asset={asset} />
            ) : (
              <>
                <video
                  ref={primaryRef}
                  src={primaryUrl}
                  preload="auto"
                  playsInline
                  className="player__video"
                  data-testid="primary-video"
                  aria-label={`Generated video, ${takeLabel}`}
                  onClick={() => {
                    if (!drawMode) player.toggle();
                  }}
                />
                <OverlayLayer frameRef={frameRef} videoW={asset.media.width} videoH={asset.media.height} findings={findings} />
                {waiting && !error && <div className="player__spinner" aria-hidden="true" />}
                {primaryError && (
                  <div className="player__message player__message--error" role="alert">
                    <strong>Playback failed</strong>
                    <p>{primaryError}</p>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => {
                          usePlayer.setState({ error: null });
                          primaryRef.current?.load();
                        }}
                      >
                        Try again
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {secondary && (
          <div className="player__view">
            <div className="player__view-label">
              {secondary.label} · offset {offset >= 0 ? '+' : ''}
              {offset.toFixed(2)} s
            </div>
            <div className="player__frame">
              {secondaryUrl ? (
                <>
                  <video
                    ref={secondaryRef}
                    src={secondaryUrl}
                    preload="auto"
                    playsInline
                    muted
                    className="player__video"
                    data-testid="secondary-video"
                    aria-label={secondary.label}
                    onError={(e) =>
                      setSecondaryError({
                        url: secondaryUrl,
                        message: describeMediaError(e.currentTarget.error, secondary.asset.media.container),
                      })
                    }
                  />
                  <OutOfRangeNote label={secondary.label} offset={offset} durationSec={secondary.asset.media.durationSec} />
                  {secondaryError && secondaryError.url === secondaryUrl && (
                    <div className="player__message player__message--error" role="alert">
                      {secondaryError.message}
                    </div>
                  )}
                </>
              ) : (
                <MissingMedia asset={secondary.asset} />
              )}
            </div>
          </div>
        )}
      </div>
      <Transport disabled={!primaryUrl} />
    </div>
  );
}
