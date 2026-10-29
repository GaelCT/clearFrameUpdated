import { useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface DropZoneProps {
  label: string;
  hint?: ReactNode;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onFiles: (files: File[]) => void;
  buttonLabel?: string;
  compact?: boolean;
  testId?: string;
}

/** Drag-and-drop target with an ordinary file picker button. */
export function DropZone({ label, hint, accept, multiple, disabled, busy, onFiles, buttonLabel, compact, testId }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();
  const hintId = useId();

  const take = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      className={`dropzone${dragging ? ' dropzone--active' : ''}${compact ? ' dropzone--compact' : ''}${disabled ? ' dropzone--disabled' : ''}`}
      data-testid={testId}
      onDragEnter={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files);
      }}
    >
      <Icon name="upload" size={compact ? 16 : 22} className="dropzone__icon" />
      <div className="dropzone__text">
        <span className="dropzone__label">{label}</span>
        {hint && (
          <span id={hintId} className="dropzone__hint">
            {hint}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="visually-hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
        data-testid={testId ? `${testId}-input` : undefined}
      />
      <button
        type="button"
        className="btn btn--secondary"
        disabled={disabled || busy}
        aria-describedby={hint ? hintId : undefined}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Reading…' : (buttonLabel ?? 'Choose files')}
      </button>
    </div>
  );
}

/** A hidden file input triggered by a button, for replace/reattach actions. */
export function FileButton({
  label,
  accept,
  onFile,
  className = 'btn btn--ghost btn--sm',
  disabled,
  ariaLabel,
  testId,
  icon,
}: {
  label: string;
  accept: string;
  onFile: (file: File) => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  testId?: string;
  icon?: Parameters<typeof Icon>[0]['name'];
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <button type="button" className={className} disabled={disabled} aria-label={ariaLabel} onClick={() => ref.current?.click()}>
        {icon && <Icon name={icon} />}
        {label}
      </button>
    </>
  );
}
