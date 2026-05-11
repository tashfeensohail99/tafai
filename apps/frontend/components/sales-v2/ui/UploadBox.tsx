'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { CheckCircle2, FileUp, UploadCloud } from 'lucide-react';

interface UploadBoxProps {
  label?: string;
  hint?: string;
  accept?: string;
  onFileSelected?: (file: File) => void;
}

/** UploadBox — premium drag/click upload area used for receipts. */
export function UploadBox({
  label = 'Drag a file here or click to browse',
  hint = 'PDF, JPG, or PNG up to 10MB',
  accept = '.pdf,image/png,image/jpeg',
  onFileSelected,
}: UploadBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);

  function open() {
    inputRef.current?.click();
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      setPicked(file);
      onFileSelected?.(file);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      className="sos-dropzone"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        alignItems: 'center',
        textAlign: 'center',
        width: '100%',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: '52px',
          height: '52px',
          borderRadius: '16px',
          display: 'grid',
          placeItems: 'center',
          background: picked ? 'var(--sos-status-success-soft)' : 'var(--sos-brand-primary-soft)',
          color: picked ? 'var(--sos-status-success)' : 'var(--sos-brand-primary-strong)',
          border: `1px solid ${picked ? 'var(--sos-status-success-border)' : 'var(--sos-brand-primary-border)'}`,
        }}
      >
        {picked ? <CheckCircle2 size={22} /> : <UploadCloud size={22} />}
      </div>
      <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)', fontSize: '13.5px' }}>
        {picked ? picked.name : label}
      </div>
      <div className="sos-text-faint" style={{ fontSize: '11.5px' }}>
        {picked ? `${(picked.size / 1024).toFixed(1)} KB · click to replace` : hint}
      </div>
      <input ref={inputRef} type="file" accept={accept} onChange={onChange} hidden />
      {!picked ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '6px',
            fontSize: '12px',
            color: 'var(--sos-brand-primary-strong)',
            fontWeight: 600,
          }}
        >
          <FileUp size={13} /> Choose file
        </span>
      ) : null}
    </button>
  );
}
