// A labelled form input with its error message underneath.
import type { InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string };

export function Field({ label, error, id, ...input }: Props) {
  const inputId = id ?? input.name;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} aria-invalid={error ? true : undefined} aria-describedby={error ? `${inputId}-error` : undefined} {...input} />
      {error && (
        <span className="field-error" id={`${inputId}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}
