/**
 * Renders still frames from a video URL for evidence thumbnails.
 * Requests are serialized per URL on a dedicated hidden <video> element and
 * cached, so many thumbnails don't fight over one decoder.
 */
interface Grabber {
  video: HTMLVideoElement;
  ready: Promise<void>;
  queue: Promise<unknown>;
}

const grabbers = new Map<string, Grabber>();
const cache = new Map<string, string>();
const MAX_CACHE = 200;

function getGrabber(url: string): Grabber {
  let g = grabbers.get(url);
  if (g) return g;
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  const ready = new Promise<void>((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Could not load video for frame capture.')), { once: true });
  });
  video.src = url;
  g = { video, ready, queue: Promise.resolve() };
  grabbers.set(url, g);
  return g;
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.min(Math.max(0, time), Math.max(0, (video.duration || 0) - 0.001));
    if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) {
      resolve();
      return;
    }
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Seeking failed during frame capture.'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = target;
  });
}

export function grabFrame(url: string, timeSec: number, maxWidth = 320): Promise<string> {
  const key = `${url}#${timeSec.toFixed(3)}@${maxWidth}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const g = getGrabber(url);
  const job = g.queue.then(async () => {
    await g.ready;
    await seek(g.video, timeSec);
    const vw = g.video.videoWidth;
    const vh = g.video.videoHeight;
    if (!vw || !vh) throw new Error('No video frame available.');
    const scale = Math.min(1, maxWidth / vw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable.');
    ctx.drawImage(g.video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (cache.size >= MAX_CACHE) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    cache.set(key, dataUrl);
    return dataUrl;
  });
  g.queue = job.catch(() => undefined);
  return job;
}

/** Drops decoders and cached frames for a URL that is about to be revoked. */
export function releaseFrameGrabber(url: string): void {
  const g = grabbers.get(url);
  if (g) {
    g.video.removeAttribute('src');
    g.video.load();
    grabbers.delete(url);
  }
  for (const key of [...cache.keys()]) if (key.startsWith(`${url}#`)) cache.delete(key);
}
