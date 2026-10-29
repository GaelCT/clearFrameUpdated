import { useEffect } from 'react';
import { getProject } from '../../state/projectStore';
import { player, usePlayer } from '../../state/playerStore';
import { setFindingState, updateFindingInterval } from '../../state/reviewActions';
import { useUi } from '../../state/uiStore';
import { findingsForTake } from '../../domain/status';
import { addFindingAtPlayhead } from './FindingsPanel';
import { toggleFullscreen } from './fullscreen';
import { selectAndSeek } from './Timeline';

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Space or K', action: 'Play / pause' },
  { keys: '← / →', action: 'Step one frame (≈1/30 s)' },
  { keys: 'Shift + ← / →', action: 'Jump 1 second' },
  { keys: 'J / L', action: 'Jump 5 seconds back / forward' },
  { keys: 'Home / End', action: 'Go to start / end' },
  { keys: 'M', action: 'Mute / unmute' },
  { keys: 'F', action: 'Fullscreen' },
  { keys: '[ / ]', action: 'Previous / next finding' },
  { keys: 'N', action: 'Add a manual finding at the playhead' },
  { keys: 'I / O', action: 'Set selected finding start / end to the playhead' },
  { keys: 'C / X / U', action: 'Confirm / dismiss / return to candidate' },
  { keys: 'Esc', action: 'Stop drawing a region' },
  { keys: '?', action: 'Show this list' },
];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'range'].includes(type);
  }
  return false;
}

/** Keyboard shortcuts for the review workspace. Ignored while typing or in dialogs. */
export function useReviewShortcuts(takeId: string | null, durationSec: number | null): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const target = e.target as HTMLElement | null;
      const onControl = target?.closest('button, a, [role="slider"], [role="tab"], input[type="range"], summary');
      const key = e.key;

      if (key === '?') {
        useUi.setState({ shortcutsOpen: true });
        e.preventDefault();
        return;
      }
      if (!takeId) return;
      const project = getProject();
      const findings = project ? findingsForTake(project, takeId) : [];
      const { selectedFindingId, findingFilter } = useUi.getState();
      const selected = findings.find((f) => f.id === selectedFindingId) ?? null;
      const t = usePlayer.getState().currentTime;

      switch (key) {
        case ' ':
          if (onControl) return; // let buttons and sliders handle Space
          player.toggle();
          break;
        case 'k':
        case 'K':
          player.toggle();
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (target?.closest('[role="slider"], input[type="range"], [role="tab"]')) return;
          const dir = key === 'ArrowLeft' ? -1 : 1;
          if (e.shiftKey) player.seekBy(dir);
          else player.stepFrames(dir);
          break;
        }
        case 'j':
        case 'J':
          player.seekBy(-5);
          break;
        case 'l':
        case 'L':
          player.seekBy(5);
          break;
        case 'Home':
          if (onControl) return;
          player.seek(0);
          break;
        case 'End':
          if (onControl) return;
          player.seek(durationSec ?? usePlayer.getState().duration ?? 0);
          break;
        case 'm':
        case 'M':
          player.toggleMute();
          break;
        case 'f':
        case 'F':
          void toggleFullscreen();
          break;
        case 'n':
        case 'N':
          addFindingAtPlayhead(takeId, durationSec);
          useUi.setState({ inspectorTab: 'findings', findingFilter: 'all', runFilter: 'all' });
          break;
        case '[':
        case ']': {
          const visible = findings.filter((f) => findingFilter === 'all' || f.reviewState === findingFilter);
          if (!visible.length) return;
          const idx = selected ? visible.findIndex((f) => f.id === selected.id) : -1;
          let next: number;
          if (idx === -1) {
            next = key === ']' ? visible.findIndex((f) => f.startSec > t + 0.001) : visible.map((f) => f.startSec < t - 0.001).lastIndexOf(true);
            if (next === -1) next = key === ']' ? 0 : visible.length - 1;
          } else next = (idx + (key === ']' ? 1 : -1) + visible.length) % visible.length;
          selectAndSeek(visible[next]);
          break;
        }
        case 'i':
        case 'I':
          if (!selected) return;
          updateFindingInterval(selected.id, Math.min(t, selected.endSec), selected.endSec, { startSec: selected.startSec, endSec: selected.endSec });
          break;
        case 'o':
        case 'O':
          if (!selected) return;
          updateFindingInterval(selected.id, selected.startSec, Math.max(t, selected.startSec), { startSec: selected.startSec, endSec: selected.endSec });
          break;
        case 'c':
        case 'C':
          if (!selected) return;
          setFindingState(selected.id, 'confirmed');
          break;
        case 'x':
        case 'X':
          if (!selected) return;
          setFindingState(selected.id, 'dismissed');
          break;
        case 'u':
        case 'U':
          if (!selected) return;
          setFindingState(selected.id, 'candidate');
          break;
        case 'Escape':
          if (useUi.getState().drawMode) useUi.setState({ drawMode: false });
          else return;
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [takeId, durationSec]);
}
