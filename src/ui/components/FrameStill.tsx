import { useEffect, useState } from 'react';
import { formatTime } from '../../domain/time';
import { grabFrame } from '../../media/frameGrabber';

/** A still frame rendered from the asset's own video at the given time. */
export function FrameStill({ url, timeSec, alt }: { url: string | null; timeSec: number; alt: string }) {
  const [state, setState] = useState<{ key: string; src: string | null; error: string | null } | null>(null);
  const key = `${url}#${timeSec}`;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    grabFrame(url, timeSec)
      .then((src) => {
        if (!cancelled) setState({ key, src, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ key, src: null, error: err instanceof Error ? err.message : 'Frame unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [url, timeSec, key]);

  const current = state?.key === key ? state : null;
  if (!url) return <div className="frame-still frame-still--empty">Video unavailable</div>;
  if (current?.error) return <div className="frame-still frame-still--empty">{current.error}</div>;
  if (!current?.src) return <div className="frame-still frame-still--loading" aria-label={`Loading frame at ${formatTime(timeSec)}`} />;
  return <img className="frame-still" src={current.src} alt={alt} />;
}
