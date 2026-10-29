import type { MediaInfo, PlaybackStatus } from '../domain/schemas';

const EXTENSION_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
};

export const VIDEO_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv,.ogv,.avi';
export const SCRIPT_ACCEPT = '.txt,.md,.markdown,text/plain,text/markdown';

export interface ProbeOutcome {
  /** False when the file is rejected outright (not a video or unreadable). */
  accepted: boolean;
  rejectReason: string | null;
  mimeType: string;
  media: MediaInfo;
  playback: { status: PlaybackStatus; message: string | null };
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function guessVideoMime(file: File): string {
  if (file.type && file.type.startsWith('video/')) return file.type;
  return EXTENSION_TYPES[extensionOf(file.name)] ?? file.type ?? '';
}

export function looksLikeVideo(file: File): boolean {
  return file.type.startsWith('video/') || extensionOf(file.name) in EXTENSION_TYPES;
}

/** Identifies the container from the first bytes of the file. */
export async function sniffContainer(file: Blob): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 200).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (head.length >= 12) {
    const box = ascii(4, 8);
    if (box === 'ftyp') {
      const brand = ascii(8, 12);
      return brand === 'qt  ' ? 'QuickTime' : 'MP4';
    }
    if (['moov', 'mdat', 'free', 'wide', 'skip'].includes(box)) return 'QuickTime';
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    const text = ascii(0, 32);
    return text.includes('webm') ? 'WebM' : 'Matroska';
  }
  if (ascii(0, 4) === 'OggS') return 'Ogg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 11) === 'AVI') return 'AVI';
  // MPEG transport stream: sync byte repeats every 188 bytes.
  if (head.length > 188 && head[0] === 0x47 && head[188] === 0x47) return 'MPEG-TS';
  return null;
}

export function describeMediaError(error: MediaError | null, container: string | null): string {
  const what = container ? `this ${container} file` : 'this file';
  switch (error?.code) {
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return `This browser cannot play ${what}. The codec is probably unsupported (for example ProRes, FFV1, or HEVC on some systems). Convert it to H.264/AAC MP4 or VP9/Opus WebM and replace the file.`;
    case MediaError.MEDIA_ERR_DECODE:
      return `Decoding failed partway through ${what}. It may be corrupt or use an unsupported codec profile.`;
    case MediaError.MEDIA_ERR_NETWORK:
      return `The browser lost access to ${what} while reading it. Try reattaching it.`;
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Loading was interrupted.';
    default:
      return `The browser could not read ${what}${error?.message ? ` (${error.message})` : ''}.`;
  }
}

const EMPTY_MEDIA: MediaInfo = { durationSec: null, width: null, height: null, hasVideoTrack: null, container: null };

/**
 * Validates a video file and reads its metadata with a hidden <video> element.
 * Files that are not video are rejected. Video files the browser cannot decode
 * are accepted but marked unsupported, so the reviewer can replace them.
 */
export async function probeVideoFile(file: File, timeoutMs = 20000): Promise<ProbeOutcome> {
  const mimeType = guessVideoMime(file);
  const reject = (reason: string): ProbeOutcome => ({
    accepted: false,
    rejectReason: reason,
    mimeType,
    media: EMPTY_MEDIA,
    playback: { status: 'unsupported', message: reason },
  });

  if (!looksLikeVideo(file)) {
    return reject(`Not a video file${file.type ? ` (type ${file.type})` : ''}. Use MP4, MOV, WebM, or another video format.`);
  }
  if (file.size === 0) return reject('The file is empty.');

  let container: string | null;
  try {
    container = await sniffContainer(file);
  } catch {
    return reject('The file could not be read. It may have been moved or permissions may have changed.');
  }
  if (!container) {
    return reject(
      "Invalid video file: its contents don't match any known video container (MP4, MOV, WebM, Matroska, Ogg, AVI), even though the name suggests a video.",
    );
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  try {
    const result = await new Promise<ProbeOutcome>((resolve) => {
      let settled = false;
      let metadata: MediaInfo = { ...EMPTY_MEDIA, container };
      const finish = (outcome: ProbeOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };
      const unsupported = (message: string): ProbeOutcome => ({
        accepted: true,
        rejectReason: null,
        mimeType,
        media: metadata,
        playback: { status: 'unsupported', message },
      });
      const timer = setTimeout(() => {
        finish(
          unsupported(
            metadata.durationSec == null
              ? 'Timed out while reading the file. The browser may not support its format.'
              : 'The browser read the file information but could not decode a frame in time.',
          ),
        );
      }, timeoutMs);

      video.addEventListener('error', () => finish(unsupported(describeMediaError(video.error, container))));
      video.addEventListener('loadedmetadata', () => {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        const hasVideoTrack = video.videoWidth > 0 && video.videoHeight > 0;
        metadata = {
          durationSec: duration,
          width: hasVideoTrack ? video.videoWidth : null,
          height: hasVideoTrack ? video.videoHeight : null,
          hasVideoTrack,
          container,
        };
        if (!hasVideoTrack) {
          finish(
            unsupported(
              'No decodable picture: the browser found no video track it can display. The video codec is probably unsupported, or the file is audio only.',
            ),
          );
        }
      });
      video.addEventListener('loadeddata', () => {
        if (metadata.hasVideoTrack) {
          finish({
            accepted: true,
            rejectReason: null,
            mimeType,
            media: metadata,
            playback: { status: 'playable', message: null },
          });
        }
      });
      video.src = url;
      video.load();
    });
    return result;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function readScriptFile(file: File): Promise<string> {
  const ext = extensionOf(file.name);
  const okType = file.type === '' || file.type.startsWith('text/');
  if (!['txt', 'md', 'markdown'].includes(ext) || !okType) {
    throw new Error('Scripts must be .txt or .md text files.');
  }
  if (file.size > 2 * 1024 * 1024) throw new Error('That script file is larger than 2 MB. Paste the relevant part instead.');
  const text = await file.text();
  if (text.includes('\u0000')) throw new Error('That file does not look like plain text.');
  return text;
}
