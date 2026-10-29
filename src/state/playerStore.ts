/**
 * State and commands for the main review player. One <video> element is
 * attached at a time; the timeline, findings, and keyboard shortcuts drive it
 * through these commands.
 */
import { create } from 'zustand';

export const FRAME_STEP_SEC = 1 / 30;
export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface PlayerState {
  attached: boolean;
  currentTime: number;
  duration: number | null;
  paused: boolean;
  rate: number;
  volume: number;
  muted: boolean;
  waiting: boolean;
  error: MediaError | null;
}

export const usePlayer = create<PlayerState>(() => ({
  attached: false,
  currentTime: 0,
  duration: null,
  paused: true,
  rate: 1,
  volume: 0.8,
  muted: false,
  waiting: false,
  error: null,
}));

let video: HTMLVideoElement | null = null;
let rafId = 0;
let pendingSeek: number | null = null;
/** When set, playback pauses on reaching this time (used by "Play interval"). */
let stopAt: number | null = null;

function syncTime() {
  if (video) usePlayer.setState({ currentTime: video.currentTime });
}

function loop() {
  syncTime();
  if (video && stopAt != null && video.currentTime >= stopAt) {
    const end = stopAt;
    stopAt = null;
    video.pause();
    video.currentTime = end;
  }
  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

export function attachVideo(el: HTMLVideoElement): () => void {
  video = el;
  const { rate, volume, muted } = usePlayer.getState();
  el.playbackRate = rate;
  el.volume = volume;
  el.muted = muted;

  const onMeta = () => {
    const d = Number.isFinite(el.duration) ? el.duration : null;
    usePlayer.setState({ duration: d, error: null });
    if (pendingSeek != null) {
      el.currentTime = Math.min(pendingSeek, d ?? pendingSeek);
      pendingSeek = null;
    }
    syncTime();
  };
  const onPlay = () => {
    usePlayer.setState({ paused: false });
    if (!rafId) loop();
  };
  const onPause = () => {
    usePlayer.setState({ paused: true });
    stopAt = null;
    stopLoop();
    syncTime();
  };
  const onRate = () => usePlayer.setState({ rate: el.playbackRate });
  const onVolume = () => usePlayer.setState({ volume: el.volume, muted: el.muted });
  const onError = () => usePlayer.setState({ error: el.error, paused: true, waiting: false });
  const onWaiting = () => usePlayer.setState({ waiting: true });
  const onPlaying = () => usePlayer.setState({ waiting: false });
  const onEmptied = () => usePlayer.setState({ duration: null, currentTime: 0, paused: true, error: null });

  const events: [string, () => void][] = [
    ['loadedmetadata', onMeta],
    ['durationchange', onMeta],
    ['play', onPlay],
    ['pause', onPause],
    ['ended', onPause],
    ['ratechange', onRate],
    ['volumechange', onVolume],
    ['error', onError],
    ['waiting', onWaiting],
    ['playing', onPlaying],
    ['canplay', onPlaying],
    ['seeked', syncTime],
    ['timeupdate', syncTime],
    ['emptied', onEmptied],
  ];
  for (const [name, fn] of events) el.addEventListener(name, fn);
  usePlayer.setState({
    attached: true,
    paused: el.paused,
    error: el.error,
    waiting: false,
    currentTime: pendingSeek ?? el.currentTime,
    duration: Number.isFinite(el.duration) ? el.duration : null,
  });
  if (el.readyState >= 1) onMeta();

  return () => {
    for (const [name, fn] of events) el.removeEventListener(name, fn);
    stopLoop();
    if (video === el) {
      video = null;
      usePlayer.setState({ attached: false, paused: true, waiting: false });
    }
  };
}

export function getVideoElement(): HTMLVideoElement | null {
  return video;
}

export const player = {
  play(): void {
    if (!video) return;
    video.play().catch((err: unknown) => {
      // Autoplay restrictions or a decode failure; the error event covers the latter.
      if (err instanceof DOMException && err.name === 'NotAllowedError') usePlayer.setState({ paused: true });
    });
  },
  pause(): void {
    stopAt = null;
    video?.pause();
  },
  toggle(): void {
    if (!video) return;
    if (video.paused || video.ended) player.play();
    else player.pause();
  },
  /** Plays from start and pauses at end. */
  playRange(startSec: number, endSec: number): void {
    player.seek(startSec);
    stopAt = endSec > startSec ? endSec : null;
    player.play();
  },
  seek(timeSec: number): void {
    const t = Math.max(0, timeSec);
    if (stopAt != null && (t >= stopAt || t < 0)) stopAt = null;
    if (!video || video.readyState < 1) {
      pendingSeek = t;
      usePlayer.setState({ currentTime: t });
      return;
    }
    const d = Number.isFinite(video.duration) ? video.duration : t;
    video.currentTime = Math.min(t, d);
    usePlayer.setState({ currentTime: video.currentTime });
  },
  seekBy(deltaSec: number): void {
    player.seek((video?.currentTime ?? usePlayer.getState().currentTime) + deltaSec);
  },
  stepFrames(frames: number): void {
    player.pause();
    player.seekBy(frames * FRAME_STEP_SEC);
  },
  setRate(rate: number): void {
    usePlayer.setState({ rate });
    if (video) video.playbackRate = rate;
  },
  setVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, volume));
    usePlayer.setState({ volume: v, muted: v === 0 ? true : false });
    if (video) {
      video.volume = v;
      video.muted = v === 0;
    }
  },
  toggleMute(): void {
    const muted = !usePlayer.getState().muted;
    usePlayer.setState({ muted });
    if (video) video.muted = muted;
  },
};
