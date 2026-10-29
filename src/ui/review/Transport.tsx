import { useId } from 'react';
import { describeTime, formatTime } from '../../domain/time';
import { PLAYBACK_RATES, player, usePlayer } from '../../state/playerStore';
import { Icon } from '../components/Icon';
import { toggleFullscreen, useIsFullscreen } from './fullscreen';

export function Transport({ disabled }: { disabled?: boolean }) {
  const { currentTime, duration, paused, rate, volume, muted } = usePlayer();
  const fullscreen = useIsFullscreen();
  const rateId = useId();
  const volumeId = useId();
  const seekId = useId();
  const d = duration ?? 0;

  return (
    <div className="transport" role="group" aria-label="Playback controls">
      <button
        type="button"
        className="icon-btn"
        onClick={() => player.stepFrames(-1)}
        disabled={disabled}
        aria-label="Back one frame"
        title="Back one frame (←)"
      >
        <Icon name="stepBack" />
      </button>
      <button
        type="button"
        className="icon-btn icon-btn--primary"
        onClick={() => player.toggle()}
        disabled={disabled}
        aria-label={paused ? 'Play' : 'Pause'}
        title={paused ? 'Play (Space or K)' : 'Pause (Space or K)'}
        data-testid="play-toggle"
      >
        <Icon name={paused ? 'play' : 'pause'} size={18} />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => player.stepFrames(1)}
        disabled={disabled}
        aria-label="Forward one frame"
        title="Forward one frame (→)"
      >
        <Icon name="stepForward" />
      </button>

      <span className="transport__time" aria-live="off" data-testid="current-time">
        <span className="transport__now">{formatTime(currentTime)}</span>
        <span className="muted"> / {formatTime(duration)}</span>
      </span>

      <label htmlFor={seekId} className="visually-hidden">
        Seek
      </label>
      <input
        id={seekId}
        type="range"
        className="transport__seek"
        min={0}
        max={d || 0}
        step={0.01}
        value={Math.min(currentTime, d || currentTime)}
        disabled={disabled || !duration}
        aria-valuetext={`${describeTime(currentTime)} of ${describeTime(d)}`}
        onChange={(e) => player.seek(Number(e.target.value))}
        data-testid="seek"
      />

      <label htmlFor={rateId} className="visually-hidden">
        Playback speed
      </label>
      <select
        id={rateId}
        className="input input--compact"
        value={rate}
        onChange={(e) => player.setRate(Number(e.target.value))}
        disabled={disabled}
        title="Playback speed"
      >
        {PLAYBACK_RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>

      <button
        type="button"
        className="icon-btn"
        onClick={() => player.toggleMute()}
        disabled={disabled}
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
        title="Mute (M)"
      >
        <Icon name={muted || volume === 0 ? 'mute' : 'volume'} />
      </button>
      <label htmlFor={volumeId} className="visually-hidden">
        Volume
      </label>
      <input
        id={volumeId}
        type="range"
        className="transport__volume"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        disabled={disabled}
        aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
        onChange={(e) => player.setVolume(Number(e.target.value))}
      />

      <button
        type="button"
        className="icon-btn"
        onClick={() => void toggleFullscreen()}
        aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        title="Fullscreen (F)"
      >
        <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} />
      </button>
    </div>
  );
}
