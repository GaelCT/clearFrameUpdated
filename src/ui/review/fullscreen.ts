import { useSyncExternalStore } from 'react';

let target: HTMLElement | null = null;

export function registerFullscreenTarget(el: HTMLElement | null): void {
  target = el;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (target?.requestFullscreen) await target.requestFullscreen();
  } catch {
    // Fullscreen can be refused (for example inside some iframes); nothing to do.
  }
}

function subscribe(cb: () => void) {
  document.addEventListener('fullscreenchange', cb);
  return () => document.removeEventListener('fullscreenchange', cb);
}

export function useIsFullscreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.fullscreenElement !== null,
    () => false,
  );
}
