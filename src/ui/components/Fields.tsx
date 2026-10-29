import { useId, useState, type ReactNode } from 'react';
import { formatTime, parseTime } from '../../domain/time';

/**
 * Timestamp field accepting "12.5", "0:12.50", or "1:02:03.5". Commits on
 * Enter or blur; invalid input shows an error and reverts on Escape.
 */
export function TimeInput({
  label,
  value,
  onCommit,
  max,
  min = 0,
  testId,
}: {
  label: string;
  value: number;
  onCommit: (sec: number) => void;
  max?: number | null;
  min?: number;
  testId?: string;
}) {
  const formatted = formatTime(value);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const errId = useId();
  const text = draft ?? formatted;

  const commit = () => {
    if (draft === null) return;
    const parsed = parseTime(draft);
    if (parsed === null) {
      setError('Use a time like 3.5 or 0:03.50');
      return;
    }
    if (parsed < min || (max != null && parsed > max + 1e-6)) {
      setError(`Must be between ${formatTime(min)} and ${formatTime(max ?? 0)}`);
      return;
    }
    setError(null);
    setDraft(null);
    onCommit(parsed);
  };

  return (
    <div className="field field--time">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={`input input--mono${error ? ' input--invalid' : ''}`}
        value={text}
        inputMode="decimal"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errId : undefined}
        data-testid={testId}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(null);
            setError(null);
          }
        }}
      />
      {error && (
        <span id={errId} className="field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Text input that commits on blur or Enter. Used for renaming. */
export function InlineText({
  value,
  onCommit,
  label,
  className = 'input',
  placeholder,
  testId,
  hideLabel = true,
}: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  className?: string;
  placeholder?: string;
  testId?: string;
  hideLabel?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const commit = () => {
    if (draft === null) return;
    const v = draft.trim();
    setDraft(null);
    if (v && v !== value) onCommit(v);
  };
  return (
    <span className="inline-text">
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : 'field__label'}>
        {label}
      </label>
      <input
        id={id}
        className={className}
        value={draft ?? value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
          }
        }}
      />
    </span>
  );
}

/** Textarea that saves on every change and reports a single "edit finished" on blur. */
export function AutoTextarea({
  label,
  value,
  onChange,
  onEditFinished,
  rows = 4,
  placeholder,
  hint,
  testId,
  readOnly,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  onEditFinished?: (v: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: ReactNode;
  testId?: string;
  readOnly?: boolean;
}) {
  const id = useId();
  const hintId = useId();
  const [startValue, setStartValue] = useState<string | null>(null);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="input textarea"
        rows={rows}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        aria-describedby={hint ? hintId : undefined}
        data-testid={testId}
        onFocus={() => setStartValue(value)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (startValue !== null && startValue !== value) onEditFinished?.(value);
          setStartValue(null);
        }}
      />
      {hint && (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      )}
    </div>
  );
}
