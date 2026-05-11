'use client';

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

interface FieldShellProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/** Outer shell that pairs every input with a uppercase label and optional hint/error. */
export function Field({ label, hint, error, required, children, className = '' }: FieldShellProps) {
  return (
    <div className={className}>
      {label ? (
        <label className="sos-label">
          {label}
          {required ? <span style={{ color: 'var(--sos-status-danger)', marginLeft: 4 }}>*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <div className="sos-help sos-help--error">{error}</div> : hint ? <div className="sos-help">{hint}</div> : null}
    </div>
  );
}

interface FormInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  iconLeft?: ReactNode;
  inputSize?: 'md' | 'lg';
  required?: boolean;
}

export function FormInput({
  label,
  hint,
  error,
  iconLeft,
  required,
  inputSize = 'md',
  className = '',
  ...rest
}: FormInputProps) {
  const sizeClass = inputSize === 'lg' ? 'sos-input--lg' : '';

  const input = (
    <input className={`sos-input ${sizeClass} ${className}`} {...rest} />
  );

  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {iconLeft ? (
        <div className="sos-input-group">
          <span className="sos-input-group__icon">{iconLeft}</span>
          {input}
        </div>
      ) : (
        input
      )}
    </Field>
  );
}

interface FormSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  inputSize?: 'md' | 'lg';
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
}

export function FormSelect({
  label,
  hint,
  error,
  required,
  inputSize = 'md',
  options,
  placeholder,
  className = '',
  ...rest
}: FormSelectProps) {
  const sizeClass = inputSize === 'lg' ? 'sos-input--lg' : '';
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <select className={`sos-select ${sizeClass} ${className}`} {...rest}>
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

interface FormTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  inputSize?: 'md' | 'lg';
}

export function FormTextarea({
  label,
  hint,
  error,
  required,
  inputSize = 'md',
  className = '',
  ...rest
}: FormTextareaProps) {
  const sizeClass = inputSize === 'lg' ? 'sos-textarea--lg' : '';
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <textarea className={`sos-textarea ${sizeClass} ${className}`} {...rest} />
    </Field>
  );
}
