'use client';

import { useId } from 'react';

/**
 * A labelled form control with accessible error reporting (FR-80).
 *
 * The error is wired through `aria-invalid` + `aria-describedby` and announced via `role="alert"`,
 * so a screen-reader user hears *which* field is wrong and why — a red border alone communicates
 * nothing to them.
 */
export function Field({
  label,
  name,
  type = 'text',
  value,
  onChange,
  error,
  hint,
  autoComplete,
  required = true,
  inputMode,
  maxLength,
  rows,
  placeholder,
  disabled,
}: {
  label: string;
  name: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string;
  autoComplete?: string;
  required?: boolean;
  inputMode?: 'text' | 'numeric' | 'email';
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const shared = {
    id,
    name,
    value,
    required,
    disabled,
    placeholder,
    maxLength,
    autoComplete,
    inputMode,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    className: 'dl-input',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  } as const;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {!required && <span className="ml-1 font-normal text-[var(--color-ink-faint)]">(optional)</span>}
      </label>
      {rows ? <textarea {...shared} rows={rows} className="dl-input font-mono text-sm" /> : <input {...shared} type={type} />}
      {hint && (
        <p id={hintId} className="text-xs text-[var(--color-ink-faint)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-[var(--color-bad)]">
          {error}
        </p>
      )}
    </div>
  );
}

/** A form-level message: the errors that belong to the submission rather than to one field. */
export function FormMessage({ error, success }: { error?: string | undefined; success?: string | undefined }) {
  if (!error && !success) return null;
  return (
    <p
      role="alert"
      className={`rounded-lg border px-3 py-2 text-sm ${
        error
          ? 'border-[var(--color-bad)] text-[var(--color-bad)]'
          : 'border-[var(--color-good)] text-[var(--color-good)]'
      }`}
    >
      {error ?? success}
    </p>
  );
}
