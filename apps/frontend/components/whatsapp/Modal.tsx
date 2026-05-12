'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Reusable modal shell for the WhatsApp module. Slimmer than the shared
 * ConfirmationDialog (which is more confirm-style) — this one is a generic
 * card overlay with a header bar and custom body.
 */
export function Modal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.open, props]);

  if (!props.open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onClick={props.onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'var(--sos-bg-overlay)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '8vh',
        paddingBottom: 24,
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sos-glass sos-glass--strong"
        style={{
          width: '100%',
          maxWidth: props.width ?? 520,
          margin: '0 16px',
          padding: 0,
          borderRadius: 'var(--sos-radius-panel)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--sos-border-subtle)',
          }}
        >
          <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)' }}>
            {props.title}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="sos-topbar__icon-btn"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>
        <div style={{ padding: 18 }}>{props.children}</div>
        {props.footer && (
          <footer
            style={{
              padding: '14px 18px',
              borderTop: '1px solid var(--sos-border-subtle)',
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
            }}
          >
            {props.footer}
          </footer>
        )}
      </div>
    </div>
  );
}
